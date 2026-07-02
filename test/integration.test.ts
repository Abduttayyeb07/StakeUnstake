import { describe, expect, it } from "vitest";
import { parseTxToAlerts, txHashFromBase64 } from "../src/txParser.js";
import type { TxResult } from "../src/types.js";

/**
 * Live-network tests against ZigChain mainnet RPC.
 * Run with: INTEGRATION=1 npm test   (PowerShell: $env:INTEGRATION="1"; npm test)
 */
const RPC = "https://zigchain-mainnet.zigscan.net";
const WALLET = "zig1wrje0m0uhmgme77uxh0a4jynd70a8vsee8ksg4";

const enabled = process.env.INTEGRATION === "1";

describe.skipIf(!enabled)("integration: real ZigChain txs", () => {
  it("decodes real txs from tx_search without throwing", async () => {
    const query = encodeURIComponent(`"message.sender='${WALLET}'"`);
    const res = await fetch(`${RPC}/tx_search?query=${query}&per_page=5&page=1&order_by=%22desc%22`);
    expect(res.ok).toBe(true);
    const json = (await res.json()) as any;
    const txs: any[] = json.result?.txs ?? [];
    expect(txs.length).toBeGreaterThan(0);

    for (const t of txs) {
      const txResult: TxResult = {
        code: t.tx_result.code ?? 0,
        events: t.tx_result.events ?? [],
      };
      const alerts = parseTxToAlerts({
        txBase64: t.tx,
        txResult,
        height: Number(t.height),
        wallets: new Set([WALLET]),
      });
      // hash we compute must match the hash the node reports
      expect(txHashFromBase64(t.tx)).toBe(t.hash.toUpperCase());
      if (txResult.code === 0) {
        expect(alerts.length).toBeGreaterThan(0);
      }
    }
  }, 30_000);

  it("replays a full block containing a wallet tx through the pipeline", async () => {
    const query = encodeURIComponent(`"message.sender='${WALLET}'"`);
    const searchRes = await fetch(`${RPC}/tx_search?query=${query}&per_page=1&page=1&order_by=%22desc%22`);
    const search = (await searchRes.json()) as any;
    const tx = search.result?.txs?.[0];
    expect(tx).toBeDefined();
    const height = Number(tx.height);

    const [blockRes, resultsRes] = await Promise.all([
      fetch(`${RPC}/block?height=${height}`),
      fetch(`${RPC}/block_results?height=${height}`),
    ]);
    const block = (await blockRes.json()) as any;
    const results = (await resultsRes.json()) as any;

    const txs: string[] = block.result.block.data.txs ?? [];
    const txsResults: any[] = results.result.txs_results ?? [];
    const allAlerts = txs.flatMap((txBase64, i) => {
      const r = txsResults[i];
      if (!r || (r.code ?? 0) !== 0) return [];
      return parseTxToAlerts({
        txBase64,
        txResult: { code: r.code ?? 0, events: r.events ?? [] },
        height,
        wallets: new Set([WALLET]),
      });
    });

    expect(allAlerts.length).toBeGreaterThan(0);
    expect(allAlerts.some((a) => a.wallet === WALLET)).toBe(true);
  }, 30_000);
});
