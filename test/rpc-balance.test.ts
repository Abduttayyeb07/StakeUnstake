import { describe, expect, it, vi } from "vitest";
import { RpcClient } from "../src/rpc.js";
import { WALLET } from "./helpers.js";

function abciQueryOk(base64Value: string) {
  return {
    ok: true,
    json: async () => ({
      jsonrpc: "2.0",
      id: 1,
      result: { response: { code: 0, log: "", value: base64Value } },
    }),
  };
}

describe("RpcClient.getBalance", () => {
  it("decodes a QueryBalanceResponse from abci_query", async () => {
    // protobuf for { balance: { denom: "uzig", amount: "7404" } }
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("abci_query");
      expect(url).toContain("/cosmos.bank.v1beta1.Query/Balance");
      expect(url).toContain("data=0x");
      return abciQueryOk("CgwKBHV6aWcSBDc0MDQ=");
    });
    vi.stubGlobal("fetch", fetchMock);

    const rpc = new RpcClient(["https://example.test"]);
    expect(await rpc.getBalance(WALLET)).toBe("7404");
    vi.unstubAllGlobals();
  });

  it("returns 0 when the account has no balance yet (empty value)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0", id: 1,
        result: { response: { code: 0, log: "", value: null } },
      }),
    })));

    const rpc = new RpcClient(["https://example.test"]);
    expect(await rpc.getBalance(WALLET)).toBe("0");
    vi.unstubAllGlobals();
  });

  it("throws when abci_query reports a non-zero code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0", id: 1,
        result: { response: { code: 1, log: "invalid address", value: null } },
      }),
    })));

    const rpc = new RpcClient(["https://example.test"]);
    await expect(rpc.getBalance(WALLET)).rejects.toThrow("invalid address");
    vi.unstubAllGlobals();
  });
});
