import { describe, expect, it } from "vitest";
import { formatTransferAlert } from "../../src/eth/alerts.js";
import { loadEthConfig } from "../../src/ethConfig.js";
import { WALLET1, OTHER, TOKEN } from "./helpers.js";
import type { TransferAlert } from "../../src/eth/types.js";

const config = loadEthConfig({
  ETH_RPC_URLS: "https://x.test",
  WATCHED_WALLETS: `Deal 1 (eth)=${WALLET1}`,
  ZIG_TOKEN_ADDRESS: TOKEN,
});

describe("formatTransferAlert", () => {
  it("formats an inflow with 18-decimal amount and Etherscan link", () => {
    const alert: TransferAlert = {
      direction: "in",
      wallet: WALLET1,
      walletLabel: "Deal 1 (eth)",
      from: OTHER,
      to: WALLET1,
      amount: "1234500000000000000000", // 1,234.5 ZIG at 18 decimals
      txHash: "0x" + "ab".repeat(32),
      logIndex: 0,
      blockNumber: 20_000_000,
    };
    const html = formatTransferAlert(alert, config);
    expect(html).toContain("💰");
    expect(html).toContain("Inflow Detected");
    expect(html).toContain("Deal 1 (eth)");
    expect(html).toContain("1,234.5 ZIG");
    expect(html).toContain(`https://etherscan.io/tx/0x${"ab".repeat(32)}`);
    expect(html).toContain("Block: 20000000");
  });

  it("formats an outflow", () => {
    const alert: TransferAlert = {
      direction: "out",
      wallet: WALLET1,
      from: WALLET1,
      to: OTHER,
      amount: "1000000000000000000",
      txHash: "0x" + "cd".repeat(32),
      logIndex: 1,
      blockNumber: 20_000_001,
    };
    const html = formatTransferAlert(alert, config);
    expect(html).toContain("🚨");
    expect(html).toContain("Outflow Detected");
    expect(html).toContain("1 ZIG");
  });
});
