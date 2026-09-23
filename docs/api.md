# API

The server exposes a REST API under `/api`, a versioned namespace under `/api/v1`, a WebSocket endpoint at
`/ws`, and read-only endpoints for AI assistants under `/api/ai`. The full request and response schemas are
in the OpenAPI document:

- UI: `GET /api/docs`
- JSON: `GET /api/docs/openapi.json`

Unknown `/api/*` paths return a JSON error instead of the web client.

## Route groups

| Group | |
|---|---|
| `/api/health` | `GET /api/health` and `/api/health/live` report MongoDB connectivity. `/api/health/ready` also checks daemon RPC and returns `ok`, `degraded` or `down`; the deploy script waits on it |
| `/api/dashboard` | Dashboard overview |
| `/api/blocks`, `/api/block` | Blocks |
| `/api/txs`, `/api/tx` | Transactions |
| `/api/address` | Addresses |
| `/api/richlist`, `/api/stats`, `/api/search` | Rich list, statistics, search |
| `/api/sync` | Indexer sync state |
| `/api/network` | Network, chain health, seed nodes and node feeds |
| `/api/mempool`, `/api/market`, `/api/coin` | Mempool, market data, coin constants |
| `/api/masternodes` | Masternodes |
| `/api/migration` | Migration transparency |
| `/api/ai` | Read-only endpoints for AI assistants (see below) |
| `/api/admin` | Admin endpoints, protected by `ADMIN_API_KEY` |

Versioned namespace:

- `/api/v1/meta`
- `/api/v1/network/*`
- `/api/v1/rewards/*`
- `/api/v1/blocks/*`, `/api/v1/txs/*`, `/api/v1/address/*`
- `/api/v1/masternodes/*`
- `/api/v1/provider-tags/*`
- `/api/v1/node-inventory` and `/api/v1/node-inventory/versions`
- `/api/v1/network-noise/summary` (public) and `/api/v1/network-noise/ingest` (per-node bearer token)
- `/api/v1/migration/*`

## Realtime WebSocket

- local: `ws://127.0.0.1:3001/ws`
- behind a TLS proxy: `wss://<your-domain>/ws`

Server events: `hello`, `sync:status`, `block:new`, `tx:new`, `pong`, `error`. Client event: `ping`.

When `CORS_ORIGINS` is set, it also decides which `Origin` values may open `/ws`.

## Provider tags

Provider attribution works by CIDR/IP rules.

Public endpoints:

- `GET /api/v1/provider-tags/active`
- `POST /api/v1/provider-tags/submit`
- `POST /api/v1/provider-tags/submit-bulk`

The bulk flow takes one entry per line (`IP`, `IP:port` or CIDR), normalizes entries to CIDR (`IP` becomes
`/32`), removes duplicates, reports invalid lines and queues everything for review (`pending`) instead of
activating it.

Admin endpoints (`x-api-key: <ADMIN_API_KEY>` or `Authorization: Bearer <ADMIN_API_KEY>`):

- `GET /api/admin/provider-tags`, `POST /api/admin/provider-tags`
- `PATCH /api/admin/provider-tags/:id/active`
- `GET /api/admin/provider-tags/submissions`
- `POST /api/admin/provider-tags/submissions/:id/approve`
- `POST /api/admin/provider-tags/submissions/:id/reject`

When the Telegram bot is enabled, single submissions (`POST /api/v1/provider-tags/submit`) are also sent to
the admin with approve and reject buttons. Bulk submissions are reviewed through the admin API only.

## Nodes and node inventory

- `GET /api/network/seed-nodes`: the three hardcoded seed nodes from DeFCoN Core `chainparamsseeds.h`. Each
  seed publishes `http://<seed>/api/seed-status.json`; the server polls it every 60 seconds and reports
  divergence only when two seeds show different hashes at the same height or their tips are more than 3
  blocks apart.
- `GET /api/network/pre-release-nodes`: the Test Nodes panel. Optional external feed at
  `PRE_RELEASE_NODES_API_URL`; `PRE_RELEASE_NODES_API_KEY` is sent as `X-API-Key` from the server only and
  never reaches the browser.
- `GET /api/network/dns-seeder-nodes`: the DNS-Seeder panel. Optional external feed at `DNS_SEEDER_API_URL`.
- `GET /api/network/chain-health`, `GET /api/network/ops-status`
- `GET /api/v1/node-inventory`, `GET /api/v1/node-inventory/versions`

Both external feeds return JSON: an array of node records, or an object with a `data` or `nodes` array. The
feed routes normalize the fields, enrich DNS-seeder rows with local peer metadata and live peer heights from
RPC when available, serve the last good snapshot on upstream failure while it is younger than
`NODE_INVENTORY_STALE_MAX_AGE_MS`, and return an empty list, without an upstream request, when the feed URL is
unset.

`nodeInventory.service` collects all sources every `NODE_INVENTORY_POLL_INTERVAL_MS` and stores the result in
MongoDB. The node-inventory endpoints mark nodes below `NODE_INVENTORY_MIN_VERSION` (default `23.0.0`) as
deprecated.

## Network noise

Agents running next to monitored nodes push observations to `POST /api/v1/network-noise/ingest` with a
per-node bearer token; `GET /api/v1/network-noise/summary` feeds the Network Noise Monitor page. Ingest is
disabled unless `NETWORK_NOISE_MONITOR_ENABLED=true`. The contract and scoring are in
[`network-noise-monitor.md`](network-noise-monitor.md).

## AI endpoints and MCP

Read-only endpoints for AI assistants and bots (GET only, `Access-Control-Allow-Origin: *`):

- `GET /api/ai/lookup?q=`: an address, a 64-character transaction or block hash, or a block height
- `GET /api/ai/network`: chain tip and masternode counts
- `GET /api/ai/masternode?q=`: a masternode by IP, `IP:port` or proTxHash

Amounts in `/api/ai/*` responses are integer strings in satoshis (1 DFCN = 100,000,000 satoshis).

Discovery files are served from `client/public`: `/llms.txt`, `/llms-full.txt`, `/.well-known/llms.txt` and
`/.well-known/deftrack-ai.json`.

The `mcp/` workspace is a stdio MCP server with the tools `lookup`, `network`, `masternode` and `pose_bans`.
It sends only `GET` requests to the public API and limits itself to 20 requests per minute. Build, run and
client configuration are in [`mcp/README.md`](../mcp/README.md).
