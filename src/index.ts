import { loadConfig } from "./config.js";
import { StakingMonitor } from "./monitor.js";
import { ConsoleNotifier, TelegramNotifier, type Notifier } from "./telegram.js";

async function main(): Promise<void> {
  const config = loadConfig();

  let notifier: Notifier;
  let telegram: TelegramNotifier | null = null;
  if (config.telegramBotToken) {
    telegram = new TelegramNotifier(
      config.telegramBotToken,
      config.telegramChatIds,
      config.subscribersFile,
    );
    await telegram.start();
    notifier = telegram;
    console.log("[main] telegram notifier active");
  } else {
    notifier = new ConsoleNotifier();
    console.warn("[main] TELEGRAM_BOT_TOKEN not set — alerts will print to console");
  }

  const monitor = new StakingMonitor(config, notifier);
  await monitor.start();

  const shutdown = (signal: string) => {
    console.log(`[main] ${signal} received, shutting down`);
    monitor.stop();
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
