import { describe, expect, it, vi } from "vitest";
import {
  QueryDelegatorDelegationsResponse,
} from "cosmjs-types/cosmos/staking/v1beta1/query.js";
import { QueryDelegationTotalRewardsResponse } from "cosmjs-types/cosmos/distribution/v1beta1/query.js";
import { RpcClient } from "../src/rpc.js";
import { WALLET, VALIDATOR, VALIDATOR2 } from "./helpers.js";

function abciQueryOk(bytes: Uint8Array) {
  return {
    ok: true,
    json: async () => ({
      jsonrpc: "2.0",
      id: 1,
      result: { response: { code: 0, log: "", value: Buffer.from(bytes).toString("base64") } },
    }),
  };
}

describe("RpcClient.getTotalDelegation", () => {
  it("sums delegations across a single page", async () => {
    const bytes = QueryDelegatorDelegationsResponse.encode(
      QueryDelegatorDelegationsResponse.fromPartial({
        delegationResponses: [
          { delegation: { delegatorAddress: WALLET, validatorAddress: VALIDATOR }, balance: { denom: "uzig", amount: "1000000" } },
          { delegation: { delegatorAddress: WALLET, validatorAddress: VALIDATOR2 }, balance: { denom: "uzig", amount: "2000000" } },
        ],
        pagination: { nextKey: new Uint8Array(), total: 2n },
      }),
    ).finish();
    vi.stubGlobal("fetch", vi.fn(async () => abciQueryOk(bytes)));

    const rpc = new RpcClient(["https://example.test"]);
    expect(await rpc.getTotalDelegation(WALLET)).toBe("3000000");
    vi.unstubAllGlobals();
  });

  it("follows pagination.nextKey across multiple pages", async () => {
    const page1 = QueryDelegatorDelegationsResponse.encode(
      QueryDelegatorDelegationsResponse.fromPartial({
        delegationResponses: [
          { delegation: { delegatorAddress: WALLET, validatorAddress: VALIDATOR }, balance: { denom: "uzig", amount: "1000000" } },
        ],
        pagination: { nextKey: new Uint8Array([1, 2, 3]), total: 2n },
      }),
    ).finish();
    const page2 = QueryDelegatorDelegationsResponse.encode(
      QueryDelegatorDelegationsResponse.fromPartial({
        delegationResponses: [
          { delegation: { delegatorAddress: WALLET, validatorAddress: VALIDATOR2 }, balance: { denom: "uzig", amount: "2000000" } },
        ],
        pagination: { nextKey: new Uint8Array(), total: 2n },
      }),
    ).finish();

    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => abciQueryOk(call++ === 0 ? page1 : page2)));

    const rpc = new RpcClient(["https://example.test"]);
    expect(await rpc.getTotalDelegation(WALLET)).toBe("3000000");
    expect(call).toBe(2);
    vi.unstubAllGlobals();
  });

  it("ignores delegations in a different denom", async () => {
    const bytes = QueryDelegatorDelegationsResponse.encode(
      QueryDelegatorDelegationsResponse.fromPartial({
        delegationResponses: [
          { delegation: { delegatorAddress: WALLET, validatorAddress: VALIDATOR }, balance: { denom: "someothertoken", amount: "999" } },
        ],
        pagination: { nextKey: new Uint8Array(), total: 1n },
      }),
    ).finish();
    vi.stubGlobal("fetch", vi.fn(async () => abciQueryOk(bytes)));

    const rpc = new RpcClient(["https://example.test"]);
    expect(await rpc.getTotalDelegation(WALLET)).toBe("0");
    vi.unstubAllGlobals();
  });
});

describe("RpcClient.getTotalRewards", () => {
  it("returns the total uzig reward amount as a raw Dec string", async () => {
    const bytes = QueryDelegationTotalRewardsResponse.encode(
      QueryDelegationTotalRewardsResponse.fromPartial({
        rewards: [{ validatorAddress: VALIDATOR, reward: [{ denom: "uzig", amount: "3819793475364130204838114498" }] }],
        total: [{ denom: "uzig", amount: "3819793475364130204838114498" }],
      }),
    ).finish();
    vi.stubGlobal("fetch", vi.fn(async () => abciQueryOk(bytes)));

    const rpc = new RpcClient(["https://example.test"]);
    expect(await rpc.getTotalRewards(WALLET)).toBe("3819793475364130204838114498");
    vi.unstubAllGlobals();
  });

  it("returns 0 when there are no rewards", async () => {
    const bytes = QueryDelegationTotalRewardsResponse.encode(
      QueryDelegationTotalRewardsResponse.fromPartial({ rewards: [], total: [] }),
    ).finish();
    vi.stubGlobal("fetch", vi.fn(async () => abciQueryOk(bytes)));

    const rpc = new RpcClient(["https://example.test"]);
    expect(await rpc.getTotalRewards(WALLET)).toBe("0");
    vi.unstubAllGlobals();
  });
});
