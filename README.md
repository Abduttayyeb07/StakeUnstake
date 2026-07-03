# ZigChain Staking Monitor

Watches wallets on ZigChain mainnet and sends a Telegram alert for every
send, IBC transfer, contract call, delegate, undelegate, and redelegate.
Amounts are in ZIG (1,000,000 uzig = 1 ZIG).

## How it works

```
WebSocket (3 subs per wallet) ──┐
                                ├──► BlockProcessor.scheduleCatchUp(height)
Polling fallback every 10s ─────┘
          │
          ▼
  enqueue checkpoint+1 … latest   (gaps always healed, each block once)
          │
          ▼
  /block + /block_results  →  protobuf-decode every tx (cosmjs-types)
          │
          ▼
  tracked wallet is signer/delegator/recipient?  →  Telegram alert
```

- Failed txs (`code !== 0`) are skipped.
- Each block retries up to 5× with exponential backoff before being skipped.
- WebSocket pings every 30s and force-reconnects if silent for 60s.
- Checkpoint persists to `state.json`, so downtime gaps are healed on restart.
- `completion_time` for undelegate/redelegate is pulled from the raw
  `unbond`/`redelegate` events (it is not in the protobuf message).

**Backfill safety net:** every 5 minutes (`BACKFILL_INTERVAL_MS`) a `tx_search`
sweep re-queries all three wallet filters over the height range the block
pipeline has already finished. Anything the pipeline delivered is dropped by
the persistent dedupe store (`alerts-seen.json`); anything it somehow missed
is alerted with a `[backfill] MISSED tx recovered` log line. The backfill
cursor (`backfill-state.json`) only advances on a fully successful sweep, so
a failed sweep retries the same range — and no alert is ever sent twice.

## Setup

```
npm install
copy .env.example .env    # fill in TELEGRAM_BOT_TOKEN (+ optional TELEGRAM_CHAT_ID)
npm run dev
```

Without a `TELEGRAM_BOT_TOKEN`, alerts print to the console instead — useful
for a dry run. With a token, users subscribe by sending `/start` to the bot
(`/stop` unsubscribes, `/status` shows subscriber count, `/balances` shows
each tracked wallet's live ZIG balance).

**How `/balances` works:** it queries the bank module's `Balance` gRPC method
through Tendermint's generic `abci_query` RPC endpoint — the same endpoints
(with the same failover) the rest of the bot already uses, so no extra LCD/REST
dependency is needed. The request is a protobuf-encoded `QueryBalanceRequest`
sent as `abci_query?path="/cosmos.bank.v1beta1.Query/Balance"&data=0x<hex>`;
the response's base64 `value` is decoded back into a `QueryBalanceResponse` to
read `balance.amount` (uzig), then formatted the same way as everywhere else
(÷1,000,000 → ZIG).

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | run the monitor (tsx, no build step) |
| `npm run build` && `npm start` | compile to `dist/` and run |
| `npm test` | unit tests (parser, formatter, block processor) |
| `$env:INTEGRATION="1"; npm test` | also run live tests against mainnet RPC |
| `npm run replay -- <height>` | replay a real block and print the alerts that would fire |

## Config (.env)

| Var | Default | Notes |
| --- | --- | --- |
| `WALLET_ADDRESS` | `zig1wrje0m...ksg4` | comma-separated for multiple wallets |
| `RPC_URL` | zigscan + wickhub fallback | comma-separated; first is primary, failover is automatic and sticky |
| `WS_URL` | zigscan + wickhub fallback | comma-separated; each reconnect rotates to the next endpoint |
| `TELEGRAM_BOT_TOKEN` | _(empty = console mode)_ | |
| `TELEGRAM_CHAT_ID` | _(empty)_ | always-alerted chat ids, comma-separated |
| `POLL_INTERVAL_MS` | `10000` | polling fallback interval |
