import { loadConfig } from "./config.js";
import { loadEthConfig } from "./ethConfig.js";
import { StakingMonitor } from "./monitor.js";
import { EthMonitor } from "./eth/monitor.js";
import { EthDailySnapshotScheduler } from "./eth/dailySnapshot.js";
import { SheetsClient } from "./sheets.js";
import { formatTransferAlert } from "./eth/alerts.js";
import { ConsoleNotifier, TelegramNotifier, type Notifier, type WalletBalance } from "./telegram.js";

const MAX_VERIFY_RANGE = 10;

async function main(): Promise<void> {
  const config = loadConfig();
  const ethConfig = loadEthConfig();

  let notifier: Notifier;
  let telegram: TelegramNotifier | null = null;
  // monitors depend on notifier, but /balances on the bot depends on the monitors —
  // bind the callback to not-yet-created monitors and fill them in below
  let monitor: StakingMonitor;
  let ethMonitor: EthMonitor | null = null;

  const getAllBalances = async (): Promise<WalletBalance[]> => {
    const results = await Promise.all([
      monitor.getBalances(),
      ethMonitor ? ethMonitor.getBalances() : Promise.resolve([]),
    ]);
    return results.flat();
  };

  if (config.telegramBotToken) {
    telegram = new TelegramNotifier(
      config.telegramBotToken,
      config.telegramChatIds,
      config.subscribersFile,
      getAllBalances,
      config.adminChatId,
    );
    await telegram.start();
    notifier = telegram;
    console.log("[main] telegram notifier active");
  } else {
    notifier = new ConsoleNotifier();
    console.warn("[main] TELEGRAM_BOT_TOKEN not set — alerts will print to console");
  }

  monitor = new StakingMonitor(config, notifier);
  await monitor.start();

  let ethSnapshot: EthDailySnapshotScheduler | null = null;
  if (ethConfig.enabled) {
    ethMonitor = new EthMonitor(ethConfig, notifier);
    await ethMonitor.start();

    if (config.googleCredentialsPath) {
      ethSnapshot = new EthDailySnapshotScheduler({
        rpc: ethMonitor.rpc,
        sheets: new SheetsClient(config.googleCredentialsPath, config.googleSpreadsheetId),
        config: ethConfig,
        stateFile: ethConfig.snapshotStateFile,
      });
      ethSnapshot.init();
      ethSnapshot.start();
      console.log("[eth-snapshot] daily Google Sheets snapshot scheduled for 00:00 PKT");
    }

    if (telegram) {
      telegram.registerCommand("verify", async (ctx) => {
        const text = "text" in ctx.message ? ctx.message.text : "";
        const [, fromStr, toStr] = text.split(/\s+/);
        const fromBlock = Number(fromStr);
        const toBlock = toStr === undefined ? fromBlock : Number(toStr);
        if (!Number.isInteger(fromBlock) || !Number.isInteger(toBlock) || fromBlock < 0) {
          return ctx.reply("usage: /verify <fromBlock> [toBlock] (range ≤ 10 blocks)");
        }
        if (toBlock < fromBlock || toBlock - fromBlock > MAX_VERIFY_RANGE) {
          return ctx.reply(`range too large — max ${MAX_VERIFY_RANGE} blocks`);
        }
        await ctx.reply(`Re-scanning blocks ${fromBlock}-${toBlock}...`);
        try {
          const results = await ethMonitor!.verifyRange(fromBlock, toBlock);
          // Private reply only — never notifier.broadcast(), so /verify never
          // spams every subscriber, only the chat that ran the command.
          for (const { alert, isNew } of results) {
            await ctx.replyWithHTML(formatTransferAlert(alert, ethConfig, !isNew));
          }
          const newCount = results.filter((r) => r.isNew).length;
          const oldCount = results.length - newCount;
          await ctx.reply(
            results.length === 0
              ? "Done — no transfers found in that range."
              : `Done — ${newCount} new, ${oldCount} already known.`,
          );
        } catch (e) {
          await ctx.reply(`Verify failed: ${String(e)}`);
        }
      });
    }
  }

  const shutdown = (signal: string) => {
    console.log(`[main] ${signal} received, shutting down`);
    monitor.stop();
    ethMonitor?.stop();
    ethSnapshot?.stop();
    telegram?.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((e) => {
  console.error(`[main] fatal: ${String(e)}`);
  process.exit(1);
});
