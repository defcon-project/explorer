# Network Noise Monitor

The Network Noise Monitor is a diagnostic view of problems that monitored DeFCoN nodes find in their own logs and RPC state, such as ChainLock conflicts, chain-tip divergence, quorum and PoSe problems, peer churn, sync stalls, and resource pressure. Agents running on the nodes classify these events and push them to the explorer. The explorer stores them, scores them, and publishes an aggregated view at `/devtools/network-noise`.

The monitor is passive. The server does not contact the reporting nodes and takes no action on them. A signal reported by several nodes at the same time is correlation, not proof of cause.

## Architecture

```text
DeFCoN node + agent (external, one per node)
  -> POST /api/v1/network-noise/ingest      Authorization: Bearer <per-node token>
DefTrack server
  -> networknoiseobservations               one document per signal, removed by a TTL index
  -> networknoisenodestates                 one document per node, latest snapshot and score
  -> GET /api/v1/network-noise/summary      public, no authentication
Web client
  -> /devtools/network-noise                polls the summary every 60 s while the tab is visible
```

This repository does not include the node-side agent. It only defines the ingest contract below, so any agent that follows it can report. The agent decides which log lines and RPC readings count as a signal, and it assigns the signal types.

| Component | Location |
| --- | --- |
| Ingest and summary routes, payload schema | `server/src/routes/v1/networkNoise.v1.routes.ts` |
| Scoring, storage, and aggregation | `server/src/services/networkNoise.service.ts` |
| MongoDB models | `server/src/models/NetworkNoiseObservation.ts`, `server/src/models/NetworkNoiseNodeState.ts` |
| Summary response contract | `shared/src/contracts/nodeMonitoring.ts` |
| Page | `client/src/pages/NetworkNoisePage.tsx` |

## Ingest API

```http
POST /api/v1/network-noise/ingest
Content-Type: application/json
Authorization: Bearer <token>
```

The server handles a request in this order:

1. If `NETWORK_NOISE_MONITOR_ENABLED` is off, it returns `503` with code `DISABLED`.
2. It validates the body against the schema below. On failure it returns `400` with code `BAD_REQUEST` and the first validation message.
3. It looks up the token configured for the payload's `nodeId` and compares it with the bearer token in constant time. A missing, unknown, or wrong token returns `401` with code `UNAUTHORIZED`.
4. If `sequence` is less than or equal to the last accepted sequence for that node, the server stores nothing and returns `200` with `duplicate: true`.
5. Otherwise it stores the batch and returns `202`.

Error bodies have the form `{"success": false, "error": {"code": "...", "message": "..."}}`. A storage failure returns `500` with code `INTERNAL` and an `errorId`. Responses produced before the route handler runs do not use this shape: a body that is not valid JSON (`400`) or is larger than 100 KB (`413`) is answered by Express's default error handler, and `429` responses carry the rate limiter's plain-text message.

Limits:

- 120 ingest requests per minute per client IP, in addition to the global API limit (`RATE_LIMIT_MAX_PER_MINUTE`, default 1200). A client over either limit gets `429`.
- The request body can be at most 100 KB, the Express JSON parser default. Larger bodies get `413`.
- Each payload can carry at most 100 signals and each signal at most 20 peer IPs.

### Payload Schema (`schemaVersion` 1)

Length limits apply after leading and trailing whitespace is trimmed. Unknown fields are dropped.

| Field | Type | Rules |
| --- | --- | --- |
| `schemaVersion` | number | Must be `1` |
| `agentVersion` | string | 1-32 characters |
| `nodeId` | string | 1-64 characters from `A-Z a-z 0-9 . _ -`. It must have a token in `NETWORK_NOISE_INGEST_TOKENS` |
| `nodeRole` | string | `seed`, `fullnode`, `test_mn`, `masternode`, or `unknown` |
| `observedAt` | string | ISO 8601 date-time with `Z` or a UTC offset |
| `sequence` | integer | 0 or greater. It must increase with every batch the node sends |
| `snapshot` | object | Node state when the batch was built (see below) |
| `signals` | array | 0-100 signal objects (see below). An empty array means a clean cycle |

`snapshot` fields. Only `ip` is required; every other field may be omitted or set to `null`.

