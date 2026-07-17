import { describe, expect, it, vi } from "vitest";
import { EthBackfiller } from "../../src/eth/backfill.js";
import { EthAlertDeduper } from "../../src/eth/dedupe.js";
import { loadEthConfig } from "../../src/ethConfig.js";
import { makeTransferLog, TOKEN, WALLET1, OTHER } from "./helpers.js";
import type { FallbackRpcProvider } from "../../src/eth/rpcProvider.js";
import type { TransferAlert } from "../../src/eth/types.js";

function config() {
  return loadEthConfig({
    ETH_RPC_URLS: "https://x.test",
    WATCHED_WALLETS: `Deal 1 (eth)=${WALLET1}`,
    ZIG_TOKEN_ADDRESS: TOKEN,
    ETH_STATE_FILE: "",
  });
}

function mockRpc(log: ReturnType<typeof makeTransferLog>): FallbackRpcProvider {
  return {
    getLogs: vi.fn(async ({ topics }: any) => {
      const isOutgoing = Array.isArray(topics[1]);
      const fromMatches = log.topics[1]?.toLowerCase().includes(WALLET1.slice(2).toLowerCase());
      return isOutgoing === !!fromMatches ? [log] : [];
    }),
  } as unknown as FallbackRpcProvider;
}

/** Mirrors exactly what EthMonitor.verifyRange does on top of scanRange + a shared deduper. */
async function verifyRange(
  backfiller: EthBackfiller,
  deduper: EthAlertDeduper,
  from: number,
  to: number,
): Promise<Array<{ alert: TransferAlert; isNew: boolean }>> {
  const alerts = await backfiller.scanRange(from, to);
  return alerts.map((alert) => ({ alert, isNew: deduper.markSeen(alert.txHash, alert.logIndex) }));
}

describe("scanRange (used by /verify)", () => {
  it("returns alerts without any dispatch/broadcast side effect", async () => {
    const log = makeTransferLog(OTHER, WALLET1, 1_000000000000000000n, { blockNumber: 100 });
    const rpc = mockRpc(log);
    const backfiller = new EthBackfiller({ rpc, config: config(), dispatch: async () => true, log: () => {} });

    const alerts = await backfiller.scanRange(100, 100);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ direction: "in", wallet: WALLET1 });
  });
});

describe("verify-range dedupe tagging (isNew vs historical)", () => {
  it("tags a freshly found transfer as new, a re-scan of the same transfer as historical", async () => {
    const log = makeTransferLog(OTHER, WALLET1, 1_000000000000000000n, { blockNumber: 100 });
    const rpc = mockRpc(log);
    const backfiller = new EthBackfiller({ rpc, config: config(), dispatch: async () => true, log: () => {} });
    const deduper = new EthAlertDeduper();

    const first = await verifyRange(backfiller, deduper, 100, 100);
    expect(first).toHaveLength(1);
    expect(first[0].isNew).toBe(true);

    const second = await verifyRange(backfiller, deduper, 100, 100);
    expect(second).toHaveLength(1);
    expect(second[0].isNew).toBe(false); // same tx, already known — must be tagged historical
    expect(second[0].alert.txHash).toBe(first[0].alert.txHash);
  });

  it("a transfer already alerted via the live pipeline is tagged historical on /verify too", async () => {
    const log = makeTransferLog(OTHER, WALLET1, 1_000000000000000000n, { blockNumber: 100 });
    const rpc = mockRpc(log);
    const deduper = new EthAlertDeduper();

    // simulate the live WS/backfill path already having alerted this tx
    deduper.markSeen(log.transactionHash, log.index);

    const backfiller = new EthBackfiller({ rpc, config: config(), dispatch: async () => true, log: () => {} });
    const result = await verifyRange(backfiller, deduper, 100, 100);
    expect(result[0].isNew).toBe(false);
  });
});
