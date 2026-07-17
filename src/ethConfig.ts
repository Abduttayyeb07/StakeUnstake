import "dotenv/config";
import { getAddress, isAddress } from "ethers";

export interface EthConfig {
  rpcUrls: string[];
  wsUrls: string[];
  /** checksummed address -> display name, e.g. "Deal 1 (eth)" */
  walletLabels: Record<string, string>;
  wallets: string[];
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  minAlertAmount: number;
  alertIncoming: boolean;
  alertOutgoing: boolean;
  pollIntervalMs: number;
  confirmations: number;
  maxBlockRange: number;
  maxBacklogBlocks: number;
  jumpToTipOnBoot: boolean;
  stateFile: string;
  snapshotStateFile: string;
  etherscanApiKey: string;
  etherscanTxUrl: string;
  /** empty string disables the ETH monitor entirely (no wallets configured) */
  enabled: boolean;
}

/** "Label=0xAddress,Label2=0xAddress2" -> wallets[] + walletLabels{} (checksummed) */
function parseWatchedWallets(raw: string): { wallets: string[]; walletLabels: Record<string, string> } {
  const wallets: string[] = [];
  const walletLabels: Record<string, string> = {};

  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf("=");
    const label = eqIdx === -1 ? "" : trimmed.slice(0, eqIdx).trim();
    const rawAddress = (eqIdx === -1 ? trimmed : trimmed.slice(eqIdx + 1)).trim();
    if (!isAddress(rawAddress)) {
      throw new Error(`WATCHED_WALLETS: "${rawAddress}" is not a valid Ethereum address`);
    }
    const address = getAddress(rawAddress); // normalize to EIP-55 checksum
    wallets.push(address);
    if (label) walletLabels[address] = label;
  }
  return { wallets, walletLabels };
}

const parseBool = (v: string | undefined, def: boolean) =>
  v === undefined ? def : ["1", "true", "yes"].includes(v.toLowerCase());

export function loadEthConfig(env: NodeJS.ProcessEnv = process.env): EthConfig {
  const { wallets, walletLabels } = parseWatchedWallets(env.WATCHED_WALLETS ?? "");

  const rpcUrls = (env.ETH_RPC_URLS ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  const wsUrls = (env.ETH_WS_URLS ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);

  // real, verified on-chain: ZigCoin (ZIG), 18 decimals, at this checksummed address
  const tokenAddressRaw = env.ZIG_TOKEN_ADDRESS ?? "0xb2617246d0c6c0087f18703d576831899ca94f01";
  if (!isAddress(tokenAddressRaw)) {
    throw new Error(`ZIG_TOKEN_ADDRESS "${tokenAddressRaw}" is not a valid Ethereum address`);
  }

  return {
    rpcUrls,
    wsUrls,
    wallets,
    walletLabels,
    tokenAddress: getAddress(tokenAddressRaw),
    tokenSymbol: env.TOKEN_SYMBOL ?? "ZIG",
    tokenDecimals: Number(env.TOKEN_DECIMALS ?? 18),
    minAlertAmount: Number(env.MIN_ALERT_AMOUNT ?? 0),
    alertIncoming: parseBool(env.ALERT_INCOMING, true),
    alertOutgoing: parseBool(env.ALERT_OUTGOING, true),
    pollIntervalMs: Number(env.ETH_POLL_INTERVAL_MS ?? 15_000),
    confirmations: Number(env.CONFIRMATIONS ?? 1),
    maxBlockRange: Number(env.MAX_BLOCK_RANGE ?? 2_000),
    maxBacklogBlocks: Number(env.MAX_BACKLOG_BLOCKS ?? 50_000),
    jumpToTipOnBoot: parseBool(env.ETH_JUMP_TO_TIP_ON_BOOT, false),
    stateFile: env.ETH_STATE_FILE ?? "eth-state.json",
    snapshotStateFile: env.ETH_SNAPSHOT_STATE_FILE ?? "eth-snapshot-state.json",
    etherscanApiKey: env.ETHERSCAN_API_KEY ?? "",
    etherscanTxUrl: env.ETHERSCAN_TX_URL ?? "https://etherscan.io/tx/",
    enabled: rpcUrls.length > 0 && wallets.length > 0,
  };
}
