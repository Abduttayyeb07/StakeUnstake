/**
 * In-memory dedupe across the WebSocket and HTTP-backfill detection paths —
 * both can observe the same log, so a txHash:logIndex key ensures each
 * transfer is alerted exactly once per process lifetime. Not persisted
 * (matches spec): a restart relies on the persisted last-processed-block
 * instead, so already-alerted transfers aren't re-scanned anyway.
 */
export class EthAlertDeduper {
  private seen = new Set<string>();

  constructor(private readonly maxEntries = 50_000) {}

  /** Returns true if this is a new transfer (and records it), false if already alerted. */
  markSeen(txHash: string, logIndex: number): boolean {
    const key = `${txHash}:${logIndex}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    if (this.seen.size > this.maxEntries) {
      const excess = this.seen.size - this.maxEntries;
      const it = this.seen.values();
      for (let i = 0; i < excess; i++) this.seen.delete(it.next().value as string);
    }
    return true;
  }
}
