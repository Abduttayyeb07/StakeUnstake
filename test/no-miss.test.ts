import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlockProcessor } from "../src/blockProcessor.js";
import { Backfiller } from "../src/backfill.js";
import { AlertDeduper } from "../src/dedupe.js";
import { parseTxToAlerts } from "../src/txParser.js";
import type { RpcClient } from "../src/rpc.js";
import type { Alert, TxResult } from "../src/types.js";
import { WALLET, OTHER, VALIDATOR, VALIDATOR2, buildTxBase64, msgs } from "./helpers.js";

interface ChainTx {
  tx: string;
  result: TxResult;
}

/**
 * Mock 10-block chain exercising every message type, plus traps:
 * failed txs (code 5) and txs from an untracked wallet.
 * Expected alerts for WALLET: exactly 9.
 */
function buildChain(): Record<number, ChainTx[]> {
  const ok = (events: TxResult["events"] = []): TxResult => ({ code: 0, events });
  const failed = (): TxResult => ({ code: 5, events: [] });
  const unbondEv = (time: string) => ({
    type: "unbond",
    attributes: [{ key: "completion_time", value: time }],
  });
  const redelegateEv = (time: string) => ({
    type: "redelegate",
    attributes: [{ key: "completion_time", value: time }],
  });

  return {
    101: [
      { tx: buildTxBase64([msgs.delegate(WALLET, VALIDATOR, "4000000000")]), result: ok() },
      { tx: buildTxBase64([msgs.delegate(WALLET, VALIDATOR, "999")]), result: failed() }, // must NOT alert
    ],
    102: [{ tx: buildTxBase64([msgs.send(WALLET, OTHER, "1000000")]), result: ok() }],
    103: [
      {
        tx: buildTxBase64([msgs.undelegate(WALLET, VALIDATOR, "9347527752")]),
        result: ok([unbondEv("2026-07-23T16:00:00Z")]),
      },
    ],
    104: [{ tx: buildTxBase64([msgs.delegate(OTHER, VALIDATOR, "5")]), result: ok() }], // untracked wallet
    105: [
      {
        tx: buildTxBase64([msgs.redelegate(WALLET, VALIDATOR, VALIDATOR2, "10000000000")]),
        result: ok([redelegateEv("2026-07-23T16:00:00Z")]),
      },
    ],
    106: [{ tx: buildTxBase64([msgs.send(OTHER, WALLET, "500000")]), result: ok() }],
    107: [
      {
        // multi-message tx: two alerts from one tx
        tx: buildTxBase64([
          msgs.delegate(WALLET, VALIDATOR2, "2000000"),
          msgs.undelegate(WALLET, VALIDATOR, "3000000"),
        ]),
        result: ok([unbondEv("2026-07-24T10:00:00Z")]),
      },
    ],
    108: [
      { tx: buildTxBase64([msgs.executeContract(WALLET, "zig1contract", { deposit: {} })]), result: ok() },
    ],
    109: [{ tx: buildTxBase64([msgs.ibcTransfer(WALLET, "osmo1xyz", "2500000")]), result: ok() }],
    110: [],
  };
}

const EXPECTED_KINDS = [
  "delegate", // 101
  "send", // 102 out
  "undelegate", // 103
  "redelegate", // 105
  "send", // 106 in
  "delegate", // 107
  "undelegate", // 107
  "contract_call", // 108
  "ibc_transfer", // 109
].sort();

function chainRpc(
  blocks: Record<number, ChainTx[]>,
  opts: { failGetBlock?: (height: number, attempt: number) => boolean } = {},
): RpcClient {
  const attempts = new Map<number, number>();
  return {
    getLatestHeight: vi.fn(async () => Math.max(...Object.keys(blocks).map(Number))),
    getBlock: vi.fn(async (h: number) => {
      const n = (attempts.get(h) ?? 0) + 1;
      attempts.set(h, n);
      if (opts.failGetBlock?.(h, n)) throw new Error(`simulated RPC failure at ${h}`);
      return { height: h, txs: (blocks[h] ?? []).map((t) => t.tx) };
    }),
    getBlockResults: vi.fn(async (h: number) => ({
      height: h,
      txsResults: (blocks[h] ?? []).map((t) => t.result),
    })),
    txSearch: vi.fn(async (query: string) => {
      // emulate tendermint tx_search: return the wallet's txs in the height range
      if (!query.includes(`message.sender='${WALLET}'`)) return { txs: [], totalCount: 0 };
      const [, gt, lte] = query.match(/tx\.height>(\d+) AND tx\.height<=(\d+)/) ?? [];
      const txs = Object.entries(blocks)
        .filter(([h]) => Number(h) > Number(gt) && Number(h) <= Number(lte))
        .flatMap(([h, list]) =>
          list.map((t) => ({ hash: "X", height: Number(h), tx: t.tx, txResult: t.result })),
        );
      return { txs, totalCount: txs.length };
    }),
  } as unknown as RpcClient;
}

interface Harness {
  processor: BlockProcessor;
  backfiller: Backfiller;
  broadcasts: Alert[];
}

function makeHarness(
  rpc: RpcClient,
  files?: { stateFile: string; backfillStateFile: string; dedupeFile: string },
  broadcasts: Alert[] = [],
): Harness {
  const deduper = new AlertDeduper(files?.dedupeFile);
  const dispatch = async (alert: Alert) => {
    if (deduper.markSeen(alert)) broadcasts.push(alert);
  };
  const wallets = new Set([WALLET]);
  const processor = new BlockProcessor({
    rpc,
    stateFile: files?.stateFile,
    baseRetryDelayMs: 1,
    log: () => {},
    onTx: async ({ height, txBase64, txResult }) => {
      for (const a of parseTxToAlerts({ txBase64, txResult, height, wallets })) {
        await dispatch(a);
      }
    },
  });
  const backfiller = new Backfiller({
    rpc,
    wallets: [WALLET],
    stateFile: files?.backfillStateFile,
    dispatch,
    log: () => {},
  });
  return { processor, backfiller, broadcasts };
}

