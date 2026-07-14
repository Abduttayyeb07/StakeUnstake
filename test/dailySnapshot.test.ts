import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DailySnapshotScheduler, nextPktMidnight, pktDateString } from "../src/dailySnapshot.js";
import type { RpcClient } from "../src/rpc.js";
import type { SheetsClient, SnapshotRow } from "../src/sheets.js";
import { WALLET, OTHER } from "./helpers.js";

describe("pktDateString", () => {
  it("reads the PKT (UTC+5) calendar date for a UTC instant", () => {
    // 2026-07-14T20:00:00Z + 5h = 2026-07-15T01:00 PKT
    expect(pktDateString(new Date("2026-07-14T20:00:00Z"))).toBe("2026-07-15");
    // 2026-07-14T18:59:59Z + 5h = 2026-07-14T23:59:59 PKT (still the same day)
    expect(pktDateString(new Date("2026-07-14T18:59:59Z"))).toBe("2026-07-14");
  });
});

describe("nextPktMidnight", () => {
  it("returns the next UTC instant at which PKT reads 00:00:00", () => {
    // PKT midnight = UTC 19:00 the previous day (UTC+5)
    const now = new Date("2026-07-14T10:00:00Z"); // 15:00 PKT
    const next = nextPktMidnight(now);
    expect(next.toISOString()).toBe("2026-07-14T19:00:00.000Z");
    expect(pktDateString(next)).toBe("2026-07-15");
  });

  it("rolls over correctly when already exactly at a boundary", () => {
    const atBoundary = new Date("2026-07-14T19:00:00.000Z"); // exactly 00:00 PKT on the 15th
    const next = nextPktMidnight(atBoundary);
    expect(next.toISOString()).toBe("2026-07-15T19:00:00.000Z");
  });
});

function mockRpc(zig: string, stzig: string, delegation: string, rewards: string): RpcClient {
  return {
    getBalance: vi.fn(async (_addr: string, denom?: string) => (denom ? stzig : zig)),
    getTotalDelegation: vi.fn(async () => delegation),
    getTotalRewards: vi.fn(async () => rewards),
  } as unknown as RpcClient;
}

function mockSheets(): { sheets: SheetsClient; rows: Array<{ sheetName: string; row: SnapshotRow }> } {
  const rows: Array<{ sheetName: string; row: SnapshotRow }> = [];
  const sheets = {
    appendRow: vi.fn(async (sheetName: string, row: SnapshotRow) => {
      rows.push({ sheetName, row });
    }),
  } as unknown as SheetsClient;
  return { sheets, rows };
}

let tmp: string | null = null;
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

describe("DailySnapshotScheduler.run (via forced private access through start/stop timing)", () => {
  it("appends one row per labeled wallet with the live-queried snapshot", async () => {
    const rpc = mockRpc("368010267", "0", "2063446743643", "3819793475364130204838114498");
    const { sheets, rows } = mockSheets();
    const scheduler = new DailySnapshotScheduler({
      rpc,
      sheets,
      walletLabels: { [WALLET]: "Deal 1" },
      stZigDenom: "stzig-denom",
      log: () => {},
    });
    scheduler.init();
    // @ts-expect-error -- calling the private method directly to test row content deterministically
    await scheduler.run("2026-07-14");

    expect(rows).toHaveLength(1);
    expect(rows[0].sheetName).toBe("Deal 1");
    expect(rows[0].row).toEqual({
      address: WALLET,
      day: "2026-07-14",
      zigBalance: "368.010267",
      stZigBalance: "0",
      delegation: "2,063,446.743643",
      dailyRewards: "3,819.793475",
    });
  });

  it("skips wallets with no label and logs a warning", async () => {
    const rpc = mockRpc("0", "0", "0", "0");
    const { sheets, rows } = mockSheets();
    const scheduler = new DailySnapshotScheduler({
      rpc,
      sheets,
      walletLabels: {}, // OTHER has no label
      stZigDenom: "stzig-denom",
      log: () => {},
    });
    scheduler.init();
    // @ts-expect-error -- private
    await scheduler.run("2026-07-14");

    expect(rows).toHaveLength(0);
    expect(sheets.appendRow).not.toHaveBeenCalled();
  });

  it("does not double-write if run() is called twice for the same date", async () => {
    const rpc = mockRpc("1000000", "0", "0", "0");
    const { sheets, rows } = mockSheets();
    const scheduler = new DailySnapshotScheduler({
      rpc,
      sheets,
      walletLabels: { [WALLET]: "Deal 1" },
      stZigDenom: "stzig-denom",
      log: () => {},
    });
    scheduler.init();
    // @ts-expect-error -- private
    await scheduler.run("2026-07-14");
    // @ts-expect-error -- private
    await scheduler.run("2026-07-14"); // e.g. restart landing on the same boundary

    expect(rows).toHaveLength(1);
  });

  it("persists lastSnapshotDate and resumes it across a restart", async () => {
    tmp = mkdtempSync(join(tmpdir(), "zigmon-snap-"));
    const stateFile = join(tmp, "snapshot-state.json");
    const rpc = mockRpc("1000000", "0", "0", "0");
    const { sheets: sheets1, rows: rows1 } = mockSheets();

    const run1 = new DailySnapshotScheduler({
      rpc, sheets: sheets1, walletLabels: { [WALLET]: "Deal 1" }, stZigDenom: "d", stateFile, log: () => {},
    });
    run1.init();
    // @ts-expect-error -- private
    await run1.run("2026-07-14");
    expect(rows1).toHaveLength(1);

    // fresh process, same state file
    const { sheets: sheets2, rows: rows2 } = mockSheets();
    const run2 = new DailySnapshotScheduler({
      rpc, sheets: sheets2, walletLabels: { [WALLET]: "Deal 1" }, stZigDenom: "d", stateFile, log: () => {},
    });
    run2.init();
    // @ts-expect-error -- private
    await run2.run("2026-07-14"); // same date already logged before the restart
    expect(rows2).toHaveLength(0);

    // a genuinely new day still logs
    // @ts-expect-error -- private
    await run2.run("2026-07-15");
    expect(rows2).toHaveLength(1);
  });
});
