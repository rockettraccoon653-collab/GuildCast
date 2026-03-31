import { useEffect, useMemo, useState } from "react";
import type { TeamMemberView } from "@stream-team/shared";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
const DEFAULT_BROADCASTER_ID = import.meta.env.VITE_BROADCASTER_ID ?? "demo-broadcaster";
const ACTIVE_BROADCASTER_KEY = "st-active-broadcaster";

function resolveBroadcasterId(): string {
  const query = new URLSearchParams(window.location.search);
  const fromUrl = query.get("b") ?? query.get("broadcaster") ?? "";
  const fromStorage = window.localStorage.getItem(ACTIVE_BROADCASTER_KEY) ?? "";
  const id = (fromUrl || fromStorage || DEFAULT_BROADCASTER_ID).trim().toLowerCase();
  window.localStorage.setItem(ACTIVE_BROADCASTER_KEY, id);
  return id;
}

export function App() {
  const [broadcasterId] = useState(resolveBroadcasterId);
  const [members, setMembers] = useState<TeamMemberView[]>([]);
  const [query, setQuery] = useState("");
  const [onboarded, setOnboarded] = useState(true);

  useEffect(() => {
    async function loadMembers() {
      const response = await fetch(`${API_BASE}/api/panel/${broadcasterId}/members`);
      const data = (await response.json()) as { members: TeamMemberView[]; onboarded?: boolean };
      setOnboarded(data.onboarded ?? true);
      setMembers(data.members ?? []);
    }

    void loadMembers();
  }, [broadcasterId]);

  const filtered = useMemo(() => {
    if (!query.trim()) {
      return members;
    }
    const normalized = query.toLowerCase();
    return members.filter((member) => member.displayName.toLowerCase().includes(normalized));
  }, [members, query]);

  return (
    <main className="panel-root">
      <header className="panel-header">
        <p className="kicker">Stream Team Hub</p>
        <h1>Spotlight Network</h1>
        <p className="broadcaster">Channel: {broadcasterId}</p>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search teammates"
          className="search"
        />
      </header>

      {!onboarded && (
        <section className="empty-state">
          <p>This channel is not activated yet. Open the Config view and run first-time setup.</p>
        </section>
      )}

      {onboarded && filtered.length === 0 && (
        <section className="empty-state">
          <p>No teammates found yet. Add members after onboarding is complete.</p>
        </section>
      )}

      <section className="member-grid">
        {filtered.map((member) => (
          <article key={member.userId} className="member-card">
            <img src={member.avatarUrl} alt={member.displayName} />
            <div>
              <h2>{member.displayName}</h2>
              <p className={member.live ? "live" : "offline"}>{member.live ? "Live now" : "Offline"}</p>
              <p className="bio">{member.bio ?? "No bio configured yet."}</p>
              <div className="badges">
                {member.teams.map((team) => (
                  <span key={team.id}>{team.name}</span>
                ))}
              </div>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
