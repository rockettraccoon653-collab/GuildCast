import { useEffect, useState } from "react";
import type {
  BroadcasterOnboardingResponse,
  BroadcasterSettings,
  PanelDisplaySettings,
  TwitchTeamView
} from "@stream-team/shared";

const RAW_API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
const API_BASE = RAW_API_BASE.replace(/\/+$/, "");
const API_ROOT = API_BASE.endsWith("/api") ? API_BASE : `${API_BASE}/api`;
const DEFAULT_BROADCASTER_ID = import.meta.env.VITE_BROADCASTER_ID ?? "demo-broadcaster";
const ACTIVE_BROADCASTER_KEY = "st-active-broadcaster";
const LOG_PREFIX = "[GuildCast Config]";

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

function normalizeSettings(settings: BroadcasterSettings): BroadcasterSettings {
  return {
    ...settings,
    hiddenTeamIds: settings.hiddenTeamIds ?? [],
    panel: {
      ...DEFAULT_PANEL_SETTINGS,
      ...(settings.panel ?? {}),
      style: {
        ...DEFAULT_PANEL_SETTINGS.style,
        ...(settings.panel?.style ?? {})
      }
    }
  };
}

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

function resolveInitialBroadcasterId(): string {
  const fromQuery = new URLSearchParams(window.location.search).get("b") ?? "";
  const fromStorage = readStoredBroadcasterId();
  return (fromQuery || fromStorage || DEFAULT_BROADCASTER_ID).trim().toLowerCase();
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
  const [activeBroadcasterId, setActiveBroadcasterId] = useState(resolveInitialBroadcasterId);
  const [identityResolved, setIdentityResolved] = useState(false);
  const [settings, setSettings] = useState<BroadcasterSettings | null>(null);
  const [creatorId, setCreatorId] = useState("1001");
  const [onboardBId, setOnboardBId] = useState(resolveInitialBroadcasterId);
  const [autoDetectedId, setAutoDetectedId] = useState(false);
  const [onboardName, setOnboardName] = useState("My Channel");
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [status, setStatus] = useState("Initializing config UI...");
  const [isLoading, setIsLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [twitchTeams, setTwitchTeams] = useState<TwitchTeamView[]>([]);
  const [teamsStatus, setTeamsStatus] = useState("Loading Twitch stream teams...");

  useEffect(() => {
    const hasTwitchExt = Boolean((window as Window & { Twitch?: TwitchGlobal }).Twitch?.ext);
    console.info(`${LOG_PREFIX} app mounted`, {
      href: window.location.href,
      apiRoot: API_ROOT,
      hasTwitchExt,
      initialBroadcasterId: activeBroadcasterId
    });
  }, []);

  useEffect(() => {
    let mounted = true;

    async function detectBroadcaster() {
      const twitchId = await resolveTwitchChannelId();
      if (!mounted) {
        return;
      }

      if (!twitchId) {
        if (mounted) {
          console.info(`${LOG_PREFIX} no Twitch broadcaster id detected; using fallback`, {
            broadcasterId: activeBroadcasterId
          });
        }
        setIdentityResolved(true);
        return;
      }

      console.info(`${LOG_PREFIX} resolved Twitch broadcaster id`, { twitchId });
      setAutoDetectedId(true);
      setActiveBroadcasterId((current) => (current === twitchId ? current : twitchId));
      setOnboardBId(twitchId);
      setIdentityResolved(true);
    }

    void detectBroadcaster();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    async function load() {
      if (!identityResolved) {
        return;
      }

      console.info(`${LOG_PREFIX} loading settings`, {
        broadcasterId: activeBroadcasterId,
        url: `${API_ROOT}/settings/${activeBroadcasterId}`
      });
      setIsLoading(true);
      setStatus("Loading broadcaster settings...");
      try {
        const response = await fetch(`${API_ROOT}/settings/${activeBroadcasterId}`);

        if (response.status === 404) {
          console.warn(`${LOG_PREFIX} broadcaster not onboarded`, { broadcasterId: activeBroadcasterId });
          setNeedsOnboarding(true);
          setSettings(null);
          setStatus("Run first-time setup to activate this broadcaster.");
          setIsLoading(false);
          return;
        }

        if (!response.ok) {
          console.error(`${LOG_PREFIX} failed loading settings`, {
            broadcasterId: activeBroadcasterId,
            status: response.status
          });
          setNeedsOnboarding(false);
          setSettings(null);
          setStatus(`Could not load settings (HTTP ${response.status}). Check backend URL and try again.`);
          setIsLoading(false);
          return;
        }

        const data = (await response.json()) as BroadcasterSettings;
        const normalizedSettings = normalizeSettings(data);
        setNeedsOnboarding(false);
        setSettings(normalizedSettings);
        setStatus("Ready");
        setIsLoading(false);
        console.info(`${LOG_PREFIX} settings loaded`, { broadcasterId: activeBroadcasterId });
      } catch (error) {
        console.error(`${LOG_PREFIX} settings request error`, {
          broadcasterId: activeBroadcasterId,
          error
        });
        setNeedsOnboarding(false);
        setSettings(null);
        setStatus("Unable to reach backend. Check VITE_API_BASE_URL and HTTPS hosting.");
        setIsLoading(false);
      }
    }
    void load();
  }, [activeBroadcasterId, identityResolved, reloadToken]);

  useEffect(() => {
    async function loadTwitchTeams() {
      if (!identityResolved) {
        return;
      }

      const url = `${API_ROOT}/twitch-teams/${activeBroadcasterId}`;
      console.info(`${LOG_PREFIX} loading twitch teams`, {
        broadcasterId: activeBroadcasterId,
        url
      });
      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.warn(`${LOG_PREFIX} twitch teams request failed`, {
            broadcasterId: activeBroadcasterId,
            status: response.status
          });
          setTwitchTeams([]);
          setTeamsStatus(`Could not load Twitch teams (HTTP ${response.status}).`);
          return;
        }

        const payload = (await response.json()) as { teams?: TwitchTeamView[]; error?: string };
        console.info(`${LOG_PREFIX} frontend received payload`, {
          broadcasterId: activeBroadcasterId,
          payload
        });
        const teams = payload.teams ?? [];
        if (payload.error) {
          setTwitchTeams([]);
          setTeamsStatus(`Twitch teams error: ${payload.error}`);
          return;
        }
        setTwitchTeams(teams);
        setTeamsStatus(teams.length > 0 ? `Found ${teams.length} Twitch stream team(s).` : "No stream teams found");
        console.info(`${LOG_PREFIX} twitch teams loaded`, {
          broadcasterId: activeBroadcasterId,
          teamsReturned: teams.length
        });
      } catch (error) {
        console.error(`${LOG_PREFIX} twitch teams request error`, {
          broadcasterId: activeBroadcasterId,
          error
        });
        setTwitchTeams([]);
        setTeamsStatus("Unable to reach Twitch teams endpoint.");
      }
    }

    void loadTwitchTeams();
  }, [activeBroadcasterId, identityResolved, reloadToken]);

  useEffect(() => {
    writeStoredBroadcasterId(activeBroadcasterId);
  }, [activeBroadcasterId]);

  async function registerBroadcaster() {
    console.info(`${LOG_PREFIX} register broadcaster requested`, { broadcasterId: onboardBId });
    const response = await fetch(`${API_ROOT}/onboarding/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        broadcasterId: onboardBId,
        displayName: onboardName
      })
    });

    if (!response.ok) {
      console.error(`${LOG_PREFIX} register broadcaster failed`, { status: response.status });
      setStatus("Setup failed. Please check your values.");
      return;
    }

    const data = (await response.json()) as BroadcasterOnboardingResponse;
    setActiveBroadcasterId(data.profile.broadcasterId);
    setSettings(normalizeSettings(data.settings));
    setNeedsOnboarding(false);
    setIsLoading(false);
    console.info(`${LOG_PREFIX} register broadcaster succeeded`, {
      broadcasterId: data.profile.broadcasterId
    });
    setStatus(`Broadcaster ${data.profile.displayName} is now active.`);
  }

  async function save() {
    if (!settings) {
      console.warn(`${LOG_PREFIX} save skipped; settings not loaded`);
      return;
    }

    console.info(`${LOG_PREFIX} saving settings`, { broadcasterId: activeBroadcasterId });
    const response = await fetch(`${API_ROOT}/settings/${activeBroadcasterId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings)
    });

    if (response.ok) {
      setStatus("Settings saved");
      console.info(`${LOG_PREFIX} settings saved`, { broadcasterId: activeBroadcasterId });
    } else {
      console.error(`${LOG_PREFIX} settings save failed`, { status: response.status });
      setStatus("Save failed");
    }
  }

  async function triggerManual() {
    console.info(`${LOG_PREFIX} manual spotlight trigger requested`, {
      broadcasterId: activeBroadcasterId,
      creatorId
    });
    const response = await fetch(`${API_ROOT}/spotlight/manual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ broadcasterId: activeBroadcasterId, creatorUserId: creatorId })
    });

    if (response.ok) {
      setStatus("Spotlight triggered");
      console.info(`${LOG_PREFIX} manual spotlight trigger succeeded`);
    } else {
      console.error(`${LOG_PREFIX} manual spotlight trigger failed`, { status: response.status });
      setStatus("Trigger failed");
    }
  }

  function toggleTeamVisibility(teamId: string, shouldShow: boolean) {
    if (!settings) {
      return;
    }

    const hidden = new Set(settings.hiddenTeamIds ?? []);
    if (shouldShow) {
      hidden.delete(teamId);
    } else {
      hidden.add(teamId);
    }

    setSettings({
      ...settings,
      hiddenTeamIds: Array.from(hidden)
    });
  }

  useEffect(() => {
    console.info(`${LOG_PREFIX} render state`, {
      broadcasterId: activeBroadcasterId,
      needsOnboarding,
      hasSettings: Boolean(settings),
      isLoading,
      status
    });
  }, [activeBroadcasterId, isLoading, needsOnboarding, settings, status]);

  if (needsOnboarding) {
    return (
      <main className="config-root">
        <h1>Broadcaster Setup</h1>
        <p>Enter your channel information once to activate your Team Hub and Spotlight Overlay.</p>
        <section className="grid">
          <label>
            Broadcaster ID
            <input
              value={onboardBId}
              onChange={(event) => setOnboardBId(event.target.value)}
              readOnly={autoDetectedId}
            />
          </label>
          {autoDetectedId && (
            <p className="status">Detected from Twitch channel context.</p>
          )}
          <label>
            Display name
            <input value={onboardName} onChange={(event) => setOnboardName(event.target.value)} />
          </label>
        </section>
        <section className="actions">
          <button onClick={registerBroadcaster}>Activate Extension</button>
        </section>
        <section className="actions">
          <h2>Verified Twitch Stream Teams</h2>
          <p className="status">{teamsStatus}</p>
          {twitchTeams.length > 0 ? (
            <ul>
              {twitchTeams.map((team) => (
                <li key={team.id}>
                  {team.displayName}
                  {" "}
                  ({team.role === "owner" ? "Owner" : team.role === "member" ? "Member" : "Member"})
                </li>
              ))}
            </ul>
          ) : (
            <p className="status">No verified Twitch stream teams found for this broadcaster.</p>
          )}
        </section>
        <p className="status">{status}</p>
      </main>
    );
  }

  if (isLoading && !settings) {
    return (
      <main className="config-root">
        <h1>Broadcaster Control Console</h1>
        <p className="status">Loading settings for {activeBroadcasterId}...</p>
      </main>
    );
  }

  if (!settings) {
    return (
      <main className="config-root">
        <h1>Broadcaster Control Console</h1>
        <p className="status">{status || "Unable to load settings for this broadcaster."}</p>
        <section className="actions">
          <button onClick={() => setReloadToken((current) => current + 1)}>Retry</button>
        </section>
      </main>
    );
  }

  const hiddenTeamIds = new Set(settings.hiddenTeamIds ?? []);
  const visibleTeams = twitchTeams.filter((team) => !hiddenTeamIds.has(team.id));

  return (
    <main className="config-root">
      <h1>Broadcaster Control Console</h1>
      <p>Configure triggers, theme, and manual spotlight events.</p>
      <p className="active-id">Active broadcaster: {activeBroadcasterId}</p>

      <section className="grid">
        <label>
          <input
            type="checkbox"
            checked={settings.enableManualTrigger}
            onChange={(event) =>
              setSettings({ ...settings, enableManualTrigger: event.target.checked })
            }
          />
          Enable manual trigger
        </label>

        <label>
          <input
            type="checkbox"
            checked={settings.enableShoutoutTrigger}
            onChange={(event) =>
              setSettings({ ...settings, enableShoutoutTrigger: event.target.checked })
            }
          />
          Enable shoutout trigger
        </label>

        <label>
          <input
            type="checkbox"
            checked={settings.showAllTeams}
            onChange={(event) => setSettings({ ...settings, showAllTeams: event.target.checked })}
          />
          Show all teams
        </label>

        <label>
          Display duration (ms)
          <input
            type="number"
            value={settings.theme.displayDurationMs}
            onChange={(event) =>
              setSettings({
                ...settings,
                theme: { ...settings.theme, displayDurationMs: Number(event.target.value) }
              })
            }
          />
        </label>

        <label>
          Primary color
          <input
            type="color"
            value={settings.theme.primary}
            onChange={(event) =>
              setSettings({ ...settings, theme: { ...settings.theme, primary: event.target.value } })
            }
          />
        </label>
      </section>

      <section className="grid">
        <label>
          Panel title
          <input
            type="text"
            value={settings.panel.panelTitle}
            onChange={(event) =>
              setSettings({
                ...settings,
                panel: { ...settings.panel, panelTitle: event.target.value }
              })
            }
          />
        </label>

        <label>
          Empty state text
          <input
            type="text"
            value={settings.panel.emptyStateText}
            onChange={(event) =>
              setSettings({
                ...settings,
                panel: { ...settings.panel, emptyStateText: event.target.value }
              })
            }
          />
        </label>

        <label>
          Search placeholder
          <input
            type="text"
            value={settings.panel.searchPlaceholder}
            onChange={(event) =>
              setSettings({
                ...settings,
                panel: { ...settings.panel, searchPlaceholder: event.target.value }
              })
            }
          />
        </label>

        <label>
          <input
            type="checkbox"
            checked={settings.panel.showSearch}
            onChange={(event) =>
              setSettings({
                ...settings,
                panel: { ...settings.panel, showSearch: event.target.checked }
              })
            }
          />
          Show search
        </label>

        <label>
          <input
            type="checkbox"
            checked={settings.panel.showTeamChips}
            onChange={(event) =>
              setSettings({
                ...settings,
                panel: { ...settings.panel, showTeamChips: event.target.checked }
              })
            }
          />
          Show team chips
        </label>

        <label>
          <input
            type="checkbox"
            checked={settings.panel.showMemberCards}
            onChange={(event) =>
              setSettings({
                ...settings,
                panel: { ...settings.panel, showMemberCards: event.target.checked }
              })
            }
          />
          Show member cards
        </label>

        <label>
          <input
            type="checkbox"
            checked={settings.panel.showLiveStatus}
            onChange={(event) =>
              setSettings({
                ...settings,
                panel: { ...settings.panel, showLiveStatus: event.target.checked }
              })
            }
          />
          Show live status
        </label>

        <label>
          Page background
          <input
            type="text"
            value={settings.panel.style.pageBackground}
            onChange={(event) =>
              setSettings({
                ...settings,
                panel: {
                  ...settings.panel,
                  style: { ...settings.panel.style, pageBackground: event.target.value }
                }
              })
            }
          />
        </label>

        <label>
          Card background
          <input
            type="text"
            value={settings.panel.style.panelBackground}
            onChange={(event) =>
              setSettings({
                ...settings,
                panel: {
                  ...settings.panel,
                  style: { ...settings.panel.style, panelBackground: event.target.value }
                }
              })
            }
          />
        </label>

        <label>
          Primary text color
          <input
            type="color"
            value={settings.panel.style.primaryColor}
            onChange={(event) =>
              setSettings({
                ...settings,
                panel: {
                  ...settings.panel,
                  style: { ...settings.panel.style, primaryColor: event.target.value }
                }
              })
            }
          />
        </label>

        <label>
          Accent color
          <input
            type="color"
            value={settings.panel.style.accentColor}
            onChange={(event) =>
              setSettings({
                ...settings,
                panel: {
                  ...settings.panel,
                  style: { ...settings.panel.style, accentColor: event.target.value }
                }
              })
            }
          />
        </label>

        <label>
          Body text color
          <input
            type="color"
            value={settings.panel.style.textColor}
            onChange={(event) =>
              setSettings({
                ...settings,
                panel: {
                  ...settings.panel,
                  style: { ...settings.panel.style, textColor: event.target.value }
                }
              })
            }
          />
        </label>

        <label>
          Muted text color
          <input
            type="color"
            value={settings.panel.style.mutedTextColor}
            onChange={(event) =>
              setSettings({
                ...settings,
                panel: {
                  ...settings.panel,
                  style: { ...settings.panel.style, mutedTextColor: event.target.value }
                }
              })
            }
          />
        </label>

        <label>
          Font family
          <input
            type="text"
            value={settings.panel.style.fontFamily}
            onChange={(event) =>
              setSettings({
                ...settings,
                panel: {
                  ...settings.panel,
                  style: { ...settings.panel.style, fontFamily: event.target.value }
                }
              })
            }
          />
        </label>

        <label>
          Font size (px)
          <input
            type="number"
            value={settings.panel.style.fontSizePx}
            onChange={(event) =>
              setSettings({
                ...settings,
                panel: {
                  ...settings.panel,
                  style: { ...settings.panel.style, fontSizePx: Number(event.target.value) }
                }
              })
            }
          />
        </label>

        <label>
          Font weight
          <input
            type="number"
            value={settings.panel.style.fontWeight}
            onChange={(event) =>
              setSettings({
                ...settings,
                panel: {
                  ...settings.panel,
                  style: { ...settings.panel.style, fontWeight: Number(event.target.value) }
                }
              })
            }
          />
        </label>

        <label>
          Letter spacing (px)
          <input
            type="number"
            step="0.1"
            value={settings.panel.style.letterSpacingPx}
            onChange={(event) =>
              setSettings({
                ...settings,
                panel: {
                  ...settings.panel,
                  style: { ...settings.panel.style, letterSpacingPx: Number(event.target.value) }
                }
              })
            }
          />
        </label>

        <label>
          Section gap (px)
          <input
            type="number"
            value={settings.panel.style.sectionGapPx}
            onChange={(event) =>
              setSettings({
                ...settings,
                panel: {
                  ...settings.panel,
                  style: { ...settings.panel.style, sectionGapPx: Number(event.target.value) }
                }
              })
            }
          />
        </label>

        <label>
          Card padding (px)
          <input
            type="number"
            value={settings.panel.style.cardPaddingPx}
            onChange={(event) =>
              setSettings({
                ...settings,
                panel: {
                  ...settings.panel,
                  style: { ...settings.panel.style, cardPaddingPx: Number(event.target.value) }
                }
              })
            }
          />
        </label>

        <label>
          Border radius (px)
          <input
            type="number"
            value={settings.panel.style.borderRadiusPx}
            onChange={(event) =>
              setSettings({
                ...settings,
                panel: {
                  ...settings.panel,
                  style: { ...settings.panel.style, borderRadiusPx: Number(event.target.value) }
                }
              })
            }
          />
        </label>
      </section>

      <section className="actions">
        <button onClick={save}>Save Settings</button>
        <div className="manual-trigger">
          <input
            value={creatorId}
            onChange={(event) => setCreatorId(event.target.value)}
            placeholder="Creator user ID"
          />
          <button onClick={triggerManual}>Trigger Spotlight</button>
        </div>
      </section>

      <section className="actions">
        <h2>Verified Twitch Stream Teams</h2>
        <p className="status">{teamsStatus}</p>
        {twitchTeams.length > 0 ? (
          <>
            <ul>
              {twitchTeams.map((team) => {
                const isVisible = !hiddenTeamIds.has(team.id);
                return (
                  <li key={team.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={isVisible}
                        onChange={(event) => toggleTeamVisibility(team.id, event.target.checked)}
                      />
                      Show in extension
                    </label>
                    {" "}
                    {team.displayName}
                    {" "}
                    ({team.role === "owner" ? "Owner" : team.role === "member" ? "Member" : "Member"})
                  </li>
                );
              })}
            </ul>

            <h2>Visible Teams In Extension</h2>
            {visibleTeams.length > 0 ? (
              <ul>
                {visibleTeams.map((team) => (
                  <li key={team.id}>{team.displayName}</li>
                ))}
              </ul>
            ) : (
              <p className="status">All verified teams are currently hidden in extension output.</p>
            )}
          </>
        ) : (
          <p className="status">No verified Twitch stream teams found for this broadcaster.</p>
        )}
      </section>

      <p className="status">{status}</p>
    </main>
  );
}
