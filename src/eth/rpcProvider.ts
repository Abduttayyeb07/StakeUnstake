import { JsonRpcProvider, Network, type Log } from "ethers";

const MAINNET_CHAIN_ID = 1n;

export interface LogFilterParams {
  address: string;
  topics: (string | string[] | null)[];
  fromBlock: number;
  toBlock: number;
}

/**
 * Wraps multiple JsonRpcProvider instances with sequential, sticky failover —
 * same pattern as the Cosmos RpcClient. Every provider is constructed with
 * staticNetwork so ethers never spends extra calls auto-detecting the chain
 * (important since down/unauthorized public endpoints would otherwise get
 * hit repeatedly just for network detection before the real call even runs).
 *
 * Some free public RPCs reject eth_getLogs over older block ranges with a
 * 403 "archive node required" error — getLogs() retries across every
 * configured endpoint in order specifically to route around that.
 */
export class FallbackRpcProvider {
  private readonly providers: JsonRpcProvider[];
  private current = 0;

  constructor(rpcUrls: string[]) {
    if (rpcUrls.length === 0) throw new Error("FallbackRpcProvider needs at least one RPC URL");
    const network = Network.from(MAINNET_CHAIN_ID);
    this.providers = rpcUrls.map(
      (url) => new JsonRpcProvider(url, network, { staticNetwork: network }),
    );
  }

  /** Verifies the current (first) provider is actually reachable and on mainnet. */
  async verifyConnected(): Promise<{ url: string; chainId: bigint }> {
    for (let i = 0; i < this.providers.length; i++) {
      try {
        const net = await this.providers[i].getNetwork();
        if (net.chainId !== MAINNET_CHAIN_ID) {
          throw new Error(`expected chain id 1 (mainnet), got ${net.chainId}`);
        }
        this.current = i;
        return { url: this.providers[i]._getConnection().url, chainId: net.chainId };
      } catch {
        // try the next endpoint
      }
    }
    throw new Error("no configured ETH_RPC_URLS are reachable / on mainnet");
  }

  private async withFallback<T>(fn: (p: JsonRpcProvider) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < this.providers.length; i++) {
      const idx = (this.current + i) % this.providers.length;
      try {
        const result = await fn(this.providers[idx]);
        if (idx !== this.current) {
          console.warn(`[eth-rpc] failed over to ${this.providers[idx]._getConnection().url}`);
          this.current = idx;
        }
        return result;
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  }

  async getBlockNumber(): Promise<number> {
    return this.withFallback((p) => p.getBlockNumber());
  }

  async getLogs(filter: LogFilterParams): Promise<Log[]> {
    return this.withFallback((p) => p.getLogs(filter));
  }

  async getBalance(address: string): Promise<bigint> {
    return this.withFallback((p) => p.getBalance(address));
  }

  async call(tx: { to: string; data: string }): Promise<string> {
    return this.withFallback((p) => p.call(tx));
  }

  get currentUrl(): string {
    return this.providers[this.current]._getConnection().url;
  }
}
