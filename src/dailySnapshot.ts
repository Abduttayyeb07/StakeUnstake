import { readFileSync, writeFileSync } from "node:fs";
import type { RpcClient } from "./rpc.js";
import type { SheetsClient } from "./sheets.js";
import { formatMicroAmount, formatRewardAmount } from "./format.js";

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000; // Pakistan Time is UTC+5, no DST

/** The PKT calendar date ("YYYY-MM-DD") that a given UTC instant falls on. */
export function pktDateString(date: Date): string {
  const shifted = new Date(date.getTime() + PKT_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** The next real UTC instant at which the PKT wall clock reads 00:00:00. */
export function nextPktMidnight(now: Date): Date {
  const shifted = new Date(now.getTime() + PKT_OFFSET_MS);
  const nextBoundaryShifted = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1,
  );
  return new Date(nextBoundaryShifted - PKT_OFFSET_MS);
}

export interface DailySnapshotOptions {
  rpc: RpcClient;
  sheets: SheetsClient;
  /** address -> sheet tab name, e.g. "Deal 1" */
  walletLabels: Record<string, string>;
  stZigDenom: string;
  stateFile?: string;
  log?: (msg: string) => void;
}

/**
 * Once every PKT midnight, appends one snapshot row per labeled wallet to
 * its sheet tab: ZIG balance, stZIG balance, total delegation, and total
 * pending rewards, all live-queried at that moment. Independent of, and
 * never delays or breaks, Telegram alerting.
 */
export class DailySnapshotScheduler {
  private lastSnapshotDate: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly log: (msg: string) => void;

  constructor(private readonly opts: DailySnapshotOptions) {
    this.log = opts.log ?? ((m) => console.log(m));
  }

  init(): void {
    if (this.opts.stateFile) {
      try {
        const raw = JSON.parse(readFileSync(this.opts.stateFile, "utf8"));
        if (typeof raw.lastSnapshotDate === "string") this.lastSnapshotDate = raw.lastSnapshotDate;
      } catch {
        // no state yet
      }
    }
    this.warnIfGapSinceLastSnapshot();
  }

  /**
   * If the bot was down across one or more PKT midnights, that day's row is
   * skipped rather than backfilled with today's (wrong) live balances — but
   * it's surfaced loudly here instead of silently vanishing from the sheet.
   */
  private warnIfGapSinceLastSnapshot(): void {
    if (!this.lastSnapshotDate) return;
    const today = pktDateString(new Date());
    const daysSince = Math.round(
      (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${this.lastSnapshotDate}T00:00:00Z`)) /
        86_400_000,
    );
    if (daysSince > 1) {
      console.warn(
        `[snapshot] last daily snapshot was ${this.lastSnapshotDate} (${daysSince - 1} day(s) missed while ` +
          "down) — those rows will NOT be backfilled since balances are only knowable live, not retroactively",
      );
    }
  }

  start(): void {
    this.scheduleNext();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  private scheduleNext(): void {
    const now = new Date();
    const boundary = nextPktMidnight(now);
    const delay = boundary.getTime() - now.getTime();
    const reportDate = pktDateString(new Date(boundary.getTime() - 1)); // the PKT day that's ending
    this.log(`[snapshot] next daily snapshot (for ${reportDate}) in ${Math.round(delay / 60_000)} min`);
    this.timer = setTimeout(() => {
      void this.run(reportDate).finally(() => this.scheduleNext());
    }, delay);
  }

  private async run(reportDate: string): Promise<void> {
    if (this.lastSnapshotDate === reportDate) return; // already done (e.g. restarted right at midnight)

    const entries = Object.entries(this.opts.walletLabels);
    if (entries.length === 0) {
      this.log("[snapshot] no labeled wallets (WALLET_ADDRESS=\"Name:address\") — nothing to log");
      return;
    }

    this.log(`[snapshot] running daily snapshot for ${reportDate} (${entries.length} wallet(s))`);
    for (const [address, sheetName] of entries) {
      try {
        const [zig, stzig, delegation, rewards] = await Promise.all([
          this.opts.rpc.getBalance(address),
          this.opts.rpc.getBalance(address, this.opts.stZigDenom),
          this.opts.rpc.getTotalDelegation(address),
          this.opts.rpc.getTotalRewards(address),
        ]);
        await this.opts.sheets.appendRow(sheetName, {
          address,
          day: reportDate,
          zigBalance: formatMicroAmount(zig),
          stZigBalance: formatMicroAmount(stzig),
          delegation: formatMicroAmount(delegation),
          dailyRewards: formatRewardAmount(rewards),
        });
        this.log(`[snapshot] logged ${sheetName} (${address}) for ${reportDate}`);
      } catch (e) {
        console.error(`[snapshot] failed for ${sheetName} (${address}) on ${reportDate}: ${String(e)}`);
      }
    }

    this.lastSnapshotDate = reportDate;
    this.saveState();
  }

  private saveState(): void {
    if (!this.opts.stateFile) return;
    try {
      writeFileSync(this.opts.stateFile, JSON.stringify({ lastSnapshotDate: this.lastSnapshotDate }));
    } catch (e) {
      console.error(`[snapshot] failed to persist state: ${String(e)}`);
    }
  }
}
