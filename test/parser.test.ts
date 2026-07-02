import { describe, expect, it } from "vitest";
import { parseTxToAlerts } from "../src/txParser.js";
import { WALLET, OTHER, VALIDATOR, VALIDATOR2, buildTxBase64, msgs, txResult } from "./helpers.js";

const wallets = new Set([WALLET]);
const HEIGHT = 9_633_957;

function parse(txBase64: string, result = txResult()) {
  return parseTxToAlerts({ txBase64, txResult: result, height: HEIGHT, wallets });
}

describe("MsgSend", () => {
  it("emits an outflow alert when tracked wallet is the sender", () => {
    const alerts = parse(buildTxBase64([msgs.send(WALLET, OTHER, "1000000000")]));
    expect(alerts).toHaveLength(1);
    const a = alerts[0];
    expect(a.kind).toBe("send");
    if (a.kind !== "send") return;
    expect(a.direction).toBe("out");
    expect(a.from).toBe(WALLET);
    expect(a.to).toBe(OTHER);
    expect(a.amounts).toEqual([{ denom: "uzig", amount: "1000000000" }]);
    expect(a.height).toBe(HEIGHT);
    expect(a.txHash).toMatch(/^[0-9A-F]{64}$/);
  });

  it("emits an inflow alert when tracked wallet is the recipient", () => {
    const alerts = parse(buildTxBase64([msgs.send(OTHER, WALLET, "500000000")]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("send");
    expect(alerts[0]).toMatchObject({ direction: "in", from: OTHER, to: WALLET });
  });

  it("ignores sends between unrelated wallets", () => {
    const alerts = parse(buildTxBase64([msgs.send(OTHER, "zig1zzz", "1")]));
    expect(alerts).toHaveLength(0);
  });
});

describe("MsgTransfer (IBC)", () => {
  it("emits an outflow alert when tracked wallet is the sender", () => {
    const alerts = parse(buildTxBase64([msgs.ibcTransfer(WALLET, "osmo1xyz", "2500000")]));
    expect(alerts).toHaveLength(1);
    const a = alerts[0];
    expect(a.kind).toBe("ibc_transfer");
    if (a.kind !== "ibc_transfer") return;
    expect(a.sender).toBe(WALLET);
    expect(a.receiver).toBe("osmo1xyz");
    expect(a.token).toEqual({ denom: "uzig", amount: "2500000" });
  });

  it("ignores IBC transfers from other wallets", () => {
    expect(parse(buildTxBase64([msgs.ibcTransfer(OTHER, "osmo1xyz", "1")]))).toHaveLength(0);
  });
});

describe("MsgExecuteContract", () => {
  it("emits a contract call alert with the action name", () => {
    const alerts = parse(
      buildTxBase64([
        msgs.executeContract(WALLET, "zig1contract", { deposit: { amount: "1" } }, [
          { denom: "uzig", amount: "1000000" },
        ]),
      ]),
    );
    expect(alerts).toHaveLength(1);
    const a = alerts[0];
    expect(a.kind).toBe("contract_call");
    if (a.kind !== "contract_call") return;
    expect(a.sender).toBe(WALLET);
    expect(a.contract).toBe("zig1contract");
    expect(a.action).toBe("deposit");
    expect(a.funds).toEqual([{ denom: "uzig", amount: "1000000" }]);
  });

  it("detects inflows to the wallet via raw transfer events", () => {
    const result = txResult([
      {
        type: "transfer",
        attributes: [
          { key: "recipient", value: WALLET },
          { key: "sender", value: "zig1contract" },
          { key: "amount", value: "750000uzig" },
        ],
      },
    ]);
    const alerts = parse(
      buildTxBase64([msgs.executeContract(OTHER, "zig1contract", { withdraw: {} })]),
      result,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: "send",
      direction: "in",
      from: "zig1contract",
      to: WALLET,
      amounts: [{ denom: "uzig", amount: "750000" }],
    });
  });
});

describe("MsgDelegate", () => {
  it("emits a delegate alert for the tracked delegator", () => {
    const alerts = parse(buildTxBase64([msgs.delegate(WALLET, VALIDATOR, "4000000000")]));
    expect(alerts).toHaveLength(1);
    const a = alerts[0];
    expect(a.kind).toBe("delegate");
    if (a.kind !== "delegate") return;
    expect(a.delegator).toBe(WALLET);
    expect(a.validator).toBe(VALIDATOR);
    expect(a.amount).toEqual({ denom: "uzig", amount: "4000000000" });
  });
});

describe("MsgUndelegate", () => {
  it("extracts completion_time from the unbond raw event", () => {
    const result = txResult([
      {
        type: "unbond",
        attributes: [
          { key: "validator", value: VALIDATOR },
          { key: "amount", value: "9347527752uzig" },
          { key: "completion_time", value: "2026-07-23T16:00:00Z" },
        ],
      },
      { type: "message", attributes: [{ key: "sender", value: WALLET }] },
    ]);
    const alerts = parse(
      buildTxBase64([msgs.undelegate(WALLET, VALIDATOR, "9347527752")]),
      result,
    );
    expect(alerts).toHaveLength(1);
    const a = alerts[0];
    expect(a.kind).toBe("undelegate");
    if (a.kind !== "undelegate") return;
    expect(a.completionTime).toBe("2026-07-23T16:00:00Z");
    expect(a.amount.amount).toBe("9347527752");
  });

  it("handles base64-encoded event attributes (older Tendermint)", () => {
    const b64 = (s: string) => Buffer.from(s).toString("base64");
    const result = txResult([
      {
        type: "unbond",
        attributes: [{ key: b64("completion_time"), value: b64("2026-07-23T16:00:00Z") }],
      },
    ]);
    const alerts = parse(
      buildTxBase64([msgs.undelegate(WALLET, VALIDATOR, "1000000")]),
      result,
    );
    expect(alerts[0]).toMatchObject({ completionTime: "2026-07-23T16:00:00Z" });
  });

  it("matches completion_time by msg_index for multi-undelegate txs", () => {
    const result = txResult([
      {
        type: "unbond",
        attributes: [
          { key: "completion_time", value: "2026-07-23T16:00:00Z" },
          { key: "msg_index", value: "0" },
        ],
      },
      {
        type: "unbond",
        attributes: [
          { key: "completion_time", value: "2026-07-24T16:00:00Z" },
          { key: "msg_index", value: "1" },
        ],
      },
    ]);
    const alerts = parse(
      buildTxBase64([
        msgs.undelegate(WALLET, VALIDATOR, "1000000"),
        msgs.undelegate(WALLET, VALIDATOR2, "2000000"),
      ]),
      result,
    );
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toMatchObject({ completionTime: "2026-07-23T16:00:00Z" });
    expect(alerts[1]).toMatchObject({ completionTime: "2026-07-24T16:00:00Z" });
  });
});

describe("MsgBeginRedelegate", () => {
  it("emits a redelegate alert with completion_time from the redelegate event", () => {
    const result = txResult([
      {
        type: "redelegate",
        attributes: [
          { key: "source_validator", value: VALIDATOR },
          { key: "destination_validator", value: VALIDATOR2 },
          { key: "amount", value: "10000000000uzig" },
          { key: "completion_time", value: "2026-07-23T16:00:00Z" },
        ],
      },
    ]);
    const alerts = parse(
      buildTxBase64([msgs.redelegate(WALLET, VALIDATOR, VALIDATOR2, "10000000000")]),
      result,
    );
    expect(alerts).toHaveLength(1);
    const a = alerts[0];
    expect(a.kind).toBe("redelegate");
    if (a.kind !== "redelegate") return;
    expect(a.srcValidator).toBe(VALIDATOR);
    expect(a.dstValidator).toBe(VALIDATOR2);
    expect(a.amount.amount).toBe("10000000000");
    expect(a.completionTime).toBe("2026-07-23T16:00:00Z");
  });
});

describe("general behavior", () => {
  it("skips failed transactions (code !== 0)", () => {
    const alerts = parse(
      buildTxBase64([msgs.delegate(WALLET, VALIDATOR, "1000000")]),
      txResult([], 5),
    );
    expect(alerts).toHaveLength(0);
  });

  it("handles multiple messages in one tx", () => {
    const alerts = parse(
      buildTxBase64([
        msgs.send(WALLET, OTHER, "1000000"),
        msgs.delegate(WALLET, VALIDATOR, "2000000"),
      ]),
    );
    expect(alerts.map((a) => a.kind)).toEqual(["send", "delegate"]);
  });

  it("does not duplicate MsgSend alerts from raw transfer events", () => {
    const result = txResult([
      {
        type: "transfer",
        attributes: [
          { key: "recipient", value: WALLET },
          { key: "sender", value: OTHER },
          { key: "amount", value: "500000uzig" },
        ],
      },
    ]);
    const alerts = parse(buildTxBase64([msgs.send(OTHER, WALLET, "500000")]), result);
    expect(alerts).toHaveLength(1);
  });
});
