import { formatMicroAmount } from "../format.js";
import type { EthConfig } from "../ethConfig.js";
import type { Notifier, WalletBalance } from "../telegram.js";
import { FallbackRpcProvider } from "./rpcProvider.js";
import { EthWsMonitor } from "./wsMonitor.js";
import { EthBackfiller } from "./backfill.js";
import { EthAlertDeduper } from "./dedupe.js";
import { logToAlert } from "./processLog.js";
import { getTokenBalance } from "./balance.js";
import { formatTransferAlert } from "./alerts.js";
import type { TransferAlert } from "./types.js";

export class EthMonitor {
  readonly rpc: FallbackRpcProvider;
  private readonly ws: EthWsMonitor;
  private readonly backfiller: EthBackfiller;
  private readonly deduper = new EthAlertDeduper();

  constructor(
    private readonly config: EthConfig,
    private readonly notifier: Notifier,
  ) {
    this.rpc = new FallbackRpcProvider(config.rpcUrls);
    this.ws = new EthWsMonitor(config.wsUrls, config.tokenAddress);
    this.backfiller = new EthBackfiller({
      rpc: this.rpc,
      config,
      dispatch: (alert) => this.dispatch(alert, "backfill"),
    });
  }

  private async dispatch(alert: TransferAlert, source: "ws" | "backfill"): Promise<boolean> {
    if (!this.deduper.markSeen(alert.txHash, alert.logIndex)) return false;
    console.log(
      `[eth-monitor] (${source}) ${alert.direction} transfer at block ${alert.blockNumber} (tx ${alert.txHash.slice(0, 12)}...)`,
    );
    await this.notifier.broadcast(formatTransferAlert(alert, this.config));
    return true;
  }

  async start(): Promise<void> {
    const { url, chainId } = await this.rpc.verifyConnected();
    console.log(`[eth-monitor] connected to ${url} (chain id ${chainId})`);
    console.log(
      `[eth-monitor] watching ${this.config.wallets.length} wallet(s) for ${this.config.tokenSymbol} transfers: ` +
        this.config.wallets
          .map((w) => (this.config.walletLabels[w] ? `${this.config.walletLabels[w]} (${w})` : w))
          .join(", "),
    );

    await this.backfiller.init();
    console.log(`[eth-backfill] starting after block ${this.backfiller.checkpoint}`);

    this.ws.on("connected", (url: string) => console.log(`[eth-ws] connected to ${url}`));
    this.ws.on("stale", () => {
      console.warn("[eth-ws] connection stale, forcing reconnect");
      void this.notifier.notifyAdmin("⚠️ <b>ETH WS stale</b> — forcing reconnect.");
    });
    this.ws.on("reconnecting", (delay: number, url: string) => {
      console.warn(`[eth-ws] reconnecting to ${url} in ${delay}ms`);
      void this.notifier.notifyAdmin(
        `🔄 <b>ETH WS reconnecting</b>\nEndpoint: <code>${url}</code>\nIn: ${delay}ms`,
      );
    });
    this.ws.on("error", (err: Error) => console.error(`[eth-ws] error: ${err.message}`));
    this.ws.on("log", (log) => {
      const alert = logToAlert(log, this.config);
      if (alert) void this.dispatch(alert, "ws");
    });
    this.ws.connect();

    this.backfiller.start();
  }

  stop(): void {
    this.ws.close();
    this.backfiller.stop();
  }

  /** Manual re-scan for the /verify command — range-limited by the caller. Returns new-alert count. */
  async verifyRange(fromBlock: number, toBlock: number): Promise<number> {
    return this.backfiller.processRange(fromBlock, toBlock);
  }

  get latestCheckpoint(): number {
    return this.backfiller.checkpoint;
  }

  async getBalances(): Promise<WalletBalance[]> {
    return Promise.all(
      this.config.wallets.map(async (wallet): Promise<WalletBalance> => {
        const label = this.config.walletLabels[wallet];
        try {
          const raw = await getTokenBalance(this.rpc, this.config.tokenAddress, wallet);
          const formatted = `${formatMicroAmount(raw, this.config.tokenDecimals)} ${this.config.tokenSymbol}`;
          return { wallet, label, amount: raw, formatted };
        } catch (e) {
          return { wallet, label, amount: { error: `lookup failed: ${String(e)}` } };
        }
      }),
    );
  }
}
