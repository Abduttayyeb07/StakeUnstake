import { readFileSync, writeFileSync } from "node:fs";
import type { RpcClient } from "./rpc.js";
import type { TxResult } from "./types.js";

export interface BlockTxContext {
  height: number;
  txIndex: number;
  txBase64: string;
  txResult: TxResult;
}

export interface BlockProcessorOptions {
  rpc: RpcClient;
  onTx: (ctx: BlockTxContext) => Promise<void>;
  stateFile?: string;
  maxRetries?: number;
  baseRetryDelayMs?: number;
  log?: (msg: string) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sequential block queue with gap healing. Both the WebSocket and the polling
 * fallback call scheduleCatchUp(height); every block from the checkpoint to
 * the latest reported height is processed exactly once, in order.
 */
export class BlockProcessor {
  private lastProcessed = 0;
  private targetHeight = 0;
  private draining = false;
  private readonly maxRetries: number;
  private readonly baseRetryDelayMs: number;
  private readonly log: (msg: string) => void;

  constructor(private readonly opts: BlockProcessorOptions) {
    this.maxRetries = opts.maxRetries ?? 5;
    this.baseRetryDelayMs = opts.baseRetryDelayMs ?? 500;
    this.log = opts.log ?? ((m) => console.log(m));
  }

  /** Resume from persisted checkpoint if present, else start after startHeight. */
  init(startHeight: number): void {
    let persisted: number | undefined;
    if (this.opts.stateFile) {
      try {
        const raw = JSON.parse(readFileSync(this.opts.stateFile, "utf8"));
        if (typeof raw.lastProcessedHeight === "number") persisted = raw.lastProcessedHeight;
      } catch {
        // no state yet
      }
    }
    this.lastProcessed = persisted ?? startHeight;
    this.targetHeight = this.lastProcessed;
    this.log(`[processor] starting after block ${this.lastProcessed}`);
  }

  get checkpoint(): number {
    return this.lastProcessed;
  }

  scheduleCatchUp(height: number): void {
    if (height > this.targetHeight) this.targetHeight = height;
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      if (this.targetHeight - this.lastProcessed > 1) {
        this.log(`[processor] catching up blocks ${this.lastProcessed + 1} -> ${this.targetHeight}`);
      }
      while (this.lastProcessed < this.targetHeight) {
        const next = this.lastProcessed + 1;
        await this.processWithRetry(next);
        this.lastProcessed = next;
        this.saveState();
      }
    } finally {
      this.draining = false;
    }
  }

  private saveState(): void {
    if (!this.opts.stateFile) return;
    try {
      writeFileSync(
        this.opts.stateFile,
        JSON.stringify({ lastProcessedHeight: this.lastProcessed }),
      );
    } catch (e) {
      this.log(`[processor] failed to persist state: ${String(e)}`);
    }
  }

  private async processWithRetry(height: number): Promise<void> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        await this.processBlock(height);
        return;
      } catch (e) {
        if (attempt === this.maxRetries) {
          this.log(`[processor] block ${height} failed after ${attempt} attempts, skipping: ${String(e)}`);
          return;
        }
        const delay = this.baseRetryDelayMs * 2 ** (attempt - 1);
        this.log(`[processor] block ${height} attempt ${attempt} failed (${String(e)}), retrying in ${delay}ms`);
        await sleep(delay);
      }
    }
  }

  private async processBlock(height: number): Promise<void> {
    const [block, results] = await Promise.all([
      this.opts.rpc.getBlock(height),
      this.opts.rpc.getBlockResults(height),
    ]);

    for (let i = 0; i < block.txs.length; i++) {
      const txResult = results.txsResults[i];
      if (!txResult) continue;
      if (txResult.code !== 0) continue; // failed tx
      await this.opts.onTx({ height, txIndex: i, txBase64: block.txs[i], txResult });
    }
  }
}
