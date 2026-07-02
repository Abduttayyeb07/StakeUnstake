import { describe, expect, it, vi } from "vitest";
import { Backfiller } from "../src/backfill.js";
import { AlertDeduper } from "../src/dedupe.js";
import type { RpcClient, TxSearchEntry } from "../src/rpc.js";
import type { Alert } from "../src/types.js";
import { WALLET, VALIDATOR, buildTxBase64, msgs } from "./helpers.js";

function makeEntry(height: number): TxSearchEntry {
  return {
    hash: "ABC123",
    height,
    tx: buildTxBase64([msgs.delegate(WALLET, VALIDATOR, "4000000000")]),
    txResult: { code: 0, events: [] },
  };
}

function mockRpcWithTxs(entries: TxSearchEntry[]): RpcClient {
  return {
    txSearch: vi.fn(async (query: string) => {
      // only the message.sender query matches our delegate tx
      const txs = query.includes("message.sender") ? entries : [];
      return { txs, totalCount: txs.length };
    }),
  } as unknown as RpcClient;
}

describe("Backfiller", () => {
  it("recovers a tx the pipeline missed and alerts it", async () => {
    const rpc = mockRpcWithTxs([makeEntry(105)]);
    const dispatched: Alert[] = [];
    const b = new Backfiller({
      rpc,
      wallets: [WALLET],
      dispatch: async (a) => void dispatched.push(a),
      log: () => {},
    });
    b.init(100);
    await b.sweep(110);

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ kind: "delegate", height: 105 });
    expect(b.cursor).toBe(110);
    // queries covered exactly the pipeline's finished range
    const queries = (rpc.txSearch as any).mock.calls.map((c: any[]) => c[0]);
    expect(queries.every((q: string) => q.includes("tx.height>100 AND tx.height<=110"))).toBe(true);
  });

  it("does not advance the cursor when a sweep fails, so the range is retried", async () => {
    const rpc = {
      txSearch: vi.fn(async () => {
        throw new Error("rpc down");
      }),
    } as unknown as RpcClient;
    const b = new Backfiller({ rpc, wallets: [WALLET], dispatch: async () => {}, log: () => {} });
    b.init(100);
    await b.sweep(110);
    expect(b.cursor).toBe(100); // unchanged — next tick retries 101-110
  });

  it("skips sweeps with nothing new", async () => {
    const rpc = mockRpcWithTxs([]);
    const b = new Backfiller({ rpc, wallets: [WALLET], dispatch: async () => {}, log: () => {} });
    b.init(100);
    await b.sweep(100);
    expect(rpc.txSearch).not.toHaveBeenCalled();
  });
});

describe("AlertDeduper", () => {
  const alert: Alert = {
    kind: "delegate",
    wallet: WALLET,
    delegator: WALLET,
    validator: VALIDATOR,
    amount: { denom: "uzig", amount: "4000000000" },
    height: 105,
    txHash: "F".repeat(64),
  };

  it("passes an alert once and blocks the duplicate", () => {
    const d = new AlertDeduper();
    expect(d.markSeen(alert)).toBe(true);
    expect(d.markSeen(alert)).toBe(false);
    expect(d.markSeen({ ...alert, height: 106 })).toBe(true); // different alert passes
  });

  it("the same tx discovered by two paths produces exactly one alert", async () => {
    const d = new AlertDeduper();
    const broadcasts: Alert[] = [];
    const dispatch = async (a: Alert) => {
      if (d.markSeen(a)) broadcasts.push(a);
    };
    const rpc = mockRpcWithTxs([makeEntry(105)]);

    // two independent sweeps over the same range parse the same tx twice
    // (same as the block pipeline and the backfill both finding it)
    const b1 = new Backfiller({ rpc, wallets: [WALLET], dispatch, log: () => {} });
    b1.init(100);
    await b1.sweep(110);
    const b2 = new Backfiller({ rpc, wallets: [WALLET], dispatch, log: () => {} });
    b2.init(100);
    await b2.sweep(110);

    expect(broadcasts).toHaveLength(1);
  });
});
