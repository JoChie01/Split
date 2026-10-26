/**
 * Auth.tsx
 *
 * WHAT: The two login screens. SignIn asks for an email address and sends a link.
 *       Verify opens when the person taps that link and logs them in.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "./api";
import "./signin.css";
import { Mark, Wordmark } from "../brand/Logo";

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignIn() {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [limited, setLimited] = useState(false);
  const [busy, setBusy] = useState(false);

  async function send(address: string) {
    setBusy(true);
    setErrorText(null);
    try {
      await api("POST", "/auth/request", { email: address });
      setSentTo(address);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setFieldError(err.message);
      } else if (err instanceof ApiError && err.status === 429) {
        setLimited(true);
        setErrorText(err.message);
      } else {
        setErrorText(err instanceof ApiError ? err.message : "Could not send the link. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const address = email.trim();
    if (!EMAIL_SHAPE.test(address)) {
      setFieldError("Enter an email address, like you@example.com.");
      return;
    }
    setFieldError(null);
    send(address);
  }

  if (sentTo) {
    return (
      <main className="page">
        <div className="signin-body">
          <Brand />
          <h1>Check your email</h1>
          <div className="signin-notice" role="status">
            <div>
              <strong>Link sent to</strong>
              <span className="signin-addr">{sentTo}</span>
            </div>
          </div>
          <p className="signin-lead">Open the link on this phone. It works once and expires in 15 minutes.</p>
          <p className="signin-hint">Nothing in your inbox? Check spam, or wait a minute before asking for another.</p>
          <div className="signin-row">
            <button type="button" className="signin-link" disabled={busy} onClick={() => send(sentTo)}>
              Send it again
            </button>
            <button
              type="button"
              className="signin-link"
              onClick={() => {
                setSentTo(null);
                setEmail(sentTo);
              }}
            >
              Use a different email
            </button>
          </div>
          {errorText && <p className="signin-error" role="alert">{errorText}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="signin-body">
        <Brand />
        <h1>Log in</h1>
        {errorText && <div className="signin-error-box" role="alert">{errorText}</div>}
        <p className="signin-lead">No password. We email you a link that works once.</p>
        <form onSubmit={submit} noValidate>
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            value={email}
            aria-invalid={fieldError !== null}
            onChange={(e) => {
              setEmail(e.target.value);
              setFieldError(null);
            }}
          />
          {fieldError && <p className="signin-field-error">{fieldError}</p>}
          <button type="submit" className="signin-primary" disabled={busy || limited}>
            {busy ? "Sending..." : "Email me a link"}
          </button>
        </form>
        <p className="signin-hint">Use the email your group knows you by. Links expire in 15 minutes.</p>
        {limited && (
          <div className="signin-row">
            <button
              type="button"
              className="signin-link"
              onClick={() => {
                setLimited(false);
                setErrorText(null);
              }}
            >
              Back to the start
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

// The same header as the landing page, so the two pages look like one app.
function Brand() {
  return (
    <header className="top">
      <a className="logo" href="/" aria-label="Split home">
        <Mark />
        <Wordmark />
      </a>
    </header>
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

  if (!error) return <main className="page"><p className="signin-lead">Logging you in...</p></main>;
  return (
    <main className="page">
      <div className="signin-body">
        <Brand />
        <h1>Link not working</h1>
        <p className="signin-error" role="alert">{error}</p>
        <p><a href="/login" className="signin-link">Ask for a new link</a></p>
      </div>
    </main>
  );
}
