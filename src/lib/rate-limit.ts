type Bucket = { count: number; resetAt: number };

export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  const buckets = new Map<string, Bucket>();

  return function allow(key: string): boolean {
    const current = now();
    const bucket = buckets.get(key);
    if (!bucket || current >= bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: current + windowMs });
      return true;
    }
    if (bucket.count >= limit) return false;
    bucket.count += 1;
    return true;
  };
}
