import { describe, expect, it } from "vitest";
import { logToAlert } from "../../src/eth/processLog.js";
import { loadEthConfig } from "../../src/ethConfig.js";
import { makeTransferLog, TOKEN, WALLET1, WALLET2, OTHER } from "./helpers.js";

function config(overrides: Record<string, string> = {}) {
  return loadEthConfig({
    ETH_RPC_URLS: "https://x.test",
    WATCHED_WALLETS: `Deal 1 (eth)=${WALLET1}`,
    ZIG_TOKEN_ADDRESS: TOKEN,
    ...overrides,
  });
}

describe("logToAlert", () => {
  it("detects an inflow to a watched wallet", () => {
    const log = makeTransferLog(OTHER, WALLET1, 5_000000000000000000n);
    const alert = logToAlert(log, config());
    expect(alert).toMatchObject({
      direction: "in",
      wallet: WALLET1,
      from: OTHER,
      to: WALLET1,
      amount: "5000000000000000000",
    });
  });

  it("detects an outflow from a watched wallet", () => {
    const log = makeTransferLog(WALLET1, OTHER, 2_000000000000000000n);
    const alert = logToAlert(log, config());
    expect(alert).toMatchObject({ direction: "out", wallet: WALLET1, from: WALLET1, to: OTHER });
  });

  it("ignores transfers not touching any watched wallet", () => {
    const log = makeTransferLog(OTHER, WALLET2, 1_000000000000000000n);
    expect(logToAlert(log, config())).toBeNull();
  });

  it("respects ALERT_INCOMING=false", () => {
    const log = makeTransferLog(OTHER, WALLET1, 1_000000000000000000n);
    expect(logToAlert(log, config({ ALERT_INCOMING: "false" }))).toBeNull();
  });

  it("respects ALERT_OUTGOING=false", () => {
    const log = makeTransferLog(WALLET1, OTHER, 1_000000000000000000n);
    expect(logToAlert(log, config({ ALERT_OUTGOING: "false" }))).toBeNull();
  });

  it("filters out transfers below MIN_ALERT_AMOUNT", () => {
    const log = makeTransferLog(OTHER, WALLET1, 500000000000000000n); // 0.5 token
    expect(logToAlert(log, config({ MIN_ALERT_AMOUNT: "1" }))).toBeNull();
    const bigLog = makeTransferLog(OTHER, WALLET1, 2_000000000000000000n); // 2 tokens
    expect(logToAlert(bigLog, config({ MIN_ALERT_AMOUNT: "1" }))).not.toBeNull();
  });

  it("carries the wallet label through", () => {
    const log = makeTransferLog(OTHER, WALLET1, 1_000000000000000000n);
    const alert = logToAlert(log, config());
    expect(alert?.walletLabel).toBe("Deal 1 (eth)");
  });
});
