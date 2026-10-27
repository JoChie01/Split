/**
 * remember.ts
 *
 * WHAT: Remembers the email address used last, on this device only (in the browser's saved settings).
 * WHY:  So the log-in page can offer it again. The server never checks this, so nobody
 *       can learn from it which addresses have accounts.
 * NOTE: The browser can block saved settings (private windows, cleared site data).
 *       Then nothing is remembered, and the form simply starts empty.
 */

const KEY = "split.lastEmail";

export function rememberEmail(email: string): void {
  try {
    window.localStorage.setItem(KEY, email);
  } catch {
    // Storage is blocked, so there is nothing to remember.
  }
}

export function rememberedEmail(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
