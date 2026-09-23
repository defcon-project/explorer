# deftrack-mcp

A read-only [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for the DefTrack DeFCoN explorer. It lets an MCP client (an AI assistant or IDE) query live DeFCoN chain data through the public explorer API at `https://deftrack.xyz`.

- Transport: stdio. The client starts the process and talks to it over stdin/stdout.
- Read-only: it only sends HTTP `GET` requests to public endpoints. It needs no API key and has no wallet or write access.
- Base URL: `https://deftrack.xyz`, set by the `BASE_URL` constant in `src/index.ts`. There is no environment variable for it; to use a self-hosted explorer, change the constant and rebuild.
- Client-side limits: at most 20 requests per rolling 60 seconds, and each request times out after 10 seconds. The server's own per-IP rate limit also applies.
- Output: on success, each tool returns the API's JSON response unchanged, as pretty-printed text. A non-2xx response (for example `404` not found or `429`) is returned as a tool error with the HTTP status and the first 200 characters of the response body. The client-side rate limit is also reported as a tool error.

## Tools

| Tool | Arguments | API call |
| --- | --- | --- |
| `lookup` | `q` (string): a DeFCoN address, a 64-character tx or block hash, or a block height | `GET /api/ai/lookup?q=<q>` |
| `network` | none | `GET /api/ai/network` |
| `masternode` | `q` (string): an IP, an IP:port (e.g. `203.0.113.10:8192`) or a proTxHash | `GET /api/ai/masternode?q=<q>` |
| `pose_bans` | `mode`: `stats` (default) or `raw`; `type`: `all` (default), `ban` or `recovery`; `since` (optional integer): minimum `poseBanHeight`; `limit` (1-500, default 100, raw mode only) | `stats`: `GET /api/v1/masternodes/bans/stats[?since=<n>]` (`type` and `limit` are ignored)<br>`raw`: `GET /api/v1/masternodes/bans/export?format=json&type=<type>&limit=<limit>[&since=<n>]` |

Amounts returned by `lookup` (`balance`, `totalReceived`, `totalSent`, `reward`, `totalIn`, `totalOut`, `fee`) are integer strings in satoshis (1 DFCN = 100,000,000 satoshis). See [`client/public/llms.txt`](../client/public/llms.txt) for usage rules and [`client/public/llms-full.txt`](../client/public/llms-full.txt) for the full response fields of the `/api/ai/*` endpoints.

## Requirements

Node.js 22 (the repository pins the exact version in `.node-version`). The `dev` script uses `--experimental-strip-types`, which needs Node.js 22.6 or later.

## Build and run

Run these from the repository root. The root `npm run build` does not build this workspace, so build it explicitly:

```bash
npm ci
npm run build -w deftrack-mcp    # compiles src/index.ts to mcp/dist/index.js
```

Start the compiled server:

```bash
npm start -w deftrack-mcp        # node dist/index.js
```

Or run the TypeScript source directly, without a build step:

```bash
npm run dev -w deftrack-mcp      # node --experimental-strip-types src/index.ts
```

The process then waits for an MCP client on stdin. It prints nothing on its own, so in normal use you let the MCP client start it rather than running it by hand.

## Client configuration

Most MCP clients, including Claude Desktop, accept a stdio server entry like the one below. Replace the path with the absolute path to `mcp/dist/index.js` in your checkout:

```json
{
  "mcpServers": {
    "deftrack": {
      "command": "node",
      "args": ["/absolute/path/to/deftrack/mcp/dist/index.js"]
    }
  }
}
```

Restart the client after editing its configuration. The four tools above should then be listed under the `deftrack` server.

## Related

- [`/llms.txt`](https://deftrack.xyz/llms.txt) and [`/llms-full.txt`](https://deftrack.xyz/llms-full.txt): plain-text context for AI agents
- [`/.well-known/deftrack-ai.json`](https://deftrack.xyz/.well-known/deftrack-ai.json): machine-readable manifest of the `/api/ai/*` endpoints
- [`/api/docs/`](https://deftrack.xyz/api/docs/): Swagger UI for the explorer REST API
