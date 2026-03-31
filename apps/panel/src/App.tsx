import { useEffect, useMemo, useState } from "react";
import type { TeamMemberView } from "@stream-team/shared";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
const DEFAULT_BROADCASTER_ID = import.meta.env.VITE_BROADCASTER_ID ?? "demo-broadcaster";
const ACTIVE_BROADCASTER_KEY = "st-active-broadcaster";

type TwitchAuthPayload = {
  channel_id?: string | number;
};

type TwitchAuth = {
  token?: string;
  channelId?: string;
};

type TwitchExt = {
  onAuthorized: (callback: (auth: TwitchAuth) => void) => void;
};

type TwitchGlobal = {
  ext?: TwitchExt;
};

function readStoredBroadcasterId(): string {
  try {
    return window.localStorage.getItem(ACTIVE_BROADCASTER_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeStoredBroadcasterId(value: string): void {
  try {
    window.localStorage.setItem(ACTIVE_BROADCASTER_KEY, value);
  } catch {
    // Ignore storage errors in embedded/sandboxed contexts.
  }
}

function resolveBroadcasterId(): string {
  const query = new URLSearchParams(window.location.search);
  const fromUrl = query.get("b") ?? query.get("broadcaster") ?? "";
  const fromStorage = readStoredBroadcasterId();
  const id = (fromUrl || fromStorage || DEFAULT_BROADCASTER_ID).trim().toLowerCase();
  writeStoredBroadcasterId(id);
  return id;
}

function decodeJwtPayload(token: string): TwitchAuthPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) {
      return null;
    }

    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const payload = JSON.parse(window.atob(padded)) as TwitchAuthPayload;
    return payload;
  } catch {
    return null;
  }
}

async function resolveTwitchChannelId(): Promise<string> {
  return new Promise((resolve) => {
    const twitch = (window as Window & { Twitch?: TwitchGlobal }).Twitch;
    const ext = twitch?.ext;

    if (!ext) {
      resolve("");
      return;
    }

    let finished = false;
    const timeout = window.setTimeout(() => {
      if (!finished) {
        finished = true;
        resolve("");
      }
    }, 1500);

    ext.onAuthorized((auth) => {
      if (finished) {
        return;
      }

      finished = true;
      window.clearTimeout(timeout);

      const fromAuth = auth.channelId?.trim();
      if (fromAuth) {
        resolve(fromAuth.toLowerCase());
        return;
      }

      const payload = auth.token ? decodeJwtPayload(auth.token) : null;
      const fromToken = payload?.channel_id;
      if (fromToken !== undefined && fromToken !== null) {
        resolve(String(fromToken).trim().toLowerCase());
        return;
      }

      resolve("");
    });
  });
}

export function App() {
  const [broadcasterId, setBroadcasterId] = useState(resolveBroadcasterId);
  const [members, setMembers] = useState<TeamMemberView[]>([]);
  const [query, setQuery] = useState("");
  const [onboarded, setOnboarded] = useState(true);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let mounted = true;

    async function detectBroadcaster() {
      const twitchId = await resolveTwitchChannelId();
      if (!mounted || !twitchId) {
        return;
      }

      setBroadcasterId((current) => (current === twitchId ? current : twitchId));
    }

    void detectBroadcaster();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    writeStoredBroadcasterId(broadcasterId);
  }, [broadcasterId]);

  useEffect(() => {
    async function loadMembers() {
      try {
        const response = await fetch(`${API_BASE}/api/panel/${broadcasterId}/members`);
        if (!response.ok) {
          setStatus("Could not load team hub data. Check backend URL and availability.");
          return;
        }
        const data = (await response.json()) as { members: TeamMemberView[]; onboarded?: boolean };
        setOnboarded(data.onboarded ?? true);
        setMembers(data.members ?? []);
      } catch {
        setStatus("Unable to reach backend. Check VITE_API_BASE_URL and HTTPS hosting.");
      }
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
        {status && <p className="broadcaster">{status}</p>}
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
