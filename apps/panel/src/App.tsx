import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type {
  BroadcasterSettings,
  PanelDisplaySettings,
  PanelMembersResponse,
  TeamBadge,
  TeamMemberView,
  TwitchTeamView
} from "@stream-team/shared";

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
  onContext?: (callback: (context: unknown, changed: string[]) => void) => void;
  actions?: {
    requestHeight: (height?: string | number) => void;
  };
};

type TwitchGlobal = {
  ext?: TwitchExt;
};

const LOG_PREFIX = "[GuildCast Panel]";
const TWITCH_PANEL_MAX_HEIGHT_PX = 496;
const TWITCH_PANEL_WIDTH_PX = 318;

const DEFAULT_PANEL_SETTINGS: PanelDisplaySettings = {
  panelTitle: "Spotlight Network",
  showSearch: true,
  showTeamChips: true,
  showMemberCards: true,
  showLiveStatus: true,
  emptyStateText: "No verified Twitch stream teams found for this broadcaster.",
  searchPlaceholder: "Search verified Twitch teammates",
  style: {
    pageBackground: "#071018",
    panelBackground: "rgba(15, 30, 44, 0.85)",
    panelHeightPx: 500,
    primaryColor: "#4effd6",
    accentColor: "#ff4d8d",
    textColor: "#e9f8ff",
    mutedTextColor: "#8fb2c2",
    fontFamily: "Space Grotesk, sans-serif",
    fontSizePx: 14,
    fontWeight: 500,
    letterSpacingPx: 0,
    cardPaddingPx: 14,
    sectionGapPx: 16,
    borderRadiusPx: 12
  }
};

function normalizePanelSettings(settings?: BroadcasterSettings | null): PanelDisplaySettings {
  return {
    ...DEFAULT_PANEL_SETTINGS,
    ...(settings?.panel ?? {}),
    style: {
      ...DEFAULT_PANEL_SETTINGS.style,
      ...(settings?.panel?.style ?? {})
    }
  };
}

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function resolveTwitchChannelId(): Promise<string> {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const twitch = (window as Window & { Twitch?: TwitchGlobal }).Twitch;
    const ext = twitch?.ext;

    if (!ext) {
      if (attempt === 1 || attempt % 5 === 0) {
        console.warn(`${LOG_PREFIX} Twitch helper not ready yet`, { attempt });
      }
      await sleep(250);
      continue;
    }

    const channelId = await new Promise<string>((resolve) => {
      let finished = false;
      const timeout = window.setTimeout(() => {
        if (!finished) {
          finished = true;
          resolve("");
        }
      }, 2500);

      ext.onAuthorized((auth) => {
        if (finished) {
          return;
        }

        finished = true;
        window.clearTimeout(timeout);

        const payload = auth.token ? decodeJwtPayload(auth.token) : null;
        console.info(`${LOG_PREFIX} Twitch auth object`, {
          channelId: auth.channelId,
          hasToken: Boolean(auth.token),
          decodedChannelId: payload?.channel_id ?? null
        });

        const fromAuth = auth.channelId?.trim();
        if (fromAuth) {
          resolve(fromAuth.toLowerCase());
          return;
        }

        const fromToken = payload?.channel_id;
        if (fromToken !== undefined && fromToken !== null) {
          resolve(String(fromToken).trim().toLowerCase());
          return;
        }

        resolve("");
      });
    });

    if (channelId) {
      return channelId;
    }

    await sleep(250);
  }

  console.warn(`${LOG_PREFIX} Twitch auth not resolved after retries; using fallback broadcaster id`);
  return "";
}

