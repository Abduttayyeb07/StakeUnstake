import { describe, expect, it } from "vitest";
import {
  formatCoin,
  formatCompletionTime,
  formatMicroAmount,
  parseCoinString,
} from "../src/format.js";
import { formatAlert } from "../src/alerts.js";
import type { Alert } from "../src/types.js";

describe("formatMicroAmount", () => {
  it("converts uzig to ZIG with commas", () => {
    expect(formatMicroAmount("4000000000")).toBe("4,000");
    expect(formatMicroAmount("9347527752")).toBe("9,347.527752");
    expect(formatMicroAmount("1")).toBe("0.000001");
    expect(formatMicroAmount("0")).toBe("0");
    expect(formatMicroAmount("1000000")).toBe("1");
  });
});

describe("formatCoin", () => {
  it("formats uzig as ZIG", () => {
    expect(formatCoin({ denom: "uzig", amount: "1000000" })).toBe("1 ZIG");
  });
  it("divides uzig by one million for the ZIG value", () => {
    expect(formatCoin({ denom: "uzig", amount: "4000000000" })).toBe("4,000 ZIG");
    expect(formatCoin({ denom: "uzig", amount: "9347527752" })).toBe("9,347.527752 ZIG");
  });
  it("passes through non-uzig denoms raw", () => {
    expect(formatCoin({ denom: "ibc/OTHER", amount: "42" })).toBe("42 ibc/OTHER");
  });
});

describe("parseCoinString", () => {
  it("parses single and multi coin strings", () => {
    expect(parseCoinString("4000000000uzig")).toEqual([{ amount: "4000000000", denom: "uzig" }]);
    expect(parseCoinString("5uzig,10ibc/OTHER")).toEqual([
      { amount: "5", denom: "uzig" },
      { amount: "10", denom: "ibc/OTHER" },
    ]);
    expect(parseCoinString("")).toEqual([]);
  });
});

describe("formatCompletionTime", () => {
  it("renders RFC3339 as a friendly UTC string", () => {
    expect(formatCompletionTime("2026-07-23T16:00:00Z")).toBe("July 23, 2026 16:00 UTC");
  });
});

describe("formatAlert", () => {
  const base = { height: 9633957, txHash: "A".repeat(64), wallet: "zig1wrje0m0uhmgme77uxh0a4jynd70a8vsee8ksg4" };

  it("formats an undelegate alert with unlock time", () => {
    const alert: Alert = {
      ...base,
      kind: "undelegate",
      delegator: base.wallet,
      validator: "zigvaloper1vd9",
      amount: { denom: "uzig", amount: "9347527752" },
      completionTime: "2026-07-23T16:00:00Z",
    };
    const html = formatAlert(alert, "https://www.zigscan.org/tx/");
    expect(html).toContain("🔓");
    expect(html).toContain("Undelegated");
    expect(html).toContain("9,347.527752 ZIG");
    expect(html).toContain("July 23, 2026 16:00 UTC");
    expect(html).toContain(`https://www.zigscan.org/tx/${base.txHash}`);
    expect(html).toContain("Block: 9633957");
  });

  it("formats a delegate alert", () => {
    const alert: Alert = {
      ...base,
      kind: "delegate",
      delegator: base.wallet,
      validator: "zigvaloper15pw",
      amount: { denom: "uzig", amount: "4000000000" },
    };
    const html = formatAlert(alert, "https://www.zigscan.org/tx/");
    expect(html).toContain("🔒");
    expect(html).toContain("4,000 ZIG");
  });

  it("formats a redelegate alert with both validators", () => {
    const alert: Alert = {
      ...base,
      kind: "redelegate",
      delegator: base.wallet,
      srcValidator: "zigvaloper10amz",
      dstValidator: "zigvaloper1vpsw",
      amount: { denom: "uzig", amount: "10000000000" },
      completionTime: "2026-07-23T16:00:00Z",
    };
    const html = formatAlert(alert, "https://www.zigscan.org/tx/");
    expect(html).toContain("🔄");
    expect(html).toContain("zigvaloper10amz");
    expect(html).toContain("zigvaloper1vpsw");
    expect(html).toContain("10,000 ZIG");
  });

  it("formats a withdraw_reward alert", () => {
    const alert: Alert = {
      ...base,
      kind: "withdraw_reward",
      delegator: base.wallet,
      validator: "zigvaloper18vykgjgcmp2z4xzkt6mh74glrpd7qda8fqldrl",
      amounts: [{ denom: "uzig", amount: "368006636" }],
    };
    const html = formatAlert(alert, "https://www.zigscan.org/tx/");
    expect(html).toContain("🎁");
    expect(html).toContain("Rewards Claimed");
    expect(html).toContain("368.006636 ZIG");
  });
});
