import type { Coin } from "./types.js";

/**
 * Format a micro-denominated integer amount (uzig, exponent 6) as a human
 * ZIG amount with thousands separators: "9347527752" -> "9,347.527752"
 * (1,000,000 uzig = 1 ZIG)
 */
export function formatMicroAmount(amount: string, decimals = 6): string {
  const neg = amount.startsWith("-");
  const digits = (neg ? amount.slice(1) : amount).replace(/\D/g, "") || "0";
  const padded = digits.padStart(decimals + 1, "0");
  const intPart = padded.slice(0, padded.length - decimals);
  const fracPart = padded.slice(padded.length - decimals).replace(/0+$/, "");
  const intWithCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + intWithCommas + (fracPart ? "." + fracPart : "");
}

export function formatCoin(coin: Coin): string {
  if (coin.denom === "uzig") return `${formatMicroAmount(coin.amount)} ZIG`;
  return `${coin.amount} ${coin.denom}`;
}

export function formatCoins(coins: Coin[]): string {
  return coins.map(formatCoin).join(", ");
}

/** Parse "4000000000uzig" or "12ibc/ABC...,5uzig" into Coin objects */
export function parseCoinString(s: string): Coin[] {
  return s
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const m = part.match(/^(\d+)(.+)$/);
      return m ? [{ amount: m[1], denom: m[2] }] : [];
    });
}

/** "2026-07-23T16:00:00Z" -> "July 23, 2026 16:00 UTC" */
export function formatCompletionTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const month = d.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${month} ${d.getUTCDate()}, ${d.getUTCFullYear()} ${hh}:${mm} UTC`;
}

export function shortenAddress(addr: string, chars = 9): string {
  return addr.length <= chars + 4 ? addr : `${addr.slice(0, chars)}...`;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
