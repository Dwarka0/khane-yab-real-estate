import type { Context, Next } from "hono";
import type { Env } from "./types";

export async function rateLimit(c: Context<{ Bindings: Env }>, next: Next) {
  const limit = Math.max(10, Number(c.env.RATE_LIMIT_PER_MINUTE) || 60);
  const forwarded = c.req.header("CF-Connecting-IP") ?? "unknown";
  const windowStart = Math.floor(Date.now() / 60_000);
  const key = forwarded;
  try {
    const row = await c.env.DB.prepare("SELECT window_start, request_count FROM rate_limit_buckets WHERE bucket_key = ?").bind(key).first<{window_start:number;request_count:number}>();
    if (row?.window_start === windowStart && row.request_count >= limit) return c.json({ error: { code: "RATE_LIMITED", message: "Too many requests" } }, 429);
    await c.env.DB.prepare(`INSERT INTO rate_limit_buckets(bucket_key, window_start, request_count) VALUES(?, ?, 1)
      ON CONFLICT(bucket_key) DO UPDATE SET request_count = CASE WHEN window_start = excluded.window_start THEN request_count + 1 ELSE 1 END, window_start = excluded.window_start`).bind(key, windowStart).run();
  } catch {
    // Fail closed if the limiter cannot consult D1; protects the API during database faults.
    return c.json({ error: { code: "RATE_LIMIT_UNAVAILABLE", message: "Request limiter temporarily unavailable" } }, 503);
  }
  await next();
}
