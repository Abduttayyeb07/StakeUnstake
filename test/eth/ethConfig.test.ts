import { describe, expect, it } from "vitest";
import { loadEthConfig } from "../../src/ethConfig.js";
import { WALLET1, WALLET2 } from "./helpers.js";

describe("loadEthConfig", () => {
  it("parses Label=0xAddress pairs and checksums the address", () => {
    const config = loadEthConfig({
      ETH_RPC_URLS: "https://a.test,https://b.test",
      WATCHED_WALLETS: `Deal 1 (eth)=${WALLET1.toLowerCase()}`,
    });
    expect(config.wallets).toEqual([WALLET1]);
    expect(config.walletLabels[WALLET1]).toBe("Deal 1 (eth)");
    expect(config.rpcUrls).toEqual(["https://a.test", "https://b.test"]);
  });

  it("supports multiple comma-separated wallets", () => {
    const config = loadEthConfig({
      ETH_RPC_URLS: "https://a.test",
      WATCHED_WALLETS: `Deal 1=${WALLET1},Deal 2=${WALLET2}`,
    });
    expect(config.wallets).toEqual([WALLET1, WALLET2]);
  });

  it("throws on an invalid address", () => {
    expect(() =>
      loadEthConfig({ ETH_RPC_URLS: "https://a.test", WATCHED_WALLETS: "Deal 1=0xnotanaddress" }),
    ).toThrow();
  });

  it("defaults to the verified real ZIG contract with 18 decimals", () => {
    const config = loadEthConfig({ ETH_RPC_URLS: "https://a.test", WATCHED_WALLETS: `X=${WALLET1}` });
    expect(config.tokenAddress).toBe("0xb2617246d0c6c0087f18703d576831899ca94f01");
    expect(config.tokenDecimals).toBe(18);
    expect(config.tokenSymbol).toBe("ZIG");
  });

  it("is disabled when there are no RPC URLs or no wallets", () => {
    expect(loadEthConfig({ WATCHED_WALLETS: `X=${WALLET1}` }).enabled).toBe(false);
    expect(loadEthConfig({ ETH_RPC_URLS: "https://a.test" }).enabled).toBe(false);
  });

  it("enables when both are present", () => {
    const config = loadEthConfig({ ETH_RPC_URLS: "https://a.test", WATCHED_WALLETS: `X=${WALLET1}` });
    expect(config.enabled).toBe(true);
  });

  it("parses ALERT_INCOMING/ALERT_OUTGOING booleans", () => {
    const config = loadEthConfig({
      ETH_RPC_URLS: "https://a.test",
      WATCHED_WALLETS: `X=${WALLET1}`,
      ALERT_INCOMING: "false",
      ALERT_OUTGOING: "true",
    });
    expect(config.alertIncoming).toBe(false);
    expect(config.alertOutgoing).toBe(true);
  });
});
