import { describe, expect, it, vi } from "vitest";
import { BlockProcessor, type BlockTxContext } from "../src/blockProcessor.js";
import type { RpcClient } from "../src/rpc.js";

function mockRpc(blocks: Record<number, string[]>): RpcClient {
  return {
    getLatestHeight: vi.fn(),
    getBlock: vi.fn(async (h: number) => ({ height: h, txs: blocks[h] ?? [] })),
    getBlockResults: vi.fn(async (h: number) => ({
      height: h,
      txsResults: (blocks[h] ?? []).map(() => ({ code: 0, events: [] })),
    })),
  } as unknown as RpcClient;
}

const flush = () => new Promise((r) => setTimeout(r, 50));

describe("BlockProcessor", () => {
  it("processes every block from checkpoint to target (gap healing)", async () => {
    const rpc = mockRpc({ 101: ["tx-a"], 102: [], 103: ["tx-b", "tx-c"] });
    const seen: BlockTxContext[] = [];
    const p = new BlockProcessor({ rpc, onTx: async (ctx) => void seen.push(ctx), log: () => {} });
    p.init(100);

    p.scheduleCatchUp(103); // WS reported 103; 101 and 102 must be healed
    await flush();

    expect((rpc.getBlock as any).mock.calls.map((c: any[]) => c[0])).toEqual([101, 102, 103]);
    expect(seen.map((s) => s.txBase64)).toEqual(["tx-a", "tx-b", "tx-c"]);
    expect(p.checkpoint).toBe(103);
  });

  it("never processes the same block twice across duplicate signals", async () => {
    const rpc = mockRpc({ 101: ["tx-a"] });
    let count = 0;
    const p = new BlockProcessor({ rpc, onTx: async () => void count++, log: () => {} });
    p.init(100);

    p.scheduleCatchUp(101); // WS subscription 1
    p.scheduleCatchUp(101); // WS subscription 2
    p.scheduleCatchUp(101); // polling fallback
    await flush();

    expect(count).toBe(1);
  });

  it("retries a failing block with backoff, then succeeds", async () => {
    const rpc = mockRpc({ 101: ["tx-a"] });
    let attempts = 0;
    (rpc.getBlock as any).mockImplementation(async (h: number) => {
      attempts++;
      if (attempts < 3) throw new Error("rpc down");
      return { height: h, txs: ["tx-a"] };
    });
    const seen: string[] = [];
    const p = new BlockProcessor({
      rpc,
      onTx: async (ctx) => void seen.push(ctx.txBase64),
      baseRetryDelayMs: 1,
      log: () => {},
    });
    p.init(100);
    p.scheduleCatchUp(101);
    await flush();

    expect(attempts).toBe(3);
    expect(seen).toEqual(["tx-a"]);
  });

  it("skips a block after max retries and continues to the next", async () => {
    const rpc = mockRpc({ 102: ["tx-b"] });
    (rpc.getBlock as any).mockImplementation(async (h: number) => {
      if (h === 101) throw new Error("permanently broken");
      return { height: h, txs: ["tx-b"] };
    });
    const seen: string[] = [];
    const p = new BlockProcessor({
      rpc,
      onTx: async (ctx) => void seen.push(ctx.txBase64),
      maxRetries: 2,
      baseRetryDelayMs: 1,
      log: () => {},
    });
    p.init(100);
    p.scheduleCatchUp(102);
    await flush();

    expect(seen).toEqual(["tx-b"]);
    expect(p.checkpoint).toBe(102);
  });

  it("skips failed txs (code !== 0)", async () => {
    const rpc = mockRpc({ 101: ["tx-ok", "tx-fail"] });
    (rpc.getBlockResults as any).mockResolvedValue({
      height: 101,
      txsResults: [
        { code: 0, events: [] },
        { code: 5, events: [] },
      ],
    });
    const seen: string[] = [];
    const p = new BlockProcessor({ rpc, onTx: async (ctx) => void seen.push(ctx.txBase64), log: () => {} });
    p.init(100);
    p.scheduleCatchUp(101);
    await flush();

    expect(seen).toEqual(["tx-ok"]);
  });
});
