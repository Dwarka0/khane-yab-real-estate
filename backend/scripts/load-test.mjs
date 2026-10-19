#!/usr/bin/env node
/**
 * Measures the latency of a public API route and reports percentiles and the
 * error rate. The result is recorded in the release report as the measured
 * evidence for the p95 performance target.
 *
 * Usage:
 *   node scripts/load-test.mjs --url http://127.0.0.1:8787 --path /api/listings --requests 200 --concurrency 10
 */
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const baseUrl = (option("url", "http://127.0.0.1:8787")).replace(/\/$/, "");
const path = option("path", "/api/listings");
const requests = Number(option("requests", "200"));
const concurrency = Number(option("concurrency", "10"));
const warmup = Number(option("warmup", "10"));

const percentile = (sorted, p) => {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
};

async function call() {
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, { headers: { "User-Agent": "KhaneYabLoadTest/1.0" } });
    await response.arrayBuffer();
    return { ms: performance.now() - started, status: response.status };
  } catch (error) {
    return { ms: performance.now() - started, status: 0, error: error.message };
  }
}

async function run(count, limit) {
  const results = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < count) {
      cursor++;
      results.push(await call());
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, count) }, () => worker()));
  return results;
}

await run(warmup, concurrency);

const results = await run(requests, concurrency);
const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
const errors = results.filter((r) => r.status === 0 || r.status >= 400);
const statuses = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; }, {});

const report = {
  target: `${baseUrl}${path}`,
  requests,
  concurrency,
  p50: Math.round(percentile(latencies, 50)),
  p95: Math.round(percentile(latencies, 95)),
  p99: Math.round(percentile(latencies, 99)),
  min: Math.round(latencies[0] ?? 0),
  max: Math.round(latencies[latencies.length - 1] ?? 0),
  errorRate: `${((errors.length / results.length) * 100).toFixed(1)}%`,
  statuses,
};

console.log(JSON.stringify(report, null, 2));
