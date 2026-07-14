import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const DEAL1 = "zig1wrje0m0uhmgme77uxh0a4jynd70a8vsee8ksg4";
const DEAL2 = "zig1qqre88ggqyk6aqu6zevgrf3pfa9ls54u58muq6";

function env(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return { RPC_URL: "https://x.test", WS_URL: "wss://x.test", ...overrides };
}

describe("loadConfig wallet labels", () => {
  it("parses bare addresses with no labels", () => {
    const config = loadConfig(env({ WALLET_ADDRESS: DEAL1 }));
    expect(config.wallets).toEqual([DEAL1]);
    expect(config.walletLabels).toEqual({});
  });

  it("parses 'Name:address' pairs into labels, keyed by address", () => {
    const config = loadConfig(
      env({ WALLET_ADDRESS: `Deal 1:${DEAL1},Deal 2:${DEAL2}` }),
    );
    expect(config.wallets).toEqual([DEAL1, DEAL2]);
    expect(config.walletLabels).toEqual({ [DEAL1]: "Deal 1", [DEAL2]: "Deal 2" });
  });

  it("supports mixing labeled and bare addresses", () => {
    const config = loadConfig(env({ WALLET_ADDRESS: `Deal 1:${DEAL1},${DEAL2}` }));
    expect(config.wallets).toEqual([DEAL1, DEAL2]);
    expect(config.walletLabels).toEqual({ [DEAL1]: "Deal 1" });
  });

  it("throws when no wallets are configured", () => {
    expect(() => loadConfig(env({ WALLET_ADDRESS: "" }))).toThrow();
  });
});
