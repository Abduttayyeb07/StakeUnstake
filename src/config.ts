import "dotenv/config";

export interface Config {
  /** Tendermint RPC endpoints, first is primary, rest are fallbacks */
  rpcUrls: string[];
  /** WebSocket endpoints, first is primary, rest are fallbacks */
  wsUrls: string[];
  wallets: string[];
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
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const wallets = (env.WALLET_ADDRESS ?? "")
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);

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
  };
}
