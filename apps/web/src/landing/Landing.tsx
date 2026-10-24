/*
 * landing/Landing.tsx
 *
 * WHAT: The landing page. It explains the app in three steps and invites people to try it.
 * LAYOUT: One column, designed for a phone first. On a laptop it stays centred and narrow.
 */
import { Mark, Wordmark } from "../brand/Logo";
import { Receipt } from "./Receipt";

export function Landing() {
  return (
    <div className="page">
      <header className="top">
        <a className="logo" href="/" aria-label="Split home">
          <Mark />
          <Wordmark />
        </a>
        <a className="login" href="/login">Log in</a>
      </header>

      <h1>
        Split the bill, <mark>not the friendship.</mark>
      </h1>
      <p className="lead">
        Everyone taps what they ordered. The service charge is shared fairly. Nobody chases anyone for ₱47.
      </p>

      <Receipt />

      <section className="steps" aria-labelledby="how">
        <h2 id="how">How it works</h2>
        <ol>
          <li>
            <span className="num">1</span>
            <div>
              <strong>Add the bill</strong>
              <span className="desc">Type it in, or snap the receipt.</span>
            </div>
          </li>
          <li>
            <span className="num">2</span>
            <div>
              <strong>Everyone taps their own</strong>
              <span className="desc">Each person sees their total change live.</span>
            </div>
          </li>
          <li>
            <span className="num">3</span>
            <div>
              <strong>Confirm, then pay</strong>
              <span className="desc">Nothing moves until the payer locks it in.</span>
            </div>
          </li>
        </ol>
      </section>

      <a className="cta" href="/login">Start a bill</a>
      <p className="fine">No app to download. Works in your phone&apos;s browser.</p>
      <p className="foot">Made for the barkada</p>
    </div>
  );
}