/**
 * In-memory sliding-window rate limiter. Adequate for single-instance and for
 * local/test use. In multi-instance production deployments, back this with
 * Redis/Upstash (documented in README).
 */
type Bucket = { hits: number[] };
const store = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const bucket = store.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
  if (bucket.hits.length >= limit) {
    const retryAfterMs = windowMs - (now - bucket.hits[0]);
    store.set(key, bucket);
    return { allowed: false, remaining: 0, retryAfterMs };
  }
  bucket.hits.push(now);
  store.set(key, bucket);
  return { allowed: true, remaining: limit - bucket.hits.length, retryAfterMs: 0 };
}

export function resetRateLimits() {
  store.clear();
}

export function clientKey(req: Request, scope: string) {
  const fwd = req.headers.get('x-forwarded-for') ?? 'local';
  const ip = fwd.split(',')[0].trim();
  return `${scope}:${ip}`;
}
