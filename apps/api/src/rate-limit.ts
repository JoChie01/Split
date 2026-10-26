/**
 * rate-limit.ts
 *
 * WHAT: Counts how many times each key (an IP address, an email) has asked
 *       for something in a time window. Over the limit -> the caller answers 429.
 * WHY:  Stops guessing and spamming, e.g. flooding someone's inbox with login emails.
 * LIMITS: Counts live in this server's memory. They reset on restart and are not shared
 *         between servers. That's fine while Split runs on one server. Before running
 *         several, move the counts to a shared store.
 */

export type RateLimit = { max: number; windowMs: number };

export function createRateLimiter(limit: RateLimit, now: () => number = Date.now) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  let lastSweep = now();

  return {
    /** True if this request is within the limit. Every call counts as one request. */
    allow(key: string): boolean {
      const t = now();

      // Forget expired keys now and then, so memory doesn't grow forever.
      if (t - lastSweep >= limit.windowMs) {
        for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
        lastSweep = t;
      }

      const entry = hits.get(key);
      if (!entry || entry.resetAt <= t) {
        hits.set(key, { count: 1, resetAt: t + limit.windowMs });
        return true;
      }
      entry.count += 1;
      return entry.count <= limit.max;
    },
  };
}
