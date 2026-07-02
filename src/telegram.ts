import { readFileSync, writeFileSync } from "node:fs";
import { Telegraf } from "telegraf";

export interface Notifier {
  broadcast(html: string): Promise<void>;
}

/** Fallback when no TELEGRAM_BOT_TOKEN is set: print alerts to stdout. */
export class ConsoleNotifier implements Notifier {
  async broadcast(html: string): Promise<void> {
    const text = html.replace(/<[^>]+>/g, "");
    console.log(`\n=== ALERT ===\n${text}\n=============`);
  }
}

export class TelegramNotifier implements Notifier {
  private readonly bot: Telegraf;
  private readonly subscribers = new Set<string>();

  constructor(
    token: string,
    seedChatIds: string[],
    private readonly subscribersFile: string,
  ) {
    this.bot = new Telegraf(token);
    for (const id of seedChatIds) this.subscribers.add(id);
    this.loadSubscribers();

    this.bot.command("start", (ctx) => {
      this.subscribers.add(String(ctx.chat.id));
      this.saveSubscribers();
      return ctx.reply("Subscribed to ZigChain wallet alerts. Send /stop to unsubscribe.");
    });
    this.bot.command("stop", (ctx) => {
      this.subscribers.delete(String(ctx.chat.id));
      this.saveSubscribers();
      return ctx.reply("Unsubscribed.");
    });
    this.bot.command("status", (ctx) =>
      ctx.reply(`Monitoring active. Subscribers: ${this.subscribers.size}`),
    );
  }

  async start(): Promise<void> {
    // launch() resolves only when the bot stops; don't await it
    void this.bot.launch();
  }

  stop(): void {
    this.bot.stop("shutdown");
  }

  async broadcast(html: string): Promise<void> {
    const sends = [...this.subscribers].map((chatId) =>
      this.bot.telegram
        .sendMessage(chatId, html, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        })
        .catch((e: unknown) => {
          console.error(`[telegram] send to ${chatId} failed: ${String(e)}`);
        }),
    );
    await Promise.all(sends);
  }

  private loadSubscribers(): void {
    try {
      const ids = JSON.parse(readFileSync(this.subscribersFile, "utf8"));
      if (Array.isArray(ids)) for (const id of ids) this.subscribers.add(String(id));
    } catch {
      // no subscribers file yet
    }
  }

  private saveSubscribers(): void {
    try {
      writeFileSync(this.subscribersFile, JSON.stringify([...this.subscribers], null, 2));
    } catch (e) {
      console.error(`[telegram] failed to persist subscribers: ${String(e)}`);
    }
  }
}