| Field | Type | Rules |
| --- | --- | --- |
| `ip` | string | IPv4 or IPv6 address. The node reports this value itself; the server does not compare it with the request's source address |
| `walletVersion` | string | Up to 64 characters |
| `blockHeight` | integer | 0 or greater |
| `bestBlockHash` | string | Up to 64 characters |
| `chainLockHeight` | integer | 0 or greater |
| `chainLockHash` | string | Up to 64 characters |
| `connections`, `inbound`, `outbound` | integer | 0 or greater |
| `syncing` | boolean | |

`signals[]` fields:

| Field | Type | Rules |
| --- | --- | --- |
| `type` | string | 1-64 characters from `a-z 0-9 _` (see [Signal Types and Scoring](#signal-types-and-scoring)) |
| `fingerprint` | string | 8-128 characters. A stable identifier the agent assigns to the normalized event |
| `count` | integer | 1-100000 occurrences in this batch |
| `firstSeenAt`, `lastSeenAt` | string | ISO 8601 date-time with `Z` or a UTC offset |
| `peerIps` | string[] | Optional. Up to 20 IPv4 or IPv6 addresses |
| `sample` | string | Optional, may be `null`. A redacted log excerpt of up to 300 characters. The whole payload is rejected if any sample is longer |

The server does not check whether the timestamps are close to the current time.

### Example

```bash
curl -X POST "https://explorer.example.com/api/v1/network-noise/ingest" \
  -H "Authorization: Bearer $NOISE_TOKEN" \
  -H "Content-Type: application/json" \
  --data @payload.json
```

`payload.json`:

```json
{
  "schemaVersion": 1,
  "agentVersion": "1.0.0",
  "nodeId": "fullnode-a",
  "nodeRole": "fullnode",
  "observedAt": "2026-09-23T09:22:07Z",
  "sequence": 1042,
  "snapshot": {
    "ip": "198.51.100.10",
    "walletVersion": "v23.0.0",
    "blockHeight": 144500,
    "bestBlockHash": "<64-character block hash>",
    "chainLockHeight": 144500,
    "chainLockHash": "<64-character block hash>",
    "connections": 12,
    "inbound": 4,
    "outbound": 8,
    "syncing": false
  },
  "signals": [
    {
      "type": "chainlock_conflict",
      "fingerprint": "3c6d1e0f9a2b4c5d6e7f8091",
      "count": 2,
      "firstSeenAt": "2026-09-23T09:21:10Z",
      "lastSeenAt": "2026-09-23T09:21:40Z",
      "sample": "AcceptBlockHeader: block <hash> is marked conflicting"
    },
    {
      "type": "peer_rejection",
      "fingerprint": "9f8e7d6c5b4a39281706f5e4",
      "count": 3,
      "firstSeenAt": "2026-09-23T09:21:05Z",
      "lastSeenAt": "2026-09-23T09:22:01Z",
      "peerIps": ["203.0.113.25", "203.0.113.40"],
      "sample": "peer=<id> disconnected: <reason>"
    }
  ]
}
```

Response (`202`):

```json
{ "success": true, "data": { "duplicate": false, "acceptedSignals": 2, "noiseScore": 54 } }
```

If the same batch is sent again, the response is `200` with `{ "duplicate": true, "acceptedSignals": 0, "noiseScore": 0 }`.

## Storage

For each accepted batch:

- **Observations** (`networknoiseobservations`). Each signal becomes one document. It holds the signal fields, the node's `nodeId`, role, reported `ip` and wallet version, and the batch's chain snapshot (height, best hash, ChainLock height and hash). The document key is `sha256("<nodeId>:<sequence>:<type>:<fingerprint>")`, and the server inserts it only if the key is new, so a repeated signal within one batch is stored once. Peer IPs are deduplicated. `expiresAt` is set to `observedAt` plus `NETWORK_NOISE_OBSERVATION_TTL_DAYS`, and a MongoDB TTL index deletes the document after that time. The TTL is fixed when the document is inserted, so changing the setting affects only new observations.
- **Node state** (`networknoisenodestates`). One document per `nodeId`. The server overwrites it with the latest snapshot, `agentVersion`, `lastSequence`, `lastReportedAt` (the batch's `observedAt`), `noiseScore`, `signalCount` (the sum of `count` over the batch's signals), and `activeSignalTypes` (the batch's distinct types). A batch with no signals also sets `lastCleanAt`.

Consequences for agents and operators:

- A node's score and active signal types always come from its latest accepted batch. A clean batch resets the node to a score of 0. Its earlier observations stay in the timeline until they expire.
- Stale detection uses the agent's own clock (`observedAt`). An agent must report more often than `NETWORK_NOISE_STALE_AFTER_MS`, or the node shows as stale.
- If an agent restarts its sequence at a lower number, the server treats every batch as a duplicate until the sequence passes the stored `lastSequence`. Deleting the node's state document resets this.
- Node state documents never expire. When you remove a node's token, it can no longer report, but it still appears in the summary as stale until you delete its state document.

## Signal Types and Scoring

The server gives each type a weight. It accepts any type name that matches the pattern and gives unlisted types a weight of 3.

| Type | Weight | Chain-related |
| --- | ---: | :---: |
| `chain_tip_divergence` | 25 | yes |
| `reorg_attempt` | 20 | yes |
| `chainlock_conflict` | 18 | yes |
| `sync_stall` | 18 | |
| `rpc_unavailable` | 18 | |
| `llmq_quorum` | 15 | |
| `clock_drift` | 15 | |
| `pose_instability` | 12 | |
| `resource_pressure` | 8 | |
| `peer_rejection` | 6 | |
| `stale_peer` | 5 | |
| `peer_churn` | 4 | |
| any other type | 3 | |

Node score for one batch:

```text
noiseScore = min(100, sum over signals of weight(type) * min(count, 5))
```

In the example above, `chainlock_conflict` contributes 18 × 2 and `peer_rejection` contributes 6 × 3, for a score of 54.

| Level | Score |
| --- | --- |
| `quiet` | 0-14 |
| `elevated` | 15-34 |
| `noisy` | 35-59 |
| `severe` | 60-79 |
| `critical` | 80-100 |

The network score (`summary.currentScore`) is the highest `noiseScore` among reporting (non-stale) nodes, and `summary.currentLevel` is its level.

## Summary API

```http
GET /api/v1/network-noise/summary?hours=24
```

- `hours` is an integer from 1 to 720 and defaults to 24. Values outside that range are clamped, and a non-numeric value falls back to 24. The window applies only to `timeline` and `recentSignals`. `summary` and `nodes` always show the latest state of each node.
- No authentication is required. The response is sent with `Cache-Control: no-store` and checked against `networkNoiseSummaryApiResponseSchema` from the shared package.
- The endpoint works even when `NETWORK_NOISE_MONITOR_ENABLED` is off, and it returns whatever is already stored.

Response shape (abridged):

```json
{
  "success": true,
  "data": {
    "generatedAt": "2026-09-23T09:23:00.000Z",
    "windowHours": 24,
    "staleAfterSeconds": 180,
    "summary": {
      "currentScore": 54,
      "currentLevel": "noisy",
      "knownNodes": 2,
      "reportingNodes": 2,
      "staleNodes": 0,
      "activeSignals": 5,
      "chainAlerts": 1
    },
    "nodes": [
      {
        "nodeId": "fullnode-a",
        "nodeRole": "fullnode",
        "walletVersion": "v23.0.0",
        "agentVersion": "1.0.0",
        "lastReportedAt": "2026-09-23T09:22:07.000Z",
        "blockHeight": 144500,
        "bestBlockHash": "<64-character block hash>",
        "chainLockHeight": 144500,
        "chainLockHash": "<64-character block hash>",
        "connections": 12,
        "inbound": 4,
        "outbound": 8,
        "syncing": false,
        "noiseScore": 54,
        "signalCount": 5,
        "activeSignalTypes": ["chainlock_conflict", "peer_rejection"],
        "lastCleanAt": null,
        "isStale": false
      }
    ],
    "timeline": [
      {
        "bucket": "2026-09-23T09:00:00.000Z",
        "signalType": "chainlock_conflict",
        "count": 2,
        "nodes": ["fullnode-a"]
      }
    ],
    "recentSignals": [
      {
        "nodeId": "fullnode-a",
        "nodeRole": "fullnode",
        "walletVersion": "v23.0.0",
        "signalType": "peer_rejection",
        "fingerprint": "9f8e7d6c5b4a39281706f5e4",
        "count": 3,
        "firstSeenAt": "2026-09-23T09:21:05.000Z",
        "lastSeenAt": "2026-09-23T09:22:01.000Z",
        "sample": "peer=<id> disconnected: <reason>",
        "blockHeight": 144500,
        "bestBlockHash": "<64-character block hash>",
        "chainLockHeight": 144500,
        "chainLockHash": "<64-character block hash>"
      }
    ]
  }
}
```

| Field | Meaning |
| --- | --- |
| `staleAfterSeconds` | `NETWORK_NOISE_STALE_AFTER_MS` in seconds |
| `summary.knownNodes` | All nodes that have a state document, stale ones included |
| `summary.reportingNodes` | Nodes whose `lastReportedAt` falls inside the stale threshold |
| `summary.staleNodes` | `knownNodes - reportingNodes` |
| `summary.activeSignals` | Sum of `signalCount` over reporting nodes |
| `summary.chainAlerts` | Number of reporting nodes whose latest batch contained a chain-related type |
| `nodes` | Every known node, sorted by `noiseScore` (highest first), then by `lastReportedAt` (newest first) |
| `timeline` | Stored observations whose `lastSeenAt` falls in the window, grouped by UTC hour of `lastSeenAt` and by `signalType`. `count` is the sum of occurrences and `nodes` lists the distinct node IDs |
| `recentSignals` | Up to 80 stored observations in the window, newest `lastSeenAt` first |

The summary never includes the reported node IPs (`snapshot.ip`) or the signals' `peerIps`. The server stores them but does not publish them.

## Web Page

`/devtools/network-noise` appears in the header's Dev Tools menu. The route is served with `noindex, nofollow` (`shared/src/routeSeo.ts`). The page shows:

- summary tiles: current noise level and score, reporting and known nodes, active signals, chain alerts, and stale agents
- an hourly activity chart for the selected window (1h, 6h, 24h, or 7d), with the chain-related share highlighted
- a node table with role, version, tip, ChainLock, peer counts, score (or `STALE`), and last report time
- a recent-signal evidence list with each signal's node, wallet version, and log sample

A role filter narrows the node table. A node filter narrows both the table and the evidence list.

## Configuration

The server reads these variables once, at startup. Changing any of them requires a restart.

| Variable | Default | Description |
| --- | --- | --- |
| `NETWORK_NOISE_MONITOR_ENABLED` | `false` | Turns on the ingest endpoint. Accepts `true`/`false`, `yes`/`no`, `on`/`off`, or `1`/`0`. The summary endpoint is always served |
| `NETWORK_NOISE_INGEST_TOKENS` | empty | Comma-separated `nodeId=token` entries, for example `fullnode-a=<token>,seed-a=<token>`. The first `=` splits each entry, and tokens cannot contain commas. The server silently ignores entries without `=` and tokens shorter than 32 characters |
| `NETWORK_NOISE_OBSERVATION_TTL_DAYS` | `30` | Retention for stored observations, 1-365 days |
| `NETWORK_NOISE_STALE_AFTER_MS` | `180000` | How long a node may go without reporting before it counts as stale, 60000-3600000 ms |

The server refuses to start if a value is invalid or out of range, or if the monitor is enabled without at least one valid token entry.

Give each node its own random token, for example one made with `openssl rand -hex 32`. Send it only over HTTPS.

## Privacy and Security

- **The summary is public.** The summary endpoint and the page require no login. For every known node they show the `nodeId`, role, wallet and agent versions, chain tip, ChainLock, and connection counts. For recent signals they also show fingerprints and log samples. Reported node IPs and peer IPs are stored in MongoDB but left out of the summary. Register only nodes whose log content you are willing to publish, and choose node IDs that do not reveal internal host names.
- **The agent must redact.** The server stores samples exactly as it receives them. It rejects samples longer than 300 characters but removes nothing from them. Before sending, the agent must strip credentials, keys, file paths, and any address or identifier that should not be published.
- **Authentication uses static tokens.** Each token is a shared secret for one node. Requests are not signed, and replay protection is limited to the sequence check. To rotate a token, update `NETWORK_NOISE_INGEST_TOKENS` and restart the server.

## Limitations

The following are not implemented:

- request signing, nonces, or rejection of stale or future timestamps
- detection of gaps in `sequence`
- correlation of incidents across nodes, and alerting
- access control or server-side redaction for the summary data
- push updates (the page polls)
- a reference node agent in this repository
