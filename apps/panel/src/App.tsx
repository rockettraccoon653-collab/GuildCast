import { useEffect, useMemo, useState } from "react";
import type { PanelMembersResponse, TeamBadge, TeamMemberView, TwitchTeamView } from "@stream-team/shared";

const RAW_API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
const API_BASE = RAW_API_BASE.replace(/\/+$/, "");
const API_ROOT = API_BASE.endsWith("/api") ? API_BASE : `${API_BASE}/api`;
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
  const [teams, setTeams] = useState<TeamBadge[]>([]);
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
        const panelUrl = `${API_ROOT}/panel/${broadcasterId}/members`;
        const twitchTeamsUrl = `${API_ROOT}/twitch-teams/${broadcasterId}`;
        console.info("[GuildCast Panel] loading panel data", {
          broadcasterId,
          panelUrl,
          twitchTeamsUrl
        });

        const [panelResponse, twitchTeamsResponse] = await Promise.allSettled([
          fetch(panelUrl),
          fetch(twitchTeamsUrl)
        ]);

        if (panelResponse.status === "rejected") {
          console.error("[GuildCast Panel] panel data request error", {
            broadcasterId,
            reason: String(panelResponse.reason)
          });
          setStatus("Could not load team hub data. Check backend URL and availability.");
          return;
        }

        if (!panelResponse.value.ok) {
          console.error("[GuildCast Panel] panel data request failed", {
            broadcasterId,
            status: panelResponse.value.status
          });
          setStatus("Could not load team hub data. Check backend URL and availability.");
          return;
        }

        const data = (await panelResponse.value.json()) as PanelMembersResponse;
        let twitchTeams: TwitchTeamView[] = data.twitchTeams ?? [];

        if (twitchTeamsResponse.status === "fulfilled") {
          if (twitchTeamsResponse.value.ok) {
            const twitchPayload = (await twitchTeamsResponse.value.json()) as {
              teams?: TwitchTeamView[];
            };
            twitchTeams = twitchPayload.teams ?? twitchTeams;
          } else {
            console.warn("[GuildCast Panel] twitch teams request failed", {
              broadcasterId,
              status: twitchTeamsResponse.value.status
            });
          }
        } else {
          console.warn("[GuildCast Panel] twitch teams request error", {
            broadcasterId,
            reason: String(twitchTeamsResponse.reason)
          });
        }

        const twitchAsBadges = twitchTeams.map((team) => ({
          id: team.id,
          name: team.displayName || team.name,
          thumbnailUrl: team.thumbnailUrl,
          ownerId: team.ownerId,
          isOwner: team.role === "owner",
          source: "twitch-verified" as const
        }));

        setOnboarded(data.onboarded ?? true);
        setMembers(data.members ?? []);
        setTeams(twitchAsBadges);
        console.info("[GuildCast Panel] panel data loaded", {
          broadcasterId,
          members: data.members?.length ?? 0,
          twitchTeams: twitchTeams.length,
          source: "twitch-verified"
        });
      } catch {
        console.error("[GuildCast Panel] panel data request error", { broadcasterId });
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

      {onboarded && teams.length === 0 && (
        <section className="empty-state">
          <p>No verified Twitch stream teams found for this broadcaster.</p>
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
                {(teams.length > 0 ? teams : member.teams).map((team) => (
                  <span key={team.id}>
                    {team.name} · {team.isOwner ? "Owner" : "Member"}
                  </span>
                ))}
              </div>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
