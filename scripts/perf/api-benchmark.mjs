#!/usr/bin/env node

import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i++;
  }
  return args;
}

function asInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function percentile(samples, p) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

function round(value, digits = 2) {
  const m = 10 ** digits;
  return Math.round(value * m) / m;
}

async function runScenario({
  baseUrl,
  endpoint,
  concurrency,
  durationSec,
}) {
  const latencies = [];
  const statusCounts = new Map();
  const startedAt = Date.now();
  const deadline = startedAt + durationSec * 1000;
  let requests = 0;
  let ok = 0;
  let failed = 0;
  let networkErrors = 0;

  const runWorker = async () => {
    while (Date.now() < deadline) {
      const t0 = performance.now();
      try {
        const response = await fetch(new URL(endpoint, baseUrl), {
          headers: {
            Accept: 'application/json',
          },
        });
        await response.text();
        const dt = performance.now() - t0;
        latencies.push(dt);
        requests += 1;
        const current = statusCounts.get(response.status) ?? 0;
        statusCounts.set(response.status, current + 1);
        if (response.ok) ok += 1;
        else failed += 1;
      } catch {
        const dt = performance.now() - t0;
        latencies.push(dt);
        requests += 1;
        failed += 1;
        networkErrors += 1;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, runWorker));
  const elapsedSec = Math.max(0.001, (Date.now() - startedAt) / 1000);

  return {
    endpoint,
    durationSec: round(elapsedSec, 3),
    concurrency,
    requests,
    ok,
    failed,
    networkErrors,
    requestsPerSec: round(requests / elapsedSec, 2),
    successRatePct: requests > 0 ? round((ok / requests) * 100, 2) : 0,
    latencyMs: {
      min: latencies.length ? round(Math.min(...latencies), 2) : null,
      p50: percentile(latencies, 50) != null ? round(percentile(latencies, 50), 2) : null,
      p95: percentile(latencies, 95) != null ? round(percentile(latencies, 95), 2) : null,
      p99: percentile(latencies, 99) != null ? round(percentile(latencies, 99), 2) : null,
      max: latencies.length ? round(Math.max(...latencies), 2) : null,
    },
    statusCodes: Object.fromEntries([...statusCounts.entries()].sort((a, b) => a[0] - b[0])),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const baseUrl = String(args.baseUrl ?? process.env.PERF_BASE_URL ?? 'http://127.0.0.1:3001');
  const durationSec = asInt(args.durationSec ?? process.env.PERF_DURATION_SEC, 20);
  const concurrency = asInt(args.concurrency ?? process.env.PERF_CONCURRENCY, 20);
  const pauseMs = asInt(args.pauseMs ?? process.env.PERF_API_PAUSE_MS, 0);
  const endpoints = String(
    args.endpoints ??
      process.env.PERF_API_ENDPOINTS ??
      '/api/health,/api/sync,/api/blocks/latest?count=10,/api/txs/latest?count=10,/api/search?q=1'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const outPath = String(
    args.out ??
      path.join('artifacts', 'perf', `api-baseline-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  );

  if (!endpoints.length) {
    console.error('No endpoints provided.');
    process.exit(1);
  }

  const scenarios = [];
  for (let i = 0; i < endpoints.length; i++) {
    const endpoint = endpoints[i];
    console.log(`\n[api] running ${endpoint} (duration=${durationSec}s, concurrency=${concurrency})`);
    const result = await runScenario({ baseUrl, endpoint, concurrency, durationSec });
    scenarios.push(result);
    const statusSummary = Object.entries(result.statusCodes)
      .map(([code, count]) => `${code}:${count}`)
      .join(', ');
    const tooManyRequests = Number(result.statusCodes['429'] ?? 0);
    console.log(
      `[api] ${endpoint} rps=${result.requestsPerSec}, ok=${result.ok}/${result.requests}, p95=${result.latencyMs.p95}ms`
    );
    if (statusSummary) {
      console.log(`[api] ${endpoint} status={${statusSummary}}`);
    }
    if (tooManyRequests > 0) {
      console.log(
        `[api] ${endpoint} warning: ${tooManyRequests} requests hit HTTP 429 (rate limit). Consider --pauseMs 65000 for endpoint isolation.`
      );
    }
    if (pauseMs > 0 && i < endpoints.length - 1) {
      console.log(`[api] waiting ${pauseMs}ms before next endpoint...`);
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    durationSec,
    concurrency,
    pauseMs,
    scenarios,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`\n[api] report written: ${outPath}`);
}

main().catch((err) => {
  console.error('[api] benchmark failed:', err);
  process.exit(1);
});
