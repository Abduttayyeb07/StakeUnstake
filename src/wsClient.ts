import { EventEmitter } from "node:events";
import WebSocket from "ws";

const HEARTBEAT_INTERVAL_MS = 30_000;
const STALE_AFTER_MS = 60_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

/**
 * Tendermint WebSocket client. Opens 3 subscriptions per tracked wallet
 * (message.sender / transfer.sender / transfer.recipient) and emits
 * "height" whenever a matching tx lands. Auto-reconnects with exponential
 * backoff and a 30s ping heartbeat; forces reconnect if the socket goes
 * silent for 60s. Each reconnect rotates to the next endpoint in the list,
 * so a dead primary fails over to the fallback automatically.
 */
export class ZigWsClient extends EventEmitter {
  private readonly wsUrls: string[];
  private urlIndex = 0;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private lastMessageAt = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(
    wsUrls: string | string[],
    private readonly wallets: string[],
  ) {
    super();
    this.wsUrls = Array.isArray(wsUrls) ? wsUrls : [wsUrls];
    if (this.wsUrls.length === 0) throw new Error("ZigWsClient needs at least one endpoint");
  }

  get currentUrl(): string {
    return this.wsUrls[this.urlIndex % this.wsUrls.length];
  }

  connect(): void {
    this.closed = false;
    const ws = new WebSocket(this.currentUrl);
    this.ws = ws;

    ws.on("open", () => {
      this.reconnectAttempts = 0;
      this.lastMessageAt = Date.now();
      this.emit("connected", this.currentUrl);
      this.subscribeAll(ws);
      this.startHeartbeat();
    });

    ws.on("message", (data) => {
      this.lastMessageAt = Date.now();
      this.handleMessage(data.toString());
    });

    ws.on("pong", () => {
      this.lastMessageAt = Date.now();
    });

    ws.on("error", (err) => {
      this.emit("error", err);
    });

    ws.on("close", () => {
      this.stopHeartbeat();
      if (!this.closed) this.scheduleReconnect();
    });
  }

  close(): void {
    this.closed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  private subscribeAll(ws: WebSocket): void {
    const queries = this.wallets.flatMap((wallet) => [
      `tm.event='Tx' AND message.sender='${wallet}'`,
      `tm.event='Tx' AND transfer.sender='${wallet}'`,
      `tm.event='Tx' AND transfer.recipient='${wallet}'`,
    ]);
    queries.forEach((query, i) => {
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "subscribe",
          id: i + 1,
          params: { query },
        }),
      );
    });
    this.emit("subscribed", queries);
  }

  private handleMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const height =
      msg?.result?.data?.value?.TxResult?.height ??
      msg?.result?.events?.["tx.height"]?.[0];
    if (height !== undefined) {
      const h = Number(height);
      if (Number.isFinite(h) && h > 0) this.emit("height", h);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastMessageAt > STALE_AFTER_MS) {
        this.emit("stale");
        ws.terminate(); // triggers "close" -> reconnect
        return;
      }
      ws.ping();
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    this.urlIndex = (this.urlIndex + 1) % this.wsUrls.length; // try next endpoint
    const delay = Math.min(
      MAX_RECONNECT_DELAY_MS,
      1000 * 2 ** this.reconnectAttempts++,
    );
    this.emit("reconnecting", delay, this.currentUrl);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
