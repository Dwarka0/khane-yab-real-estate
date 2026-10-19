import type { Context, Next } from "hono";
import type { Env } from "./types";

export async function rateLimit(c: Context<{ Bindings: Env }>, next: Next) {
  const limit = Math.max(10, Number(c.env.RATE_LIMIT_PER_MINUTE) || 60);
  const forwarded = c.req.header("CF-Connecting-IP") ?? "unknown";
  const windowStart = Math.floor(Date.now() / 60_000);
  const key = forwarded;
  try {
    // Increment and return the bucket atomically; SELECT-then-UPSERT lets concurrent
    // requests all observe a below-limit count and pass together.
    const row = await c.env.DB.prepare(`INSERT INTO rate_limit_buckets(bucket_key, window_start, request_count) VALUES(?, ?, 1)
      ON CONFLICT(bucket_key) DO UPDATE SET request_count = CASE WHEN window_start = excluded.window_start THEN request_count + 1 ELSE 1 END, window_start = excluded.window_start
      RETURNING window_start, request_count`).bind(key, windowStart).first<{window_start:number;request_count:number}>();
    if (!row || row.window_start !== windowStart) throw new Error("Rate limiter returned an invalid bucket");
    if (row.request_count > limit) return c.json({ error: { code: "RATE_LIMITED", message: "Too many requests" } }, 429);
    // Opportunistic bounded cleanup prevents one permanent D1 row per historical IP.
    if (row.request_count === 1 && windowStart % 10 === 0) {
      await c.env.DB.prepare("DELETE FROM rate_limit_buckets WHERE window_start < ?").bind(windowStart - 10).run();
    }
  } catch {
    // Fail closed if the limiter cannot consult D1; protects the API during database faults.
    return c.json({ error: { code: "RATE_LIMIT_UNAVAILABLE", message: "Request limiter temporarily unavailable" } }, 503);
  }
  await next();
}

/**
 * A stricter budget for expensive public operations such as fetching a
 * user-submitted listing page. The window is hourly and the bucket is keyed
 * separately from the general per-minute bucket.
 */
export async function hourlyOperationLimit(c: Context<{ Bindings: Env }>, next: Next) {
  const limit = Math.max(1, Number(c.env.LINK_IMPORT_PER_HOUR) || 20);
  const client = c.req.header("CF-Connecting-IP") ?? "unknown";
  const windowStart = Math.floor(Date.now() / 3_600_000);
  const key = `hourly:${client}`;
  try {
    const row = await c.env.DB.prepare(`INSERT INTO rate_limit_buckets(bucket_key, window_start, request_count) VALUES(?, ?, 1)
      ON CONFLICT(bucket_key) DO UPDATE SET request_count = CASE WHEN window_start = excluded.window_start THEN request_count + 1 ELSE 1 END, window_start = excluded.window_start
      RETURNING window_start, request_count`).bind(key, windowStart).first<{window_start:number;request_count:number}>();
    if (!row || row.window_start !== windowStart) throw new Error("Limiter returned an invalid bucket");
    if (row.request_count > limit) {
      return c.json({ error: { code: "RATE_LIMITED", message: "تعداد درخواست‌های این عملیات بیش از حد مجاز است" } }, 429);
    }
  } catch {
    return c.json({ error: { code: "RATE_LIMIT_UNAVAILABLE", message: "سرویس محدودکنندهٔ نرخ موقتاً در دسترس نیست" } }, 503);
  }
  await next();
}
