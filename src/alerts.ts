import type { Alert } from "./types.js";
import {
  escapeHtml,
  formatCoin,
  formatCoins,
  formatCompletionTime,
  shortenAddress,
} from "./format.js";

export function formatAlert(alert: Alert, explorerTxUrl: string): string {
  const walletLabel = escapeHtml(shortenAddress(alert.wallet));
  const txLink = `${explorerTxUrl}${alert.txHash}`;
  const footer = `\nTx: ${txLink}\nBlock: ${alert.height}`;

  switch (alert.kind) {
    case "send": {
      const title =
        alert.direction === "out"
          ? `🚨 <b>${walletLabel} — Outflow Detected</b>`
          : `💰 <b>${walletLabel} — Inflow Detected</b>`;
      return (
        `${title}\n` +
        `From: <code>${escapeHtml(alert.from)}</code>\n` +
        `To: <code>${escapeHtml(alert.to)}</code>\n` +
        `Amount: <b>${escapeHtml(formatCoins(alert.amounts))}</b>` +
        footer
      );
    }
    case "ibc_transfer":
      return (
        `🌉 <b>${walletLabel} — IBC Transfer Out</b>\n` +
        `Sender: <code>${escapeHtml(alert.sender)}</code>\n` +
        `Receiver: <code>${escapeHtml(alert.receiver)}</code>\n` +
        `Amount: <b>${escapeHtml(formatCoin(alert.token))}</b>` +
        footer
      );
    case "contract_call": {
      const action = alert.action ? `\nAction: <code>${escapeHtml(alert.action)}</code>` : "";
      const funds =
        alert.funds.length > 0
          ? `\nFunds: <b>${escapeHtml(formatCoins(alert.funds))}</b>`
          : "";
      return (
        `⚙️ <b>${walletLabel} — Contract Call</b>\n` +
        `Sender: <code>${escapeHtml(alert.sender)}</code>\n` +
        `Contract: <code>${escapeHtml(alert.contract)}</code>` +
        action +
        funds +
        footer
      );
    }
    case "delegate":
      return (
        `🔒 <b>${walletLabel} — Delegated</b>\n` +
        `Delegator: <code>${escapeHtml(alert.delegator)}</code>\n` +
        `Validator: <code>${escapeHtml(alert.validator)}</code>\n` +
        `Amount: <b>${escapeHtml(formatCoin(alert.amount))}</b>` +
        footer
      );
    case "undelegate": {
      const unlocks = alert.completionTime
        ? `\nUnlocks: <b>${escapeHtml(formatCompletionTime(alert.completionTime))}</b>`
        : "";
      return (
        `🔓 <b>${walletLabel} — Undelegated</b>\n` +
        `Delegator: <code>${escapeHtml(alert.delegator)}</code>\n` +
        `Validator: <code>${escapeHtml(alert.validator)}</code>\n` +
        `Amount: <b>${escapeHtml(formatCoin(alert.amount))}</b>` +
        unlocks +
        footer
      );
    }
    case "redelegate": {
      const completes = alert.completionTime
        ? `\nCompletes: <b>${escapeHtml(formatCompletionTime(alert.completionTime))}</b>`
        : "";
      return (
        `🔄 <b>${walletLabel} — Redelegated</b>\n` +
        `Delegator: <code>${escapeHtml(alert.delegator)}</code>\n` +
        `From Validator: <code>${escapeHtml(alert.srcValidator)}</code>\n` +
        `To Validator: <code>${escapeHtml(alert.dstValidator)}</code>\n` +
        `Amount: <b>${escapeHtml(formatCoin(alert.amount))}</b>` +
        completes +
        footer
      );
    }
    case "withdraw_reward":
      return (
        `🎁 <b>${walletLabel} — Rewards Claimed</b>\n` +
        `Delegator: <code>${escapeHtml(alert.delegator)}</code>\n` +
        `Validator: <code>${escapeHtml(alert.validator)}</code>\n` +
        `Amount: <b>${escapeHtml(formatCoins(alert.amounts))}</b>` +
        footer
      );
  }
}
