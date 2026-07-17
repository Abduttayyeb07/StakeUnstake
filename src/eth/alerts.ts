import { formatMicroAmount, escapeHtml, shortenAddress } from "../format.js";
import type { TransferAlert } from "./types.js";
import type { EthConfig } from "../ethConfig.js";

export function formatTransferAlert(alert: TransferAlert, config: EthConfig): string {
  const label = alert.walletLabel
    ? `${escapeHtml(alert.walletLabel)} (<code>${escapeHtml(shortenAddress(alert.wallet))}</code>)`
    : `<code>${escapeHtml(shortenAddress(alert.wallet))}</code>`;
  const title =
    alert.direction === "in"
      ? `💰 ${label} — Inflow Detected`
      : `🚨 ${label} — Outflow Detected`;
  const amount = formatMicroAmount(alert.amount, config.tokenDecimals);

  return (
    `<b>${title}</b>\n` +
    `From: <code>${escapeHtml(alert.from)}</code>\n` +
    `To: <code>${escapeHtml(alert.to)}</code>\n` +
    `Amount: <b>${escapeHtml(amount)} ${escapeHtml(config.tokenSymbol)}</b>\n` +
    `Tx: ${config.etherscanTxUrl}${alert.txHash}\n` +
    `Block: ${alert.blockNumber}`
  );
}
