import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { TRANSFER_TOPIC } from "./erc20.js";
import type { MinimalLog } from "./processLog.js";

const HEARTBEAT_INTERVAL_MS = 30_000;
const STALE_AFTER_MS = 60_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

interface RawSubscriptionLog {
  address: string;
  topics: string[];
  data: string;
  transactionHash: string;
  logIndex: string;
  blockNumber: string;
  removed?: boolean;
}

/**
 * Subscribes to every Transfer event on the ZIG token contract via raw
 * eth_subscribe (not ethers' WebSocketProvider, which doesn't auto-reconnect)
 * — matching in the caller against watched wallets, same pattern as
 * ZigWsClient: reconnects with exponential backoff, rotates across
 * ETH_WS_URLS on each reconnect, and forces a reconnect if the socket goes
 * silent for 60s.
 */
export class EthWsMonitor extends EventEmitter {
  private readonly wsUrls: string[];
  private urlIndex = 0;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private lastMessageAt = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(
    wsUrls: string[],
    private readonly tokenAddress: string,
  ) {
    super();
    if (wsUrls.length === 0) throw new Error("EthWsMonitor needs at least one WS endpoint");
    this.wsUrls = wsUrls;
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
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_subscribe",
          params: ["logs", { address: this.tokenAddress, topics: [TRANSFER_TOPIC] }],
        }),
      );
      this.startHeartbeat();
    });

    ws.on("message", (data) => {
      this.lastMessageAt = Date.now();
      this.handleMessage(data.toString());
    });

    ws.on("pong", () => {
      this.lastMessageAt = Date.now();
    });

    ws.on("error", (err) => this.emit("error", err));

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

  private handleMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg?.id === 1 && msg?.error) {
      this.emit("error", new Error(`eth_subscribe failed: ${JSON.stringify(msg.error)}`));
      return;
    }
    const result: RawSubscriptionLog | undefined = msg?.params?.result;
    if (!result || result.removed) return;

    const log: MinimalLog = {
      topics: result.topics,
      data: result.data,
      transactionHash: result.transactionHash,
      index: Number.parseInt(result.logIndex, 16),
      blockNumber: Number.parseInt(result.blockNumber, 16),
    };
    this.emit("log", log);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastMessageAt > STALE_AFTER_MS) {
        this.emit("stale");
        ws.terminate();
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
    this.urlIndex = (this.urlIndex + 1) % this.wsUrls.length;
    const delay = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * 2 ** this.reconnectAttempts++);
    this.emit("reconnecting", delay, this.currentUrl);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
