import { afterEach, describe, expect, it, vi } from "vitest";
import { RpcClient } from "../src/rpc.js";

const PRIMARY = "https://primary.example";
const FALLBACK = "https://fallback.example";

function okStatus(height: number) {
  return {
    ok: true,
    json: async () => ({
      jsonrpc: "2.0",
      id: 1,
      result: { sync_info: { latest_block_height: String(height) } },
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RpcClient failover", () => {
  it("uses the primary endpoint when healthy", async () => {
    const fetchMock = vi.fn(async (_url: string) => okStatus(100));
    vi.stubGlobal("fetch", fetchMock);

    const rpc = new RpcClient([PRIMARY, FALLBACK]);
    expect(await rpc.getLatestHeight()).toBe(100);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(PRIMARY);
  });

  it("fails over to the fallback when the primary is down, then sticks to it", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).startsWith(PRIMARY)) throw new Error("ECONNREFUSED");
      return okStatus(200);
    });
    vi.stubGlobal("fetch", fetchMock);

    const rpc = new RpcClient([PRIMARY, FALLBACK]);
    expect(await rpc.getLatestHeight()).toBe(200);
    // second call goes straight to the fallback (sticky), no retry on primary
    expect(await rpc.getLatestHeight()).toBe(200);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain(PRIMARY);
    expect(urls[1]).toContain(FALLBACK);
    expect(urls[2]).toContain(FALLBACK);
  });

  it("throws only when every endpoint fails", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("all down");
    });
    vi.stubGlobal("fetch", fetchMock);

    const rpc = new RpcClient([PRIMARY, FALLBACK]);
    await expect(rpc.getLatestHeight()).rejects.toThrow("all down");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
