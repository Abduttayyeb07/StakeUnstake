import { getAddress } from "ethers";
import { ERC20_INTERFACE } from "./erc20.js";
import type { TransferAlert } from "./types.js";
import type { EthConfig } from "../ethConfig.js";

/**
 * The subset of ethers.Log needed here — satisfied both by real Log objects
 * from getLogs() and by logs reconstructed from a raw eth_subscription
 * WebSocket notification.
 */
export interface MinimalLog {
  topics: readonly string[];
  data: string;
  transactionHash: string;
  index: number;
  blockNumber: number;
}

/**
 * Decodes a raw Transfer log and returns an alert if it involves a watched
 * wallet and passes the configured filters (direction, min amount) — shared
 * by both the WebSocket and HTTP-backfill detection paths so they can never
 * disagree on what counts as alert-worthy.
 */
export function logToAlert(log: MinimalLog, config: EthConfig): TransferAlert | null {
  const parsed = ERC20_INTERFACE.parseLog({ topics: log.topics as string[], data: log.data });
  if (!parsed || parsed.name !== "Transfer") return null;

  const from = getAddress(parsed.args.from as string);
  const to = getAddress(parsed.args.to as string);
  const amount = (parsed.args.value as bigint).toString();

  const walletSet = new Set(config.wallets);
  let wallet: string;
  let direction: "in" | "out";
  if (walletSet.has(to)) {
    wallet = to;
    direction = "in";
  } else if (walletSet.has(from)) {
    wallet = from;
    direction = "out";
  } else {
    return null; // not a watched wallet
  }

  if (direction === "in" && !config.alertIncoming) return null;
  if (direction === "out" && !config.alertOutgoing) return null;

  if (config.minAlertAmount > 0) {
    const minRaw = BigInt(Math.round(config.minAlertAmount * 10 ** config.tokenDecimals));
    if (BigInt(amount) < minRaw) return null;
  }

  return {
    direction,
    wallet,
    walletLabel: config.walletLabels[wallet],
    from,
    to,
    amount,
    txHash: log.transactionHash,
    logIndex: log.index,
    blockNumber: log.blockNumber,
  };
}
