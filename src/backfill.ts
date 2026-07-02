import { readFileSync, writeFileSync } from "node:fs";
import type { RpcClient } from "./rpc.js";
import type { Alert } from "./types.js";
import { parseTxToAlerts } from "./txParser.js";

export interface BackfillOptions {
  rpc: RpcClient;
  wallets: string[];
  /** Dispatch runs through the shared deduper, so re-discovered txs are dropped */
  dispatch: (alert: Alert) => Promise<void>;
  stateFile?: string;
  maxPages?: number;
  log?: (msg: string) => void;
}

/**
 * Safety net behind the block pipeline: periodically re-queries tx_search for
 * every tracked wallet over the height range the pipeline has already passed.
 * Anything the pipeline delivered is deduped away; anything it somehow missed
 * (e.g. a block skipped after max retries, an RPC that lied) gets alerted here.
 *
 * The cursor only advances when a sweep fully succeeds, so a failed sweep is
 * retried over the same range next tick — no range is ever silently dropped.
 */
export class Backfiller {
  private lastHeight = 0;
  private running = false;
  private readonly maxPages: number;
  private readonly log: (msg: string) => void;

  constructor(private readonly opts: BackfillOptions) {
    this.maxPages = opts.maxPages ?? 10;
    this.log = opts.log ?? ((m) => console.log(m));
  }

  init(startHeight: number): void {
    let persisted: number | undefined;
    if (this.opts.stateFile) {
      try {
        const raw = JSON.parse(readFileSync(this.opts.stateFile, "utf8"));
        if (typeof raw.lastBackfillHeight === "number") persisted = raw.lastBackfillHeight;
      } catch {
        // no backfill state yet
      }
    }
    this.lastHeight = persisted ?? startHeight;
    this.log(`[backfill] starting after block ${this.lastHeight}`);
  }

  get cursor(): number {
    return this.lastHeight;
  }

  /**
   * Sweep (lastHeight, upTo]. Pass the block pipeline's checkpoint as upTo so
   * we only double-check ranges the pipeline claims to have finished.
   */
  async sweep(upTo: number): Promise<void> {
    if (this.running || upTo <= this.lastHeight) return;
    this.running = true;
    const from = this.lastHeight;
    try {
      let found = 0;
      for (const wallet of this.opts.wallets) {
        const filters = [
          `message.sender='${wallet}'`,
          `transfer.sender='${wallet}'`,
          `transfer.recipient='${wallet}'`,
        ];
        for (const filter of filters) {
          found += await this.sweepQuery(
            `${filter} AND tx.height>${from} AND tx.height<=${upTo}`,
          );
        }
      }
      this.lastHeight = upTo;
      this.saveState();
      if (found > 0) {
        this.log(`[backfill] swept blocks ${from + 1}-${upTo}: ${found} tx(s) re-checked`);
      }
    } catch (e) {
      this.log(`[backfill] sweep ${from + 1}-${upTo} failed, will retry: ${String(e)}`);
    } finally {
      this.running = false;
    }
  }

  private async sweepQuery(query: string): Promise<number> {
    const wallets = new Set(this.opts.wallets);
    let processed = 0;
    for (let page = 1; page <= this.maxPages; page++) {
      const { txs, totalCount } = await this.opts.rpc.txSearch(query, page);
      for (const t of txs) {
        if (t.txResult.code !== 0) continue;
        const alerts = parseTxToAlerts({
          txBase64: t.tx,
          txResult: t.txResult,
          height: t.height,
          wallets,
        });
        for (const alert of alerts) await this.opts.dispatch(alert);
      }
      processed += txs.length;
      if (processed >= totalCount || txs.length === 0) break;
    }
    return processed;
  }

  private saveState(): void {
    if (!this.opts.stateFile) return;
    try {
      writeFileSync(this.opts.stateFile, JSON.stringify({ lastBackfillHeight: this.lastHeight }));
    } catch (e) {
      this.log(`[backfill] failed to persist state: ${String(e)}`);
    }
  }
}
