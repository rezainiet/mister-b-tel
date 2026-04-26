import type { Request } from "express";

type Bucket = {
  count: number;
  resetAt: number;
  blockedUntil?: number;
};

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5_000;

function gcIfNeeded(now: number) {
  if (buckets.size <= MAX_BUCKETS) return;
  Array.from(buckets.entries()).forEach(([key, bucket]) => {
    const expired = bucket.resetAt <= now && (!bucket.blockedUntil || bucket.blockedUntil <= now);
    if (expired) buckets.delete(key);
  });
}

export type RateLimitResult = {
  allowed: boolean;
  retryAfterMs: number;
  remaining: number;
};

export type RateLimitOptions = {
  limit: number;
  windowMs: number;
  /** When set, hitting `limit` blocks the key for this long (after current window). */
  blockMs?: number;
};

export function checkRateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (bucket?.blockedUntil && bucket.blockedUntil > now) {
    return { allowed: false, retryAfterMs: bucket.blockedUntil - now, remaining: 0 };
  }

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    gcIfNeeded(now);
    return { allowed: true, retryAfterMs: 0, remaining: Math.max(0, opts.limit - 1) };
  }

  if (bucket.count >= opts.limit) {
    if (opts.blockMs) {
      bucket.blockedUntil = now + opts.blockMs;
    }
    return {
      allowed: false,
      retryAfterMs: Math.max(bucket.resetAt - now, opts.blockMs ?? 0),
      remaining: 0,
    };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterMs: 0, remaining: opts.limit - bucket.count };
}

export function recordSuccess(key: string) {
  // Reset the bucket on success — successful logins should not count toward
  // the brute-force budget. Tracking endpoints don't call this.
  buckets.delete(key);
}

export function getClientIp(req: Pick<Request, "headers" | "socket">): string {
  const forwardedFor = req.headers["x-forwarded-for"];
  const forwardedHeader = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  if (typeof forwardedHeader === "string" && forwardedHeader.length > 0) {
    return forwardedHeader.split(",")[0]?.trim() || "unknown";
  }
  return req.socket?.remoteAddress || "unknown";
}

export function __resetRateLimitForTests() {
  buckets.clear();
}
