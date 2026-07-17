import { readFileSync, writeFileSync } from "node:fs";
import { TRANSFER_TOPIC, addressTopic } from "./erc20.js";
import { logToAlert } from "./processLog.js";
import type { FallbackRpcProvider } from "./rpcProvider.js";
import type { EthConfig } from "../ethConfig.js";
import type { TransferAlert } from "./types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface EthBackfillOptions {
  rpc: FallbackRpcProvider;
  config: EthConfig;
  /** Returns true if this alert was new (not a dedupe hit) — used to count /verify results. */
  dispatch: (alert: TransferAlert) => Promise<boolean>;
  maxRetries?: number;
  baseRetryDelayMs?: number;
  log?: (msg: string) => void;
}

/**
 * HTTP polling safety net behind the WebSocket path: every pollIntervalMs,
 * fetches the latest block and re-scans (lastProcessedBlock, latest] via
 * eth_getLogs for Transfers touching any watched wallet — chunked by
 * maxBlockRange since public RPCs cap how many blocks getLogs can span, and
 * held back by `confirmations` blocks to reduce reorg risk. Whatever the
 * WebSocket path already alerted gets deduped away by the shared deduper.
 */
export class EthBackfiller {
  private lastProcessedBlock = 0;
  private pollTimer: NodeJS.Timeout | null = null;
  private readonly maxRetries: number;
  private readonly baseRetryDelayMs: number;
  private readonly log: (msg: string) => void;

  constructor(private readonly opts: EthBackfillOptions) {
    this.maxRetries = opts.maxRetries ?? 5;
    this.baseRetryDelayMs = opts.baseRetryDelayMs ?? 500;
    this.log = opts.log ?? ((m) => console.log(m));
  }

  async init(): Promise<void> {
    let persisted: number | undefined;
    if (this.opts.config.stateFile) {
      try {
        const raw = JSON.parse(readFileSync(this.opts.config.stateFile, "utf8"));
        if (typeof raw.lastProcessedBlock === "number") persisted = raw.lastProcessedBlock;
      } catch {
        // no state yet
      }
    }
    if (persisted !== undefined) {
      this.lastProcessedBlock = persisted;
      return;
    }
    const latest = await this.opts.rpc.getBlockNumber();
    this.lastProcessedBlock = this.opts.config.jumpToTipOnBoot
      ? latest
      : Math.max(0, latest - this.opts.config.maxBacklogBlocks);
    this.log(`[eth-backfill] no persisted state, starting after block ${this.lastProcessedBlock}`);
  }

  get checkpoint(): number {
    return this.lastProcessedBlock;
  }

  start(): void {
    this.pollTimer = setInterval(() => void this.poll(), this.opts.config.pollIntervalMs);
    void this.poll();
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  private async poll(): Promise<void> {
    try {
      const latest = await this.opts.rpc.getBlockNumber();
      const safeTip = latest - this.opts.config.confirmations;
      if (safeTip <= this.lastProcessedBlock) return;

      let from = this.lastProcessedBlock + 1;
      while (from <= safeTip) {
        const to = Math.min(from + this.opts.config.maxBlockRange - 1, safeTip);
        await this.processRangeWithRetry(from, to);
        this.lastProcessedBlock = to;
        this.saveState();
        from = to + 1;
      }
    } catch (e) {
      console.error(`[eth-backfill] poll failed: ${String(e)}`);
    }
  }

  private async processRangeWithRetry(from: number, to: number): Promise<void> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        await this.processRange(from, to);
        return;
      } catch (e) {
        if (attempt === this.maxRetries) {
          console.error(
            `[eth-backfill] blocks ${from}-${to} failed after ${attempt} attempts, skipping: ${String(e)}`,
          );
          return;
        }
        const delay = this.baseRetryDelayMs * 2 ** (attempt - 1);
        await sleep(delay);
      }
    }
  }

  /**
   * Pure range scan — fetches + decodes matching transfers with no dispatch
   * side effect, so callers decide themselves what to do with the results
   * (background polling dispatches+broadcasts each one; /verify inspects
   * them privately instead, see EthMonitor.verifyRange).
   */
  async scanRange(from: number, to: number): Promise<TransferAlert[]> {
    const { rpc, config } = this.opts;
    const walletTopics = config.wallets.map(addressTopic);

    const [outgoing, incoming] = await Promise.all([
      rpc.getLogs({
        address: config.tokenAddress,
        topics: [TRANSFER_TOPIC, walletTopics, null],
        fromBlock: from,
        toBlock: to,
      }),
      rpc.getLogs({
        address: config.tokenAddress,
        topics: [TRANSFER_TOPIC, null, walletTopics],
        fromBlock: from,
        toBlock: to,
      }),
    ]);

    const seenInBatch = new Set<string>();
    const alerts: TransferAlert[] = [];
    for (const log of [...outgoing, ...incoming]) {
      const key = `${log.transactionHash}:${log.index}`;
      if (seenInBatch.has(key)) continue; // a wallet-to-wallet transfer between two watched wallets
      seenInBatch.add(key);

      const alert = logToAlert(log, config);
      if (alert) alerts.push(alert);
    }
    return alerts;
  }

  /** Used by the background poll loop — scans then dispatches+broadcasts each new alert. */
  async processRange(from: number, to: number): Promise<number> {
    const alerts = await this.scanRange(from, to);
    let dispatched = 0;
    for (const alert of alerts) {
      if (await this.opts.dispatch(alert)) dispatched++;
    }
    return dispatched;
  }

  private saveState(): void {
    if (!this.opts.config.stateFile) return;
    try {
      writeFileSync(
        this.opts.config.stateFile,
        JSON.stringify({ lastProcessedBlock: this.lastProcessedBlock }),
      );
    } catch (e) {
      console.error(`[eth-backfill] failed to persist state: ${String(e)}`);
    }
  }
}
