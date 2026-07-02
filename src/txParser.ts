import { createHash } from "node:crypto";
import { fromBase64 } from "@cosmjs/encoding";
import { Tx } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx.js";
import { MsgTransfer } from "cosmjs-types/ibc/applications/transfer/v1/tx.js";
import { MsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx.js";
import {
  MsgDelegate,
  MsgUndelegate,
  MsgBeginRedelegate,
} from "cosmjs-types/cosmos/staking/v1beta1/tx.js";
import type { Alert, Coin, RawEvent, TxResult } from "./types.js";
import { parseCoinString } from "./format.js";

export function txHashFromBase64(txBase64: string): string {
  return createHash("sha256").update(fromBase64(txBase64)).digest("hex").toUpperCase();
}

/**
 * Read an event attribute, handling both plain-string (CometBFT >= 0.34.22)
 * and base64-encoded (older Tendermint) attribute encodings.
 */
export function findAttr(event: RawEvent, key: string): string | undefined {
  for (const a of event.attributes) {
    if (a.key === key) return a.value;
  }
  const b64Key = Buffer.from(key, "utf8").toString("base64");
  for (const a of event.attributes) {
    if (a.key === b64Key) {
      return a.value ? Buffer.from(a.value, "base64").toString("utf8") : "";
    }
  }
  return undefined;
}

/**
 * completion_time lives only in raw "unbond"/"redelegate" events, not in the
 * decoded protobuf message. Match by msg_index when present (Cosmos SDK >= 0.46),
 * else fall back to the Nth occurrence of that event type in the tx.
 */
function completionTimeFor(
  events: RawEvent[],
  eventType: "unbond" | "redelegate",
  msgIndex: number,
  occurrence: number,
): string | undefined {
  const matching = events.filter((e) => e.type === eventType);
  for (const e of matching) {
    const mi = findAttr(e, "msg_index");
    if (mi !== undefined && mi !== "" && Number(mi) === msgIndex) {
      return findAttr(e, "completion_time");
    }
  }
  const fallback = matching[occurrence] ?? matching[0];
  return fallback ? findAttr(fallback, "completion_time") : undefined;
}

function contractAction(msgBytes: Uint8Array): string | undefined {
  try {
    const parsed = JSON.parse(Buffer.from(msgBytes).toString("utf8"));
    if (parsed && typeof parsed === "object") {
      const keys = Object.keys(parsed);
      if (keys.length > 0) return keys[0];
    }
  } catch {
    // non-JSON contract msg; no action name
  }
  return undefined;
}

export interface ParseInput {
  txBase64: string;
  txResult: TxResult;
  height: number;
  wallets: Set<string>;
}

/**
 * Decode one transaction and return every alert relevant to the tracked wallets.
 * Failed txs (code !== 0) must be filtered by the caller before this point,
 * but we guard here too.
 */
export function parseTxToAlerts({ txBase64, txResult, height, wallets }: ParseInput): Alert[] {
  if (txResult.code !== 0) return [];

  const txHash = txHashFromBase64(txBase64);
  const tx = Tx.decode(fromBase64(txBase64));
  const alerts: Alert[] = [];
  // transfers already alerted via a decoded MsgSend, keyed from|to|amount —
  // used to dedupe against raw transfer events scanned afterwards
  const seenTransfers = new Set<string>();
  const occurrences = { unbond: 0, redelegate: 0 };

  const messages = tx.body?.messages ?? [];
  messages.forEach((anyMsg, msgIndex) => {
    const { typeUrl, value } = anyMsg;
    switch (typeUrl) {
      case "/cosmos.bank.v1beta1.MsgSend": {
        const msg = MsgSend.decode(value);
        const fromTracked = wallets.has(msg.fromAddress);
        const toTracked = wallets.has(msg.toAddress);
        for (const c of msg.amount) {
          seenTransfers.add(`${msg.fromAddress}|${msg.toAddress}|${c.amount}${c.denom}`);
        }
        if (fromTracked) {
          alerts.push({
            kind: "send", direction: "out", wallet: msg.fromAddress,
            from: msg.fromAddress, to: msg.toAddress,
            amounts: msg.amount, height, txHash,
          });
        }
        if (toTracked) {
          alerts.push({
            kind: "send", direction: "in", wallet: msg.toAddress,
            from: msg.fromAddress, to: msg.toAddress,
            amounts: msg.amount, height, txHash,
          });
        }
        break;
      }

      case "/ibc.applications.transfer.v1.MsgTransfer": {
        const msg = MsgTransfer.decode(value);
        if (wallets.has(msg.sender) && msg.token) {
          alerts.push({
            kind: "ibc_transfer", wallet: msg.sender,
            sender: msg.sender, receiver: msg.receiver,
            token: msg.token, height, txHash,
          });
        }
        break;
      }

      case "/cosmwasm.wasm.v1.MsgExecuteContract": {
        const msg = MsgExecuteContract.decode(value);
        if (wallets.has(msg.sender)) {
          alerts.push({
            kind: "contract_call", wallet: msg.sender,
            sender: msg.sender, contract: msg.contract,
            action: contractAction(msg.msg),
            funds: msg.funds, height, txHash,
          });
        }
        break;
      }

      case "/cosmos.staking.v1beta1.MsgDelegate": {
        const msg = MsgDelegate.decode(value);
        if (wallets.has(msg.delegatorAddress) && msg.amount) {
          alerts.push({
            kind: "delegate", wallet: msg.delegatorAddress,
            delegator: msg.delegatorAddress, validator: msg.validatorAddress,
            amount: msg.amount, height, txHash,
          });
        }
        break;
      }

      case "/cosmos.staking.v1beta1.MsgUndelegate": {
        const msg = MsgUndelegate.decode(value);
        const occurrence = occurrences.unbond++;
        if (wallets.has(msg.delegatorAddress) && msg.amount) {
          alerts.push({
            kind: "undelegate", wallet: msg.delegatorAddress,
            delegator: msg.delegatorAddress, validator: msg.validatorAddress,
            amount: msg.amount,
            completionTime: completionTimeFor(txResult.events, "unbond", msgIndex, occurrence),
            height, txHash,
          });
        }
        break;
      }

      case "/cosmos.staking.v1beta1.MsgBeginRedelegate": {
        const msg = MsgBeginRedelegate.decode(value);
        const occurrence = occurrences.redelegate++;
        if (wallets.has(msg.delegatorAddress) && msg.amount) {
          alerts.push({
            kind: "redelegate", wallet: msg.delegatorAddress,
            delegator: msg.delegatorAddress,
            srcValidator: msg.validatorSrcAddress,
            dstValidator: msg.validatorDstAddress,
            amount: msg.amount,
            completionTime: completionTimeFor(txResult.events, "redelegate", msgIndex, occurrence),
            height, txHash,
          });
        }
        break;
      }
    }
  });

  // Inflows that arrive via contract execution (or any non-MsgSend path):
  // scan raw transfer events where a tracked wallet is the recipient.
  for (const ev of txResult.events) {
    if (ev.type !== "transfer") continue;
    const recipient = findAttr(ev, "recipient");
    const sender = findAttr(ev, "sender") ?? "";
    const amountStr = findAttr(ev, "amount") ?? "";
    if (!recipient || !wallets.has(recipient) || wallets.has(sender)) continue;

    const coins = parseCoinString(amountStr);
    const fresh: Coin[] = coins.filter(
      (c) => !seenTransfers.has(`${sender}|${recipient}|${c.amount}${c.denom}`),
    );
    if (fresh.length === 0) continue;
    for (const c of fresh) seenTransfers.add(`${sender}|${recipient}|${c.amount}${c.denom}`);
    alerts.push({
      kind: "send", direction: "in", wallet: recipient,
      from: sender, to: recipient,
      amounts: fresh, height, txHash,
    });
  }

  return alerts;
}
