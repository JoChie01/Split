/**
 * api.ts
 *
 * WHAT: Talks to the Split API. Every call sends the login cookie.
 * WHY:  One place for error handling, so the screens only deal with results.
 */

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function errorText(data: unknown, status: number): string {
  if (typeof data === "object" && data !== null && "error" in data && typeof data.error === "string") {
    return data.error;
  }
  return `Something went wrong (${status})`;
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, errorText(data, res.status));
  return data as T;
}

/** Sends a receipt screenshot as the raw image bytes the API expects. */
export async function attachReceipt(groupId: string, paymentId: string, file: File): Promise<void> {
  const res = await fetch(`/groups/${groupId}/payments/${paymentId}/proof`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": file.type },
    body: file,
  });
  if (!res.ok) {
    const data: unknown = await res.json().catch(() => null);
    throw new ApiError(res.status, errorText(data, res.status));
  }
}
