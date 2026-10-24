/**
 * log.ts
 *
 * WHAT: Keeps secrets out of request logs.
 * WHY:  Share-link tokens are part of the URL (/join/<token>/...). Fastify logs the URL
 *       of every request, so without this a token would be written into the log file.
 */

/** Replaces the token in a /join/<token> path with a placeholder. */
export function redactUrl(url: string): string {
  return url.replace(/^\/join\/[^/?]+/, "/join/[redacted]");
}

/** Tells Fastify (through pino) which parts of each request to log. */
export function requestLogSerializer(req: { method?: string; url?: string }) {
  return { method: req.method, url: redactUrl(req.url ?? "") };
}
