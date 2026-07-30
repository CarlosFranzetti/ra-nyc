import type { IncomingMessage } from "http";

/**
 * Best-effort per-IP rate limiting, ported from the Supabase edge function this
 * API replaced.
 *
 * ## What this does and does not guarantee
 *
 * The counters live in module memory, so they are per *instance*: Vercel runs
 * many concurrent instances and recycles them, so a determined caller spread
 * across instances gets more than `limit` requests, and a cold start resets the
 * window. This is deliberately not a distributed limiter — that needs a shared
 * store (Upstash/Vercel KV), which means credentials and a service to operate,
 * and the point of this app is that it has neither.
 *
 * It is still worth having, because of where it sits: the edge cache absorbs
 * nearly all normal traffic, so the only requests that reach here are cache
 * misses. That is exactly the traffic that would otherwise hit ra.co. A visitor
 * clicking through a week costs 8 requests; anything approaching these limits is
 * not a person browsing.
 *
 * If real abuse ever shows up, reach for Vercel's Firewall rate limiting (edge
 * level, no code, actually global) before building a distributed limiter here.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Ceiling on tracked keys, so a spray of spoofed IPs can't grow this forever. */
const MAX_TRACKED_KEYS = 10_000;

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Epoch ms when the current window expires. */
  resetAt: number;
  retryAfterSeconds: number;
}

/**
 * Best-effort client IP.
 *
 * On Vercel `x-forwarded-for` is set by the platform and its first entry is the
 * real client. It is trivially spoofable in general, which is another reason not
 * to treat this as a security control — it is a politeness control.
 */
export function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = raw?.split(",")[0]?.trim();
  if (first) return first;

  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp) return realIp;

  return req.socket?.remoteAddress ?? "unknown";
}

function prune(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key);
  }
  // If pruning expired entries wasn't enough, the instance is under a key-spray
  // attack. Drop everything rather than leak memory; worst case some callers get
  // a fresh window.
  if (buckets.size > MAX_TRACKED_KEYS) buckets.clear();
}

export function rateLimit(
  key: string,
  { limit, windowMs }: RateLimitOptions,
): RateLimitResult {
  const now = Date.now();
  if (buckets.size > MAX_TRACKED_KEYS) prune(now);

  const existing = buckets.get(key);

  if (!existing || now > existing.resetAt) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return {
      ok: true,
      limit,
      remaining: limit - 1,
      resetAt,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));

  if (existing.count >= limit) {
    return {
      ok: false,
      limit,
      remaining: 0,
      resetAt: existing.resetAt,
      retryAfterSeconds,
    };
  }

  existing.count += 1;
  return {
    ok: true,
    limit,
    remaining: limit - existing.count,
    resetAt: existing.resetAt,
    retryAfterSeconds,
  };
}

/** Headers describing the caller's current budget. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };
}
