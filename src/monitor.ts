import type { Config } from "./config.js";
import { BlockProcessor } from "./blockProcessor.js";
import { Backfiller } from "./backfill.js";
import { AlertDeduper } from "./dedupe.js";
import { RpcClient } from "./rpc.js";
import { ZigWsClient } from "./wsClient.js";
import { parseTxToAlerts } from "./txParser.js";
import { formatAlert } from "./alerts.js";
import type { Alert } from "./types.js";
import type { Notifier, WalletBalance } from "./telegram.js";

export class StakingMonitor {
  private readonly rpc: RpcClient;
  private readonly ws: ZigWsClient;
  private readonly processor: BlockProcessor;
  private readonly backfiller: Backfiller;
  private readonly deduper: AlertDeduper;
  private readonly wallets: Set<string>;
  private pollTimer: NodeJS.Timeout | null = null;
  private backfillTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: Config,
    private readonly notifier: Notifier,
  ) {
    this.wallets = new Set(config.wallets);
    this.rpc = new RpcClient(config.rpcUrls);
    this.ws = new ZigWsClient(config.wsUrls, config.wallets);
    this.deduper = new AlertDeduper(config.dedupeFile);
    this.processor = new BlockProcessor({
      rpc: this.rpc,
      stateFile: config.stateFile,
      onTx: async ({ height, txBase64, txResult }) => {
        const alerts = parseTxToAlerts({
          txBase64,
          txResult,
          height,
          wallets: this.wallets,
        });
        for (const alert of alerts) await this.dispatch(alert, "pipeline");
      },
    });
    this.backfiller = new Backfiller({
      rpc: this.rpc,
      wallets: config.wallets,
      stateFile: config.backfillStateFile,
      dispatch: (alert) => this.dispatch(alert, "backfill"),
    });
  }

  /** Single delivery path: every alert passes the dedupe gate exactly once. */
  private async dispatch(alert: Alert, source: "pipeline" | "backfill"): Promise<void> {
    if (!this.deduper.markSeen(alert)) return;
    if (source === "backfill") {
      console.warn(`[backfill] MISSED tx recovered: ${alert.kind} at block ${alert.height} (tx ${alert.txHash.slice(0, 12)}...)`);
    } else {
      console.log(`[monitor] ${alert.kind} at block ${alert.height} (tx ${alert.txHash.slice(0, 12)}...)`);
    }
    await this.notifier.broadcast(formatAlert(alert, this.config.explorerTxUrl));
  }

  async start(): Promise<void> {
    const latest = await this.rpc.getLatestHeight();
    this.processor.init(latest);
    this.backfiller.init(this.processor.checkpoint);
    console.log(`[monitor] chain is at block ${latest}`);
    console.log(`[monitor] watching ${this.wallets.size} wallet(s): ${[...this.wallets].join(", ")}`);

    this.ws.on("connected", (url: string) => console.log(`[ws] connected to ${url}`));
    this.ws.on("subscribed", (queries: string[]) => {
      console.log(`[ws] ${queries.length} subscriptions active:`);
      for (const q of queries) console.log(`[ws]   ${q}`);
      console.log(
        "[monitor] detecting: MsgDelegate, MsgUndelegate, MsgBeginRedelegate, " +
          "MsgWithdrawDelegatorReward, MsgSend, MsgTransfer (IBC), MsgExecuteContract " +
          "(every tx in every block is protobuf-decoded; subscriptions are only wake-up signals)",
      );
    });
    this.ws.on("stale", () => console.warn("[ws] connection stale, forcing reconnect"));
    this.ws.on("reconnecting", (delay: number, url: string) =>
      console.warn(`[ws] reconnecting to ${url} in ${delay}ms`),
    );
    this.ws.on("error", (err: Error) => console.error(`[ws] error: ${err.message}`));
    this.ws.on("height", (height: number) => {
      console.log(`[ws] tracked wallet tx in block ${height}`);
      this.processor.scheduleCatchUp(height);
    });
    this.ws.connect();

    this.pollTimer = setInterval(async () => {
      try {
        const h = await this.rpc.getLatestHeight();
        this.processor.scheduleCatchUp(h);
      } catch (e) {
        console.error(`[poll] status fetch failed: ${String(e)}`);
      }
    }, this.config.pollIntervalMs);

    this.backfillTimer = setInterval(() => {
      void this.backfiller.sweep(this.processor.checkpoint);
    }, this.config.backfillIntervalMs);

    // periodic heartbeat so the logs always show where live monitoring is
    setInterval(() => {
      console.log(
        `[status] live at block ${this.processor.checkpoint}, backfill verified through ${this.backfiller.cursor}`,
      );
    }, 60_000).unref();
  }

  async getBalances(): Promise<WalletBalance[]> {
    return Promise.all(
      [...this.wallets].map(async (wallet): Promise<WalletBalance> => {
        try {
          return { wallet, amount: await this.rpc.getBalance(wallet) };
        } catch (e) {
          return { wallet, amount: { error: `lookup failed: ${String(e)}` } };
        }
      }),
    );
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.backfillTimer) clearInterval(this.backfillTimer);
    this.ws.close();
  }
}
