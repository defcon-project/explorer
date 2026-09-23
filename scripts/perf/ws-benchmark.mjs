#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';

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

function summarize(name, samples) {
  return {
    metric: name,
    count: samples.length,
    p50: percentile(samples, 50) != null ? round(percentile(samples, 50), 2) : null,
    p95: percentile(samples, 95) != null ? round(percentile(samples, 95), 2) : null,
    p99: percentile(samples, 99) != null ? round(percentile(samples, 99), 2) : null,
    min: samples.length ? round(Math.min(...samples), 2) : null,
    max: samples.length ? round(Math.max(...samples), 2) : null,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const url = String(args.url ?? process.env.PERF_WS_URL ?? 'ws://127.0.0.1:3001/ws');
  const connections = asInt(args.connections ?? process.env.PERF_WS_CONNECTIONS, 50);
  const holdSec = asInt(args.holdSec ?? process.env.PERF_WS_HOLD_SEC, 15);
  const connectSpreadMs = asInt(args.connectSpreadMs ?? process.env.PERF_WS_SPREAD_MS, 3000);
  const outPath = String(
    args.out ??
      path.join('artifacts', 'perf', `ws-baseline-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  );

  const openLatencies = [];
  const helloLatencies = [];
  const pongLatencies = [];
  const messageTypeCounts = new Map();
  let opened = 0;
  let closed = 0;
  let errors = 0;

  const sockets = [];
  const startedAt = Date.now();

  console.log(`[ws] target=${url}, connections=${connections}, hold=${holdSec}s`);

  const connectOne = (idx) =>
    new Promise((resolve) => {
      const started = performance.now();
      let openRecorded = false;
      let helloRecorded = false;
      let pongRecorded = false;

      const ws = new WebSocket(url);
      sockets.push(ws);

      const timeout = setTimeout(() => {
        ws.terminate();
      }, Math.max(5000, holdSec * 1000 + connectSpreadMs + 2000));

      ws.on('open', () => {
        opened += 1;
        openRecorded = true;
        openLatencies.push(performance.now() - started);
        ws.send(
          JSON.stringify({
            type: 'ping',
            ts: new Date().toISOString(),
            data: { clientTs: new Date().toISOString(), idx },
          })
        );
      });

      ws.on('message', (raw) => {
        try {
          const payload = JSON.parse(raw.toString());
          const type = String(payload?.type ?? 'unknown');
          const current = messageTypeCounts.get(type) ?? 0;
          messageTypeCounts.set(type, current + 1);

          if (type === 'hello' && !helloRecorded) {
            helloRecorded = true;
            helloLatencies.push(performance.now() - started);
          }
          if (type === 'pong' && !pongRecorded) {
            pongRecorded = true;
            pongLatencies.push(performance.now() - started);
          }
        } catch {
          const current = messageTypeCounts.get('unparseable') ?? 0;
          messageTypeCounts.set('unparseable', current + 1);
        }
      });

      ws.on('error', () => {
        errors += 1;
      });

      ws.on('close', () => {
        clearTimeout(timeout);
        closed += 1;
        resolve({
          openRecorded,
          helloRecorded,
          pongRecorded,
        });
      });
    });

  const connectionPromises = [];
  const spreadPerConn = connections > 1 ? Math.floor(connectSpreadMs / (connections - 1)) : 0;

  for (let i = 0; i < connections; i++) {
    await new Promise((r) => setTimeout(r, Math.max(0, spreadPerConn)));
    connectionPromises.push(connectOne(i));
  }

  await new Promise((r) => setTimeout(r, holdSec * 1000));
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  }

  await Promise.allSettled(connectionPromises);

  const elapsedSec = Math.max(0.001, (Date.now() - startedAt) / 1000);
  const report = {
    generatedAt: new Date().toISOString(),
    url,
    connections,
    holdSec,
    connectSpreadMs,
    elapsedSec: round(elapsedSec, 3),
    opened,
    closed,
    errors,
    openSuccessRatePct: connections > 0 ? round((opened / connections) * 100, 2) : 0,
    latencyMs: {
      open: summarize('open', openLatencies),
      hello: summarize('hello', helloLatencies),
      pong: summarize('pong', pongLatencies),
    },
    messageTypes: Object.fromEntries([...messageTypeCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`[ws] opened=${opened}/${connections}, errors=${errors}`);
  console.log(
    `[ws] p95(open)=${report.latencyMs.open.p95}ms, p95(hello)=${report.latencyMs.hello.p95}ms, p95(pong)=${report.latencyMs.pong.p95}ms`
  );
  console.log(`[ws] report written: ${outPath}`);
}

main().catch((err) => {
  console.error('[ws] benchmark failed:', err);
  process.exit(1);
});

