# ZigChain Staking Monitor

Watches wallets on ZigChain mainnet and sends a Telegram alert for every
send, IBC transfer, contract call, delegate, undelegate, redelegate, and
staking reward claim. Amounts are in ZIG (1,000,000 uzig = 1 ZIG). Optionally
also logs a daily balance/delegation/rewards snapshot to Google Sheets at
midnight PKT — see "Google Sheets" below.

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
| `WALLET_ADDRESS` | `zig1wrje0m...ksg4` | comma-separated; each entry can be `Name:address` to label a wallet in alerts/`/balances`, e.g. `Deal 1:zig1wrje0m...,Deal 2:zig1qqre8...` |
| `RPC_URL` | zigscan + wickhub fallback | comma-separated; first is primary, failover is automatic and sticky |
| `WS_URL` | zigscan + wickhub fallback | comma-separated; each reconnect rotates to the next endpoint |
| `TELEGRAM_BOT_TOKEN` | _(empty = console mode)_ | |
| `TELEGRAM_CHAT_ID` | _(empty)_ | always-alerted chat ids, comma-separated |
| `POLL_INTERVAL_MS` | `10000` | polling fallback interval |
| `GOOGLE_CREDENTIALS_PATH` | _(empty = disabled)_ | path to a Google service-account JSON key; see "Google Sheets" below |
| `GOOGLE_SPREADSHEET_ID` | the Deal 1/Deal 2 sheet | full URL or bare spreadsheet id |
| `STZIG_DENOM` | ZigChain's stZIG bank denom | only change this if the protocol issues a new denom |

## Google Sheets

When `GOOGLE_CREDENTIALS_PATH` is set, once every day at **00:00 Pakistan
Time (PKT, UTC+5)** the bot appends one snapshot row per labeled wallet to
that wallet's sheet tab. This is completely independent of Telegram alerting
— it runs on its own daily schedule, not per-transaction, and a Sheets
failure can never delay or affect Telegram alerts.

| Address | Day | ZIG balance | stZIG balance | Delegation on validator | Daily Rewards balance |
| --- | --- | --- | --- | --- | --- |

- **Sheet tab** = the wallet's `WALLET_ADDRESS` label (`Deal 1:zig1wrje0m...` → tab `Deal 1`). A tab must already exist with that exact name for each labeled wallet, or that wallet is skipped.
- **Day**: the PKT calendar date that just ended at the moment of the snapshot.
- **ZIG / stZIG balance**: live bank balances (`uzig` and `STZIG_DENOM`), queried at midnight.
- **Delegation on validator**: sum of the wallet's active delegations across every validator.
- **Daily Rewards balance**: total unclaimed staking rewards across every validator at that moment (the live pending balance, not "rewards claimed that day").
- **Missed days aren't backfilled** — if the bot was down across a midnight boundary, that day's row is skipped rather than logged with today's (wrong) balances. A `[snapshot] ... day(s) missed while down` warning appears in the logs so it's never silent.
- The scheduled date/state persists to `SNAPSHOT_STATE_FILE`, so a restart right at midnight can't double-write the same day.

**One-time setup:**
1. In Google Cloud Console, create a service account and download its JSON key. Place it in the project root (Docker: also update the filename in `docker-compose.yml`'s volume mount).
2. Share the spreadsheet with the service account's `client_email` (found in the JSON key) as **Editor**.
3. Set `GOOGLE_CREDENTIALS_PATH` to that file's path in `.env`.
4. Make sure each labeled wallet has a matching sheet tab (`Deal 1`, `Deal 2`, ...) with the 6 columns above, in order.
