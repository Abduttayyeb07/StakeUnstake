import { formatTokenAmount, escapeHtml, shortenAddress } from "../format.js";
import type { TransferAlert } from "./types.js";
import type { EthConfig } from "../ethConfig.js";

/**
 * @param historical When true (a /verify hit on a transfer already alerted
 * before), the message is marked as a known/old tx instead of looking like
 * a fresh alert.
 */
export function formatTransferAlert(
  alert: TransferAlert,
  config: EthConfig,
  historical = false,
): string {
  const label = alert.walletLabel
    ? `${escapeHtml(alert.walletLabel)} (<code>${escapeHtml(shortenAddress(alert.wallet))}</code>)`
    : `<code>${escapeHtml(shortenAddress(alert.wallet))}</code>`;
  const title = historical
    ? `📋 ${label} — Already Alerted (old tx)`
    : alert.direction === "in"
      ? `💰 ${label} — Inflow Detected`
      : `🚨 ${label} — Outflow Detected`;
  const amount = formatTokenAmount(alert.amount, config.tokenDecimals);
  const direction = historical ? `\nDirection: ${alert.direction === "in" ? "Inflow" : "Outflow"}` : "";

  return (
    `<b>${title}</b>\n` +
    `From: <code>${escapeHtml(alert.from)}</code>\n` +
    `To: <code>${escapeHtml(alert.to)}</code>\n` +
    `Amount: <b>${escapeHtml(amount)} ${escapeHtml(config.tokenSymbol)}</b>` +
    direction +
    `\nTx: ${config.etherscanTxUrl}${alert.txHash}\n` +
    `Block: ${alert.blockNumber}`
  );
}
