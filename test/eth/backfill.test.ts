import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EthBackfiller } from "../../src/eth/backfill.js";
import { loadEthConfig } from "../../src/ethConfig.js";
import { makeTransferLog, TOKEN, WALLET1, OTHER } from "./helpers.js";
import type { FallbackRpcProvider } from "../../src/eth/rpcProvider.js";
import type { TransferAlert } from "../../src/eth/types.js";

function config(overrides: Record<string, string> = {}) {
  return loadEthConfig({
    ETH_RPC_URLS: "https://x.test",
    WATCHED_WALLETS: `Deal 1 (eth)=${WALLET1}`,
    ZIG_TOKEN_ADDRESS: TOKEN,
    MAX_BLOCK_RANGE: "10",
    CONFIRMATIONS: "0",
    // empty (not unset) so saveState() no-ops — prevents tests from writing
    // into the real project's eth-state.json; only the persistence test
    // below overrides this with a real tmp-directory path
    ETH_STATE_FILE: "",
    ...overrides,
  });
}

function mockRpc(opts: {
  latest: number;
  logsByRange?: Record<string, ReturnType<typeof makeTransferLog>[]>;
  failBlocks?: (from: number, attempt: number) => boolean;
}): FallbackRpcProvider {
  const attempts = new Map<string, number>();
  return {
    getBlockNumber: vi.fn(async () => opts.latest),
    getLogs: vi.fn(async ({ fromBlock, toBlock, topics }: any) => {
      const key = `${fromBlock}-${toBlock}`;
      const n = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, n);
      if (opts.failBlocks?.(fromBlock, n)) throw new Error("rpc error");
      const isOutgoing = Array.isArray(topics[1]); // topics[1]=wallets means outgoing query
      const all = opts.logsByRange?.[key] ?? [];
      // crude split matching processRange's two parallel queries by direction
      return all.filter((l) => {
        const fromMatches = l.topics[1]?.toLowerCase().includes(WALLET1.slice(2).toLowerCase());
        return isOutgoing ? fromMatches : !fromMatches;
      });
    }),
  } as unknown as FallbackRpcProvider;
}

let tmp: string | null = null;
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

describe("EthBackfiller", () => {
  it("chunks a wide range by maxBlockRange", async () => {
    const rpc = mockRpc({ latest: 25 });
    const dispatch = vi.fn(async () => true);
    const b = new EthBackfiller({ rpc, config: config(), dispatch, log: () => {} });
    // force starting checkpoint without touching getBlockNumber for init
    (b as any).lastProcessedBlock = 0;

    await (b as any).poll();

    const calledRanges = (rpc.getLogs as any).mock.calls.map((c: any[]) => [c[0].fromBlock, c[0].toBlock]);
    // maxBlockRange=10, latest=25, confirmations=0 -> chunks [1,10],[11,20],[21,25], each queried twice (in+out)
    const uniqueRanges = [...new Set(calledRanges.map((r: number[]) => r.join("-")))];
    expect(uniqueRanges).toEqual(["1-10", "11-20", "21-25"]);
  });

  it("holds back the tip by `confirmations` blocks", async () => {
    const rpc = mockRpc({ latest: 100 });
    const dispatch = vi.fn(async () => true);
    const b = new EthBackfiller({ rpc, config: config({ CONFIRMATIONS: "12", MAX_BLOCK_RANGE: "1000" }), dispatch, log: () => {} });
    (b as any).lastProcessedBlock = 0;

    await (b as any).poll();

    const calledRanges = (rpc.getLogs as any).mock.calls.map((c: any[]) => [c[0].fromBlock, c[0].toBlock]);
    expect(calledRanges[0]).toEqual([1, 88]); // 100 - 12 confirmations
  });

  it("retries a failing chunk with backoff, then succeeds", async () => {
    const rpc = mockRpc({ latest: 10, failBlocks: (_from, attempt) => attempt <= 2 });
    const dispatch = vi.fn(async () => true);
    const b = new EthBackfiller({
      rpc, config: config({ MAX_BLOCK_RANGE: "100" }), dispatch, baseRetryDelayMs: 1, log: () => {},
    });
    (b as any).lastProcessedBlock = 0;

    await (b as any).poll();
    expect(b.checkpoint).toBe(10);
  });

  it("dedupes a transfer between two watched wallets appearing in both queries", async () => {
    const log = makeTransferLog(WALLET1, OTHER, 1n, { blockNumber: 5 });
    const rpc = mockRpc({ latest: 10, logsByRange: { "1-10": [log] } });
    const dispatched: any[] = [];
    const dispatch = vi.fn(async (alert: TransferAlert) => {
      dispatched.push(alert);
      return true;
    });
    const b = new EthBackfiller({ rpc, config: config({ MAX_BLOCK_RANGE: "100" }), dispatch, log: () => {} });
    (b as any).lastProcessedBlock = 0;

    await (b as any).poll();
    expect(dispatched).toHaveLength(1);
  });

  it("persists checkpoint and resumes across a restart", async () => {
    tmp = mkdtempSync(join(tmpdir(), "eth-backfill-"));
    const stateFile = join(tmp, "eth-state.json");
    const rpc = mockRpc({ latest: 10 });
    const dispatch = vi.fn(async () => true);

    const b1 = new EthBackfiller({ rpc, config: config({ ETH_STATE_FILE: stateFile, MAX_BLOCK_RANGE: "100" }), dispatch, log: () => {} });
    await b1.init(); // no persisted state -> starts from latest - maxBacklogBlocks
    (b1 as any).lastProcessedBlock = 5; // simulate partial progress
    (b1 as any).saveState();

    const b2 = new EthBackfiller({ rpc, config: config({ ETH_STATE_FILE: stateFile, MAX_BLOCK_RANGE: "100" }), dispatch, log: () => {} });
    await b2.init();
    expect(b2.checkpoint).toBe(5);
  });
});
