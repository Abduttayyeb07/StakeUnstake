import "dotenv/config";
import { parseSpreadsheetId } from "./sheets.js";

export interface Config {
  /** Tendermint RPC endpoints, first is primary, rest are fallbacks */
  rpcUrls: string[];
  /** WebSocket endpoints, first is primary, rest are fallbacks */
  wsUrls: string[];
  wallets: string[];
  /** address -> display name, e.g. "Deal 1", for wallets given as "Name:address" */
  walletLabels: Record<string, string>;
  telegramBotToken: string;
  /** Chat ids always included in broadcasts, in addition to /start subscribers */
  telegramChatIds: string[];
  pollIntervalMs: number;
  backfillIntervalMs: number;
  stateFile: string;
  backfillStateFile: string;
  dedupeFile: string;
  subscribersFile: string;
  explorerTxUrl: string;
  /** Path to a Google service-account JSON key file; unset disables Sheets logging */
  googleCredentialsPath: string;
  googleSpreadsheetId: string;
  stZigDenom: string;
  snapshotStateFile: string;
}

/**
 * WALLET_ADDRESS entries may be a bare address or "Name:address" (e.g.
 * "Deal 1:zig1wrje0m..."), comma-separated. The label is cosmetic only —
 * alerts/balances are always keyed by address.
 */
function parseWallets(raw: string): { wallets: string[]; walletLabels: Record<string, string> } {
  const wallets: string[] = [];
  const walletLabels: Record<string, string> = {};

  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) {
      wallets.push(trimmed);
      continue;
    }
    const label = trimmed.slice(0, colonIdx).trim();
    const address = trimmed.slice(colonIdx + 1).trim();
    if (!address) continue;
    wallets.push(address);
    if (label) walletLabels[address] = label;
  }
  return { wallets, walletLabels };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const { wallets, walletLabels } = parseWallets(env.WALLET_ADDRESS ?? "");

  if (wallets.length === 0) {
    throw new Error("WALLET_ADDRESS must contain at least one address");
  }

  const rpcUrls = (
    env.RPC_URL ??
    ""
  )
    .split(",")
    .map((u) => u.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  const wsUrls = (
    env.WS_URL ??
    ""
  )
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);

  return {
    rpcUrls,
    wsUrls,
    wallets,
    walletLabels,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN ?? "",
    telegramChatIds: (env.TELEGRAM_CHAT_ID ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    pollIntervalMs: Number(env.POLL_INTERVAL_MS ?? 10_000),
    backfillIntervalMs: Number(env.BACKFILL_INTERVAL_MS ?? 300_000),
    stateFile: env.STATE_FILE ?? "state.json",
    backfillStateFile: env.BACKFILL_STATE_FILE ?? "backfill-state.json",
    dedupeFile: env.DEDUPE_FILE ?? "alerts-seen.json",
    subscribersFile: env.SUBSCRIBERS_FILE ?? "subscribers.json",
    explorerTxUrl: env.EXPLORER_TX_URL ?? "https://www.zigscan.org/tx/",
    googleCredentialsPath: env.GOOGLE_CREDENTIALS_PATH ?? "",
    googleSpreadsheetId: parseSpreadsheetId(
      env.GOOGLE_SPREADSHEET_ID ??
        "https://docs.google.com/spreadsheets/d/1f2nKY0xW89B59k3mBtVd0ZhWWv5esRNAoObPztt6mSg/edit",
    ),
    stZigDenom:
      env.STZIG_DENOM ??
      "coin.zig109f7g2rzl2aqee7z6gffn8kfe9cpqx0mjkk7ethmx8m2hq4xpe9snmaam2.stzig",
    snapshotStateFile: env.SNAPSHOT_STATE_FILE ?? "snapshot-state.json",
  };
}