const settle = async (until?: () => boolean) => {
  const deadline = Date.now() + 5_000;
  do {
    await new Promise((r) => setTimeout(r, 50));
  } while (until && !until() && Date.now() < deadline);
};

let tmp: string | null = null;
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

describe("no-miss guarantee (mock chain, all 6 message types)", () => {
  it("happy path: single catch-up signal delivers all 9 alerts exactly once", async () => {
    const { processor, broadcasts } = makeHarness(chainRpc(buildChain()));
    processor.init(100);
    processor.scheduleCatchUp(110); // one signal for the newest block only
    await settle(() => processor.checkpoint === 110);

    expect(broadcasts.map((a) => a.kind).sort()).toEqual(EXPECTED_KINDS);
    // completion times survived
    expect(broadcasts.find((a) => a.kind === "redelegate")).toMatchObject({
      completionTime: "2026-07-23T16:00:00Z",
    });
    expect(
      broadcasts.filter((a) => a.kind === "undelegate").map((a: any) => a.completionTime).sort(),
    ).toEqual(["2026-07-23T16:00:00Z", "2026-07-24T10:00:00Z"]);
  });

  it("duplicate signals (3 WS subs + poller firing for every height) cause zero duplicates", async () => {
    const { processor, broadcasts } = makeHarness(chainRpc(buildChain()));
    processor.init(100);
    for (let h = 101; h <= 110; h++) {
      for (let s = 0; s < 4; s++) processor.scheduleCatchUp(h); // 40 signals
    }
    await settle(() => processor.checkpoint === 110);

    expect(broadcasts).toHaveLength(9);
    expect(broadcasts.map((a) => a.kind).sort()).toEqual(EXPECTED_KINDS);
  });

  it("WS completely dead: polling-only signals still deliver everything", async () => {
    const { processor, broadcasts } = makeHarness(chainRpc(buildChain()));
    processor.init(100);
    // poller only reports the latest height each tick
    processor.scheduleCatchUp(104);
    await settle(() => processor.checkpoint === 104);
    processor.scheduleCatchUp(110);
    await settle(() => processor.checkpoint === 110);

    expect(broadcasts.map((a) => a.kind).sort()).toEqual(EXPECTED_KINDS);
  });

  it("flaky RPC (every block fails twice before succeeding): nothing lost", async () => {
    const rpc = chainRpc(buildChain(), { failGetBlock: (_h, attempt) => attempt <= 2 });
    const { processor, broadcasts } = makeHarness(rpc);
    processor.init(100);
    processor.scheduleCatchUp(110);
    await settle(() => processor.checkpoint === 110);

    expect(broadcasts.map((a) => a.kind).sort()).toEqual(EXPECTED_KINDS);
  });

  it("block 105 permanently dead on RPC: backfill recovers its redelegate, exactly once", async () => {
    const rpc = chainRpc(buildChain(), { failGetBlock: (h) => h === 105 });
    const { processor, backfiller, broadcasts } = makeHarness(rpc);
    processor.init(100);
    backfiller.init(100);
    processor.scheduleCatchUp(110);
    await settle(() => processor.checkpoint === 110);

    // pipeline alone missed the redelegate in the dead block
    expect(broadcasts.map((a) => a.kind).sort()).toEqual(
      EXPECTED_KINDS.filter((k) => k !== "redelegate"),
    );

    await backfiller.sweep(processor.checkpoint); // the 5-minute safety net
    expect(broadcasts.map((a) => a.kind).sort()).toEqual(EXPECTED_KINDS);
    expect(broadcasts.filter((a) => a.kind === "redelegate")).toHaveLength(1);

    await backfiller.sweep(processor.checkpoint); // sweeping again adds nothing
    expect(broadcasts).toHaveLength(9);
  });

  it("crash mid-stream + restart: remaining blocks healed, zero duplicates", async () => {
    tmp = mkdtempSync(join(tmpdir(), "zigmon-"));
    const files = {
      stateFile: join(tmp, "state.json"),
      backfillStateFile: join(tmp, "backfill.json"),
      dedupeFile: join(tmp, "seen.json"),
    };
    const blocks = buildChain();

    // run 1: processes up to block 105, then "crashes"
    const run1 = makeHarness(chainRpc(blocks), files);
    run1.processor.init(100);
    run1.processor.scheduleCatchUp(105);
    await settle(() => run1.processor.checkpoint === 105);
    expect(run1.broadcasts.map((a) => a.kind).sort()).toEqual(
      ["delegate", "send", "undelegate", "redelegate"].sort(),
    );

    // run 2: fresh instances load persisted state; blocks 106-110 were "missed while down"
    const run2 = makeHarness(chainRpc(blocks), files, run1.broadcasts);
    run2.processor.init(999999); // persisted checkpoint (105) must win over this
    expect(run2.processor.checkpoint).toBe(105);
    run2.processor.scheduleCatchUp(110);
    await settle(() => run2.processor.checkpoint === 110);
    // full backfill re-sweep over everything must not re-alert
    run2.backfiller.init(100);
    await run2.backfiller.sweep(110);

    expect(run2.broadcasts).toHaveLength(9);
    expect(run2.broadcasts.map((a) => a.kind).sort()).toEqual(EXPECTED_KINDS);
  });
});
