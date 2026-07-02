import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import type { Alert } from "./types.js";

/**
 * Stable content key for an alert. The block pipeline and the backfill sweep
 * both build alerts through the same parser from the same tx bytes/events,
 * so identical alerts always produce identical keys.
 */
export function alertKey(alert: Alert): string {
  return createHash("sha256").update(JSON.stringify(alert)).digest("hex");
}

/**
 * Persistent seen-alert set. markSeen() returns false when the alert was
 * already delivered, so an alert is broadcast exactly once no matter how many
 * paths (block pipeline, backfill, restart replays) discover the same tx.
 */
export class AlertDeduper {
  private seen = new Set<string>();

  constructor(
    private readonly filePath?: string,
    private readonly maxEntries = 20_000,
  ) {
    if (filePath) {
      try {
        const keys = JSON.parse(readFileSync(filePath, "utf8"));
        if (Array.isArray(keys)) this.seen = new Set(keys.map(String));
      } catch {
        // no dedupe file yet
      }
    }
  }

  /** Returns true if this alert is new (and records it), false if a duplicate. */
  markSeen(alert: Alert): boolean {
    const key = alertKey(alert);
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    if (this.seen.size > this.maxEntries) {
      // drop oldest entries (Set preserves insertion order)
      const excess = this.seen.size - this.maxEntries;
      const it = this.seen.values();
      for (let i = 0; i < excess; i++) this.seen.delete(it.next().value as string);
    }
    this.persist();
    return true;
  }

  private persist(): void {
    if (!this.filePath) return;
    try {
      writeFileSync(this.filePath, JSON.stringify([...this.seen]));
    } catch (e) {
      console.error(`[dedupe] failed to persist: ${String(e)}`);
    }
  }
}
