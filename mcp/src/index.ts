import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE_URL = 'https://deftrack.xyz';
const USER_AGENT = 'deftrack-mcp/1.1';

// ── Rate limiter: max 20 requests per 60 s (sliding window) ──────────────────
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const callTimestamps: number[] = [];

function checkRateLimit(): void {
  const now = Date.now();
  // remove entries outside the window
  while (callTimestamps.length > 0 && callTimestamps[0]! < now - RATE_WINDOW_MS) {
    callTimestamps.shift();
  }
  if (callTimestamps.length >= RATE_LIMIT) {
    const retryAfter = Math.ceil((callTimestamps[0]! + RATE_WINDOW_MS - now) / 1000);
    throw new Error(`Rate limit reached (${RATE_LIMIT} req/min). Retry in ${retryAfter}s.`);
  }
  callTimestamps.push(now);
}

// ── Fetch helper (GET only, public API) ──────────────────────────────────────
async function apiGet(path: string): Promise<unknown> {
  checkRateLimit();
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ── MCP server ────────────────────────────────────────────────────────────────
const server = new McpServer({
  name: 'deftrack',
  version: '1.1.0',
});

// Tool: lookup — address / tx / block (auto-detect)
server.tool(
  'lookup',
  'Look up a DeFCoN address balance, transaction, or block on deftrack.xyz. ' +
  'Accepts: a DeFCoN address (starts with D, 26–34 chars), a 64-char hex hash (tx or block), ' +
  'or a block height integer. Amount fields are integer strings in satoshis ' +
  '(1 DFCN = 100,000,000 satoshis).',
  { q: z.string().min(1).describe('DeFCoN address, tx/block hash, or block height') },
  async ({ q }) => {
    const data = await apiGet(`/api/ai/lookup?q=${encodeURIComponent(q)}`);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

// Tool: network — live chain tip + masternode summary
server.tool(
  'network',
  'Get the current DeFCoN network status: latest block height, block hash, and masternode counts ' +
  '(total, enabled, PoSe penalty, PoSe banned).',
  {},
  async () => {
    const data = await apiGet('/api/ai/network');
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

// Tool: masternode — lookup a single masternode
server.tool(
  'masternode',
  'Look up a DeFCoN masternode by IP, IP:port (e.g. 203.0.113.10:8192) or proTxHash. ' +
  'Returns status, PoSe penalty, provider, country, and last 5 status-change events.',
  { q: z.string().min(1).describe('IP, IP:port or proTxHash of the masternode') },
  async ({ q }) => {
    const data = await apiGet(`/api/ai/masternode?q=${encodeURIComponent(q)}`);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

// Tool: pose_bans — PoSe ban analytics (aggregated) or raw ban/recovery events
server.tool(
  'pose_bans',
  'Analyze DeFCoN PoSe (Proof-of-Service) masternode ban data. ' +
  'mode="stats" (default) returns pre-aggregated analytics: total/ban/recovery counts, top hosting providers, ' +
  'top countries, top payout-operator clusters, and the largest exact-height ban waves — ideal for telling an ' +
  'operator/config concentration apart from a network-wide event. ' +
  'mode="raw" returns individual ban/recovery events (capped by limit) with proTxHash, ip, provider, country, ' +
  'payoutAddress, poseBanHeight and recovery fields. Filter with type and since. ' +
  'For a full bulk download use https://deftrack.xyz/api/v1/masternodes/bans/export?format=ndjson',
  {
    mode: z.enum(['stats', 'raw']).default('stats').describe('stats = aggregated summary, raw = individual events'),
    type: z.enum(['all', 'ban', 'recovery']).default('all').describe('event type filter'),
    since: z.number().int().optional().describe('minimum poseBanHeight (inclusive)'),
    limit: z.number().int().min(1).max(500).default(100).describe('max rows in raw mode'),
  },
  async ({ mode, type, since, limit }) => {
    const sinceQ = since != null ? `&since=${since}` : '';
    const path =
      mode === 'raw'
        ? `/api/v1/masternodes/bans/export?format=json&type=${type}&limit=${limit}${sinceQ}`
        : `/api/v1/masternodes/bans/stats${since != null ? `?since=${since}` : ''}`;
    const data = await apiGet(path);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

// ── Start ─────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
