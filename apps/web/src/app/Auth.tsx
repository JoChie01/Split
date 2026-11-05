/**
 * Auth.tsx
 *
 * WHAT: The sign-up, log-in and link screens. Log in asks for an email address and sends a link.
 *       If this device remembers an email, log in offers to send a link to it.
 *       Verify opens when the person taps that link and logs them in.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "./api";
import { rememberEmail, rememberedEmail } from "./remember";
import "./signin.css";
import { Mark, Wordmark } from "../brand/Logo";

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignIn() {
  // The address used last on this device, if any. It is read once, when the page opens.
  const [remembered] = useState<string | null>(() => rememberedEmail());
  // True when the person chose "Use a different email", so the form shows instead.
  const [typingNew, setTypingNew] = useState(false);
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
      rememberEmail(address);
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
                setTypingNew(true);
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

  // This device remembers an address: offer to send the link there.
  if (remembered && !typingNew) {
    return (
      <main className="page">
        <div className="signin-body">
          <Brand />
          <h1>Welcome <mark>back</mark></h1>
          <p className="signin-lead">Send a login link to the email you used before?</p>
          <div className="signin-notice" role="status">
            <div>
              <strong>Email</strong>
              <span className="signin-addr">{remembered}</span>
            </div>
          </div>
          {errorText && <div className="signin-error-box" role="alert">{errorText}</div>}
          <button
            type="button"
            className="signin-primary"
            disabled={busy || limited}
            onClick={() => send(remembered)}
          >
            {busy ? "Sending..." : "Send me a login link"}
          </button>
          <div className="signin-row">
            <button
              type="button"
              className="signin-link"
              onClick={() => {
                setTypingNew(true);
                setEmail("");
                setErrorText(null);
              }}
            >
              Use a different email
            </button>
          </div>
          <p className="signin-hint">
            New to Split? <a href="/signup" className="signin-link">Create an account</a>
          </p>
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
        <p className="signin-hint">
          New to Split? <a href="/signup" className="signin-link">Create an account</a>
        </p>
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

/**
 * Create an account: a name, an email address, and agreement to the privacy notice.
 * The email link then works the same way as for logging in.
 */
export function SignUp() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const who = name.trim();
    const address = email.trim();
    const nameOk = who.length > 0;
    const emailOk = EMAIL_SHAPE.test(address);
    setNameError(nameOk ? null : "Enter your name, so your group knows who you are.");
    setEmailError(emailOk ? null : "Enter an email address, like you@example.com.");
    setConsentError(agreed ? null : "Tick the box to agree to the privacy notice before creating your account.");
    if (!nameOk || !emailOk || !agreed) return;

    setBusy(true);
    setErrorText(null);
    try {
      await api("POST", "/auth/request", { email: address, name: who, privacy: true });
      rememberEmail(address);
      setSentTo(address);
    } catch (err) {
      setErrorText(err instanceof ApiError ? err.message : "Could not send the link. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <main className="page">
        <Brand />
        <h1>Check your <mark>email</mark></h1>
        <div className="signin-notice" role="status">
          <strong>Link sent to</strong>
          <span className="signin-addr">{sentTo}</span>
        </div>
        <p className="signin-lead">Open the link on this phone to finish creating your account. It works once and expires in 15 minutes.</p>
        <div className="signin-row">
          <button type="button" className="signin-link" onClick={() => setSentTo(null)}>
            Use a different email
          </button>
        </div>
        {errorText && <p className="signin-error" role="alert">{errorText}</p>}
      </main>
    );
  }

  return (
    <main className="page">
      <Brand />
      <h1>Make an <mark>account</mark></h1>
      <p className="signin-lead">Your name is how your group sees you. No password: we email you a link to log in.</p>
      <form onSubmit={submit} noValidate className="signin-body">
        {errorText && <div className="signin-error-box" role="alert">{errorText}</div>}

        <label htmlFor="name">Your name</label>
        <input
          id="name"
          type="text"
          autoComplete="name"
          placeholder="Ana Reyes"
          value={name}
          aria-invalid={nameError !== null}
          onChange={(e) => {
            setName(e.target.value);
            setNameError(null);
          }}
        />
        {nameError && <p className="signin-field-error">{nameError}</p>}

        <label htmlFor="email">Email address</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          aria-invalid={emailError !== null}
          onChange={(e) => {
            setEmail(e.target.value);
            setEmailError(null);
          }}
        />
        {emailError && <p className="signin-field-error">{emailError}</p>}

        <label className="signin-consent">
          <input
            type="checkbox"
            className="signin-check"
            checked={agreed}
            aria-invalid={consentError !== null}
            onChange={(e) => {
              setAgreed(e.target.checked);
              setConsentError(null);
            }}
          />
          <span>
            I agree to the privacy notice.
            <small>Split uses your name and email only to share bills with your group.</small>
          </span>
        </label>
        {consentError && <p className="signin-field-error">{consentError}</p>}

        <button type="submit" className="signin-primary" disabled={busy}>
          {busy ? "Sending..." : "Create my account"}
        </button>
      </form>
      <p className="signin-hint">
        Already have an account? <a href="/login" className="signin-link">Log in</a>
      </p>
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
