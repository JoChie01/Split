/**
 * Auth.tsx
 *
 * WHAT: The two login screens. SignIn asks for an email address and sends a link.
 *       Verify opens when the person taps that link and logs them in.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "./api";

export function SignIn() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ message: string }>("POST", "/auth/request", { email });
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send the link. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-page">
      <h1>Log in to Split</h1>
      {message ? (
        <p className="app-note">{message}</p>
      ) : (
        <form onSubmit={submit} className="app-stack">
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit" disabled={busy}>
            {busy ? "Sending..." : "Send me a login link"}
          </button>
          {error && <p className="app-error" role="alert">{error}</p>}
        </form>
      )}
    </main>
  );
}

export function Verify() {
  const [error, setError] = useState<string | null>(null);
  // StrictMode runs effects twice in development. A login link works only once,
  // so make sure the request is sent only once.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    api("POST", "/auth/verify", { token })
      .then(() => window.location.replace("/app"))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "This link did not work.");
      });
  }, []);

  if (!error) return <main className="app-page"><p>Logging you in...</p></main>;
  return (
    <main className="app-page">
      <h1>Link not working</h1>
      <p className="app-error" role="alert">{error}</p>
      <p><a href="/login">Ask for a new link</a></p>
    </main>
  );
}
