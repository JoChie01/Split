/**
 * log.ts
 *
 * WHAT: Keeps secrets out of request logs.
 * WHY:  Share-link tokens sit in the URL path (/join/<token>/...), and the login
 *       token can sit in a query string (?token=...). Fastify logs the URL of every
 *       request, so without this those tokens would be written into the log file.
 */

/** Hides tokens in a URL before it is written down. */
export function redactUrl(url: string): string {
  return url
    .replace(/^\/join\/[^/?]+/, "/join/[redacted]")
    .replace(/([?&]token=)[^&]+/, "$1[redacted]");
}

/** Tells Fastify (through pino) which parts of each request to log. */
export function requestLogSerializer(req: { method?: string; url?: string }) {
  return { method: req.method, url: redactUrl(req.url ?? "") };
}
