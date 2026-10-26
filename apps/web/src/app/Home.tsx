/**
 * Home.tsx
 *
 * WHAT: The logged-in home. Lists your groups, and opens one to show its bills and payments.
 */
import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { GroupPage } from "./GroupPage";
import type { GroupSummary } from "./types";

export function Home() {
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loggedOut, setLoggedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<GroupSummary[]>("GET", "/me/groups")
      .then(setGroups)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) setLoggedOut(true);
        else setError(err instanceof Error ? err.message : "Could not load your groups.");
      });
  }, []);

  if (loggedOut) {
    return (
      <main className="app-page">
        <h1>Split</h1>
        <p><a href="/login">Log in</a> to see your groups.</p>
      </main>
    );
  }
  if (error) return <main className="app-page"><p className="app-error" role="alert">{error}</p></main>;
  if (!groups) return <main className="app-page"><p>Loading...</p></main>;

  if (openId) return <GroupPage groupId={openId} onBack={() => setOpenId(null)} />;

  return (
    <main className="app-page">
      <h1>Your groups</h1>
      {groups.length === 0 && <p className="app-note">You're not in any group yet.</p>}
      <ul className="app-list">
        {groups.map((g) => (
          <li key={g.id}>
            <button type="button" className="app-row" onClick={() => setOpenId(g.id)}>
              {g.name}
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
