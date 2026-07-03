import { toBase64 } from "@cosmjs/encoding";
import { Tx, TxBody, AuthInfo } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx.js";
import { MsgTransfer } from "cosmjs-types/ibc/applications/transfer/v1/tx.js";
import { MsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx.js";
import {
  MsgDelegate,
  MsgUndelegate,
  MsgBeginRedelegate,
} from "cosmjs-types/cosmos/staking/v1beta1/tx.js";
import { MsgWithdrawDelegatorReward } from "cosmjs-types/cosmos/distribution/v1beta1/tx.js";
import type { RawEvent, TxResult } from "../src/types.js";

export const WALLET = "zig1wrje0m0uhmgme77uxh0a4jynd70a8vsee8ksg4";
export const OTHER = "zig1abcabcabcabcabcabcabcabcabcabcabcabc00";
export const VALIDATOR = "zigvaloper15pwexampleexampleexampleexample";
export const VALIDATOR2 = "zigvaloper1vd9exampleexampleexampleexample";

type AnyMsg = { typeUrl: string; value: Uint8Array };

export function buildTxBase64(messages: AnyMsg[]): string {
  const tx = Tx.fromPartial({
    body: TxBody.fromPartial({ messages }),
    authInfo: AuthInfo.fromPartial({}),
    signatures: [new Uint8Array()],
  });
  return toBase64(Tx.encode(tx).finish());
}

export function txResult(events: RawEvent[] = [], code = 0): TxResult {
  return { code, events };
}

export const msgs = {
  send(from: string, to: string, amount: string, denom = "uzig"): AnyMsg {
    return {
      typeUrl: "/cosmos.bank.v1beta1.MsgSend",
      value: MsgSend.encode(
        MsgSend.fromPartial({ fromAddress: from, toAddress: to, amount: [{ denom, amount }] }),
      ).finish(),
    };
  },
  ibcTransfer(sender: string, receiver: string, amount: string, denom = "uzig"): AnyMsg {
    return {
      typeUrl: "/ibc.applications.transfer.v1.MsgTransfer",
      value: MsgTransfer.encode(
        MsgTransfer.fromPartial({
          sender,
          receiver,
          sourcePort: "transfer",
          sourceChannel: "channel-0",
          token: { denom, amount },
        }),
      ).finish(),
    };
  },
  executeContract(sender: string, contract: string, msg: object, funds: Array<{ denom: string; amount: string }> = []): AnyMsg {
    return {
      typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
      value: MsgExecuteContract.encode(
        MsgExecuteContract.fromPartial({
          sender,
          contract,
          msg: new TextEncoder().encode(JSON.stringify(msg)),
          funds,
        }),
      ).finish(),
    };
  },
  delegate(delegator: string, validator: string, amount: string): AnyMsg {
    return {
      typeUrl: "/cosmos.staking.v1beta1.MsgDelegate",
      value: MsgDelegate.encode(
        MsgDelegate.fromPartial({
          delegatorAddress: delegator,
          validatorAddress: validator,
          amount: { denom: "uzig", amount },
        }),
      ).finish(),
    };
  },
  undelegate(delegator: string, validator: string, amount: string): AnyMsg {
    return {
      typeUrl: "/cosmos.staking.v1beta1.MsgUndelegate",
      value: MsgUndelegate.encode(
        MsgUndelegate.fromPartial({
          delegatorAddress: delegator,
          validatorAddress: validator,
          amount: { denom: "uzig", amount },
        }),
      ).finish(),
    };
  },
  redelegate(delegator: string, src: string, dst: string, amount: string): AnyMsg {
    return {
      typeUrl: "/cosmos.staking.v1beta1.MsgBeginRedelegate",
      value: MsgBeginRedelegate.encode(
        MsgBeginRedelegate.fromPartial({
          delegatorAddress: delegator,
          validatorSrcAddress: src,
          validatorDstAddress: dst,
          amount: { denom: "uzig", amount },
        }),
      ).finish(),
    };
  },
  withdrawReward(delegator: string, validator: string): AnyMsg {
    return {
      typeUrl: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
      value: MsgWithdrawDelegatorReward.encode(
        MsgWithdrawDelegatorReward.fromPartial({
          delegatorAddress: delegator,
          validatorAddress: validator,
        }),
      ).finish(),
    };
  },
};
