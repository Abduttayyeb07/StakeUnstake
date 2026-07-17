import { describe, expect, it } from "vitest";
import { EthAlertDeduper } from "../../src/eth/dedupe.js";

describe("EthAlertDeduper", () => {
  it("passes a txHash:logIndex pair once and blocks the duplicate", () => {
    const d = new EthAlertDeduper();
    expect(d.markSeen("0xabc", 0)).toBe(true);
    expect(d.markSeen("0xabc", 0)).toBe(false);
  });

  it("treats different logIndex on the same tx as distinct", () => {
    const d = new EthAlertDeduper();
    expect(d.markSeen("0xabc", 0)).toBe(true);
    expect(d.markSeen("0xabc", 1)).toBe(true);
  });

  it("the same transfer discovered via WS and backfill dedupes to one", () => {
    const d = new EthAlertDeduper();
    const wsResult = d.markSeen("0xdef", 3);
    const backfillResult = d.markSeen("0xdef", 3);
    expect(wsResult).toBe(true);
    expect(backfillResult).toBe(false);
  });
});
