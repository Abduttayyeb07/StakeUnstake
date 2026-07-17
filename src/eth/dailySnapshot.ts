import { readFileSync, writeFileSync } from "node:fs";
import { pktDateString, nextPktMidnight } from "../dailySnapshot.js";
import { formatTokenAmount } from "../format.js";
import type { SheetsClient } from "../sheets.js";
import type { FallbackRpcProvider } from "./rpcProvider.js";
import { getTokenBalance } from "./balance.js";
import type { EthConfig } from "../ethConfig.js";

export interface EthDailySnapshotOptions {
  rpc: FallbackRpcProvider;
  sheets: SheetsClient;
  config: EthConfig;
  stateFile?: string;
  log?: (msg: string) => void;
}

/**
 * Once every PKT midnight, appends an Address/Day/Balance row per watched
 * ETH wallet to its own sheet tab (e.g. "Deal 1 (eth)") — same midnight-PKT
 * cadence as the Cosmos daily snapshot, but only 3 columns since that's all
 * that was asked for here.
 */
export class EthDailySnapshotScheduler {
  private lastSnapshotDate: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly log: (msg: string) => void;

  constructor(private readonly opts: EthDailySnapshotOptions) {
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
    const reportDate = pktDateString(new Date(boundary.getTime() - 1));
    this.log(`[eth-snapshot] next daily snapshot (for ${reportDate}) in ${Math.round(delay / 60_000)} min`);
    this.timer = setTimeout(() => {
      void this.run(reportDate).finally(() => this.scheduleNext());
    }, delay);
  }

  private async run(reportDate: string): Promise<void> {
    if (this.lastSnapshotDate === reportDate) return;

    const entries = Object.entries(this.opts.config.walletLabels);
    if (entries.length === 0) {
      this.log('[eth-snapshot] no labeled wallets (WATCHED_WALLETS="Name=address") — nothing to log');
      return;
    }

    this.log(`[eth-snapshot] running daily snapshot for ${reportDate} (${entries.length} wallet(s))`);
    for (const [address, sheetName] of entries) {
      try {
        const raw = await getTokenBalance(this.opts.rpc, this.opts.config.tokenAddress, address);
        const balance = `${formatTokenAmount(raw, this.opts.config.tokenDecimals)} ${this.opts.config.tokenSymbol}`;
        await this.opts.sheets.appendValues(sheetName, "A:C", [address, reportDate, balance]);
        this.log(`[eth-snapshot] logged ${sheetName} (${address}) for ${reportDate}`);
      } catch (e) {
        console.error(`[eth-snapshot] failed for ${sheetName} (${address}) on ${reportDate}: ${String(e)}`);
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
      console.error(`[eth-snapshot] failed to persist state: ${String(e)}`);
    }
  }
}
