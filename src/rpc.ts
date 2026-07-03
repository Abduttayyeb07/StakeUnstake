import { QueryBalanceRequest, QueryBalanceResponse } from "cosmjs-types/cosmos/bank/v1beta1/query.js";
import type { TxResult } from "./types.js";

interface JsonRpcEnvelope<T> {
  jsonrpc: string;
  id: number | string;
  result?: T;
  error?: { code: number; message: string; data?: string };
}

export interface BlockData {
  height: number;
  /** base64-encoded raw tx bytes */
  txs: string[];
}

export interface BlockResultsData {
  height: number;
  txsResults: TxResult[];
}

export interface TxSearchEntry {
  hash: string;
  height: number;
  /** base64-encoded raw tx bytes */
  tx: string;
  txResult: TxResult;
}

export interface TxSearchPage {
  txs: TxSearchEntry[];
  totalCount: number;
}

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Tendermint RPC client with endpoint failover: requests go to the current
 * endpoint; on failure every other endpoint is tried in order, and the first
 * one that answers becomes the new current (sticky) endpoint.
 */
export class RpcClient {
  private readonly baseUrls: string[];
  private current = 0;

  constructor(baseUrls: string | string[]) {
    this.baseUrls = (Array.isArray(baseUrls) ? baseUrls : [baseUrls]).map((u) =>
      u.replace(/\/+$/, ""),
    );
    if (this.baseUrls.length === 0) throw new Error("RpcClient needs at least one endpoint");
  }

  private async getFrom<T>(baseUrl: string, path: string): Promise<T> {
    const res = await fetch(`${baseUrl}/${path}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`RPC ${path} -> HTTP ${res.status}`);
    const json = (await res.json()) as JsonRpcEnvelope<T>;
    if (json.error) {
      throw new Error(`RPC ${path} -> error: ${json.error.message} ${json.error.data ?? ""}`);
    }
    if (json.result === undefined) throw new Error(`RPC ${path} -> empty result`);
    return json.result;
  }

  private async get<T>(path: string): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < this.baseUrls.length; i++) {
      const idx = (this.current + i) % this.baseUrls.length;
      try {
        const result = await this.getFrom<T>(this.baseUrls[idx], path);
        if (idx !== this.current) {
          console.warn(`[rpc] failed over to ${this.baseUrls[idx]}`);
          this.current = idx;
        }
        return result;
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  }

  async getLatestHeight(): Promise<number> {
    const result = await this.get<{ sync_info: { latest_block_height: string } }>("status");
    return Number(result.sync_info.latest_block_height);
  }

  async getBlock(height: number): Promise<BlockData> {
    const result = await this.get<{
      block: { header: { height: string }; data: { txs: string[] | null } };
    }>(`block?height=${height}`);
    return {
      height: Number(result.block.header.height),
      txs: result.block.data.txs ?? [],
    };
  }

  async txSearch(query: string, page: number, perPage = 100): Promise<TxSearchPage> {
    const q = encodeURIComponent(`"${query}"`);
    const result = await this.get<{
      total_count: string;
      txs: Array<{
        hash: string;
        height: string;
        tx: string;
        tx_result: { code?: number; log?: string; events?: TxResult["events"] };
      }>;
    }>(`tx_search?query=${q}&per_page=${perPage}&page=${page}&order_by=%22asc%22`);
    return {
      totalCount: Number(result.total_count),
      txs: (result.txs ?? []).map((t) => ({
        hash: t.hash,
        height: Number(t.height),
        tx: t.tx,
        txResult: {
          code: t.tx_result.code ?? 0,
          log: t.tx_result.log,
          events: t.tx_result.events ?? [],
        },
      })),
    };
  }

  async getBlockResults(height: number): Promise<BlockResultsData> {
    const result = await this.get<{
      height: string;
      txs_results:
        | Array<{ code?: number; log?: string; events?: TxResult["events"] }>
        | null;
    }>(`block_results?height=${height}`);
    return {
      height: Number(result.height),
      txsResults: (result.txs_results ?? []).map((r) => ({
        code: r.code ?? 0,
        log: r.log,
        events: r.events ?? [],
      })),
    };
  }

  /**
   * Query a bank module balance through Tendermint's generic abci_query,
   * so it goes through the same endpoints/failover as everything else
   * instead of needing a separate LCD/REST dependency.
   */
  async getBalance(address: string, denom = "uzig"): Promise<string> {
    const data = QueryBalanceRequest.encode({ address, denom }).finish();
    const hex = Buffer.from(data).toString("hex");
    const result = await this.get<{
      response: { code: number; log?: string; value: string | null };
    }>(`abci_query?path="/cosmos.bank.v1beta1.Query/Balance"&data=0x${hex}`);
    const { code, log, value } = result.response;
    if (code !== 0) throw new Error(`abci_query Balance failed: ${log ?? code}`);
    if (!value) return "0";
    const decoded = QueryBalanceResponse.decode(Buffer.from(value, "base64"));
    return decoded.balance?.amount ?? "0";
  }
}
