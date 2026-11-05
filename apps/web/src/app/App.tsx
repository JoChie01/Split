/**
 * App.tsx
 *
 * WHAT: Picks the screen from the web address. "/" stays the landing page.
 * ROUTES: /signup (create an account), /login (ask for a link),
 *         /login/verify (opened from the email), /app (your groups),
 *         /privacy (the privacy notice).
 */
import { Landing } from "../landing/Landing";
import { Home } from "./Home";
import { SignIn, SignUp, Verify } from "./Auth";
import { Privacy } from "./Privacy";
import "./app.css";

export function App() {
  switch (window.location.pathname) {
    case "/signup":
      return <SignUp />;
    case "/login":
      return <SignIn />;
    case "/login/verify":
      return <Verify />;
    case "/app":
      return <Home />;
    case "/privacy":
      return <Privacy />;
    default:
      return <Landing />;
  }
}
