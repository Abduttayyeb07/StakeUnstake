import { readFileSync, writeFileSync } from "node:fs";
import { Telegraf } from "telegraf";
import { escapeHtml, formatMicroAmount, shortenAddress } from "./format.js";

export interface Notifier {
  broadcast(html: string): Promise<void>;
  /** Operational/health messages (reconnects, stale connections, ...) — private, not broadcast to every subscriber. */
  notifyAdmin(html: string): Promise<void>;
}

export interface WalletBalance {
  wallet: string;
  /** display name, e.g. "Deal 1", if the wallet was given as "Name:address" */
  label?: string;
  /** uzig amount, or an error message if the query failed */
  amount: string | { error: string };
  /** pre-formatted display string (e.g. "1,234.5 ZIG"), overrides the default uzig-based formatting — used for non-Cosmos chains */
  formatted?: string;
}

function formatBalances(balances: WalletBalance[]): string {
  const lines = balances.map(({ wallet, label, amount, formatted }) => {
    const addr = escapeHtml(shortenAddress(wallet));
    const heading = label ? `${escapeHtml(label)} (<code>${addr}</code>)` : `<code>${addr}</code>`;
    if (typeof amount !== "string") return `${heading}: <i>${escapeHtml(amount.error)}</i>`;
    return `${heading}: <b>${escapeHtml(formatted ?? `${formatMicroAmount(amount)} ZIG`)}</b>`;
  });
  return `💼 <b>Wallet Balances</b>\n${lines.join("\n")}`;
}

/** Fallback when no TELEGRAM_BOT_TOKEN is set: print alerts to stdout. */
export class ConsoleNotifier implements Notifier {
  async broadcast(html: string): Promise<void> {
    const text = html.replace(/<[^>]+>/g, "");
    console.log(`\n=== ALERT ===\n${text}\n=============`);
  }

  async notifyAdmin(html: string): Promise<void> {
    const text = html.replace(/<[^>]+>/g, "");
    console.log(`\n=== ADMIN ===\n${text}\n=============`);
  }
}

export class TelegramNotifier implements Notifier {
  private readonly bot: Telegraf;
  private readonly subscribers = new Set<string>();

  constructor(
    token: string,
    seedChatIds: string[],
    private readonly subscribersFile: string,
    private readonly getBalances?: () => Promise<WalletBalance[]>,
    /** Chat id for operational/health messages (reconnects, stale connections, ...) — private, not the broadcast list. */
    private readonly adminChatId?: string,
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
    this.bot.command("balances", async (ctx) => {
      if (!this.getBalances) return ctx.reply("Balance lookup is not configured.");
      const balances = await this.getBalances();
      await ctx.replyWithHTML(formatBalances(balances));
    });
  }

  /** Lets other monitors (e.g. the ETH one) register their own commands on the same bot/token. */
  registerCommand(name: string, handler: Parameters<Telegraf["command"]>[1]): void {
    this.bot.command(name, handler);
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

  async notifyAdmin(html: string): Promise<void> {
    if (!this.adminChatId) return; // no ADMIN_CHAT_ID configured — silently skip, not broadcast
    await this.bot.telegram
      .sendMessage(this.adminChatId, html, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      })
      .catch((e: unknown) => {
        console.error(`[telegram] admin notify to ${this.adminChatId} failed: ${String(e)}`);
      });
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