export function App() {
  const [broadcasterId, setBroadcasterId] = useState(resolveBroadcasterId);
  const [identityResolved, setIdentityResolved] = useState(false);
  const [members, setMembers] = useState<TeamMemberView[]>([]);
  const [teams, setTeams] = useState<TeamBadge[]>([]);
  const [query, setQuery] = useState("");
  const [onboarded, setOnboarded] = useState(true);
  const [status, setStatus] = useState("");
  const [panelSettings, setPanelSettings] = useState<PanelDisplaySettings>(DEFAULT_PANEL_SETTINGS);

  useEffect(() => {
    let canceled = false;

    function tryRequestHeight(reason: string): boolean {
      const twitch = (window as Window & { Twitch?: TwitchGlobal }).Twitch;
      const requestHeight = twitch?.ext?.actions?.requestHeight;
      if (!requestHeight) {
        return false;
      }

      requestHeight(496);
      console.info(`${LOG_PREFIX} requested panel height`, {
        reason,
        height: TWITCH_PANEL_MAX_HEIGHT_PX,
        width: TWITCH_PANEL_WIDTH_PX
      });
      return true;
    }

    async function requestMaxPanelHeight() {
      for (let attempt = 1; attempt <= 40; attempt += 1) {
        if (canceled) {
          return;
        }

        if (tryRequestHeight(`retry-${attempt}`)) {
          return;
        }

        await sleep(250);
      }

      console.warn(`${LOG_PREFIX} could not request panel height; Twitch actions API unavailable`);
    }

    const twitch = (window as Window & { Twitch?: TwitchGlobal }).Twitch;
    twitch?.ext?.onAuthorized(() => {
      void sleep(0).then(() => tryRequestHeight("onAuthorized"));
    });
    twitch?.ext?.onContext?.((_context, changed) => {
      if (changed.includes("isVisible") || changed.includes("theme")) {
        tryRequestHeight("onContext");
      }
    });

    const onWindowLoad = () => {
      tryRequestHeight("window-load");
    };
    window.addEventListener("load", onWindowLoad);

    void requestMaxPanelHeight();

    return () => {
      canceled = true;
      window.removeEventListener("load", onWindowLoad);
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function detectBroadcaster() {
      const twitchId = await resolveTwitchChannelId();
      if (!mounted) {
        return;
      }

      if (!twitchId) {
        console.info(`${LOG_PREFIX} using fallback broadcaster id`, { broadcasterId });
        setIdentityResolved(true);
        return;
      }

      setBroadcasterId((current) => (current === twitchId ? current : twitchId));
      setIdentityResolved(true);
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
      if (!identityResolved) {
        return;
      }

      try {
        const panelUrl = `${API_ROOT}/panel/${broadcasterId}/members`;
        const twitchTeamsUrl = `${API_ROOT}/twitch-teams/${broadcasterId}`;
        console.info(`${LOG_PREFIX} loading panel data`, {
          broadcasterId,
          panelUrl,
          twitchTeamsUrl
        });

        const [panelResponse, twitchTeamsResponse, settingsResponse] = await Promise.allSettled([
          fetch(panelUrl),
          fetch(twitchTeamsUrl),
          fetch(`${API_ROOT}/settings/${broadcasterId}`)
        ]);

        if (panelResponse.status === "rejected") {
          console.error(`${LOG_PREFIX} panel data request error`, {
            broadcasterId,
            reason: String(panelResponse.reason)
          });
          setStatus("Could not load team hub data. Check backend URL and availability.");
          return;
        }

        if (!panelResponse.value.ok) {
          console.error(`${LOG_PREFIX} panel data request failed`, {
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
              error?: string;
            };
            console.info(`${LOG_PREFIX} frontend received payload`, {
              broadcasterId,
              payload: twitchPayload
            });
            if (twitchPayload.error) {
              console.error(`${LOG_PREFIX} twitch teams backend error`, {
                broadcasterId,
                error: twitchPayload.error
              });
              setStatus(`Twitch teams error: ${twitchPayload.error}`);
            }
            twitchTeams = twitchPayload.teams ?? twitchTeams;
          } else {
            console.warn(`${LOG_PREFIX} twitch teams request failed`, {
              broadcasterId,
              status: twitchTeamsResponse.value.status
            });
          }
        } else {
          console.warn(`${LOG_PREFIX} twitch teams request error`, {
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

        if (settingsResponse.status === "fulfilled" && settingsResponse.value.ok) {
          const settingsPayload = (await settingsResponse.value.json()) as BroadcasterSettings;
          setPanelSettings(normalizePanelSettings(settingsPayload));
        } else {
          setPanelSettings(DEFAULT_PANEL_SETTINGS);
        }

        console.info(`${LOG_PREFIX} panel data loaded`, {
          broadcasterId,
          members: data.members?.length ?? 0,
          twitchTeams: twitchTeams.length,
          source: "twitch-verified"
        });
      } catch {
        console.error(`${LOG_PREFIX} panel data request error`, { broadcasterId });
        setStatus("Unable to reach backend. Check VITE_API_BASE_URL and HTTPS hosting.");
      }
    }

    void loadMembers();
  }, [broadcasterId, identityResolved]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const base = normalized
      ? members.filter((member) => member.displayName.toLowerCase().includes(normalized))
      : members;

    return [...base].sort((left, right) => {
      if (left.live !== right.live) {
        return left.live ? -1 : 1;
      }
      return left.displayName.localeCompare(right.displayName);
    });
  }, [members, query]);

  const panelStyle = {
    "--page-bg": panelSettings.style.pageBackground,
    "--panel-card": panelSettings.style.panelBackground,
    "--panel-height": `${TWITCH_PANEL_MAX_HEIGHT_PX}px`,
    "--primary": panelSettings.style.primaryColor,
    "--accent": panelSettings.style.accentColor,
    "--ink": panelSettings.style.textColor,
    "--muted": panelSettings.style.mutedTextColor,
    "--font-family": panelSettings.style.fontFamily,
    "--font-size": `${panelSettings.style.fontSizePx}px`,
    "--font-weight": String(panelSettings.style.fontWeight),
    "--letter-spacing": `${panelSettings.style.letterSpacingPx}px`,
    "--section-gap": `${panelSettings.style.sectionGapPx}px`,
    "--card-padding": `${panelSettings.style.cardPaddingPx}px`,
    "--radius": `${panelSettings.style.borderRadiusPx}px`,
    "--panel-width": `${TWITCH_PANEL_WIDTH_PX}px`
  } as CSSProperties;

  return (
    <main className="panel-root" style={panelStyle}>
      <header className="panel-header">
        <p className="kicker">Stream Team Hub</p>
        <h1>{panelSettings.panelTitle}</h1>
        <p className="broadcaster">Channel: {broadcasterId}</p>
        {panelSettings.showSearch && (
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={panelSettings.searchPlaceholder}
            className="search"
          />
        )}
        {status && <p className="broadcaster">{status}</p>}
      </header>

      {!onboarded && (
        <section className="empty-state">
          <p>This channel is not activated yet for settings. Verified Twitch teams and teammates still load automatically.</p>
        </section>
      )}

      {teams.length > 0 && members.length === 0 && (
        <section className="empty-state">
          <p>No verified Twitch teammates were returned by Twitch for these teams.</p>
        </section>
      )}

      {teams.length > 0 && members.length > 0 && filtered.length === 0 && (
        <section className="empty-state">
          <p>No verified Twitch teammates matched your search.</p>
        </section>
      )}

      {teams.length === 0 && (
        <section className="empty-state">
          <p>{panelSettings.emptyStateText}</p>
        </section>
      )}

      {!panelSettings.showMemberCards && (
        <section className="empty-state">
          <p>Member cards are hidden by broadcaster settings.</p>
        </section>
      )}

      {panelSettings.showMemberCards && (
        <section className="member-grid">
          {filtered.map((member) => (
          <article key={member.userId} className="member-card">
            <img src={member.avatarUrl} alt={member.displayName} />
            <div>
              <h2>{member.displayName}</h2>
              {panelSettings.showLiveStatus && (
                <p className={member.live ? "live" : "offline"}>{member.live ? "Live now" : "Offline"}</p>
              )}
              <p className="bio">{member.bio ?? "No bio configured yet."}</p>
              {panelSettings.showTeamChips && (
                <div className="badges">
                  {member.teams.map((team) => (
                    <span key={team.id}>
                      {team.name} · {team.isOwner ? "Owner" : "Member"}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </article>
          ))}
        </section>
      )}
    </main>
  );
}
