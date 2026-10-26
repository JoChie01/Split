/**
 * App.tsx
 *
 * WHAT: Picks the screen from the web address. "/" stays the landing page.
 * ROUTES: /login (ask for a link), /login/verify (opened from the email), /app (your groups).
 */
import { Landing } from "../landing/Landing";
import { Home } from "./Home";
import { SignIn, Verify } from "./Auth";
import "./app.css";

export function App() {
  switch (window.location.pathname) {
    case "/login":
      return <SignIn />;
    case "/login/verify":
      return <Verify />;
    case "/app":
      return <Home />;
    default:
      return <Landing />;
  }
}
