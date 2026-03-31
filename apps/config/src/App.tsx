import { useEffect, useState } from "react";
import type {
  BroadcasterOnboardingResponse,
  BroadcasterSettings
} from "@stream-team/shared";

const RAW_API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
const API_BASE = RAW_API_BASE.replace(/\/+$/, "");
const API_ROOT = API_BASE.endsWith("/api") ? API_BASE : `${API_BASE}/api`;
const DEFAULT_BROADCASTER_ID = import.meta.env.VITE_BROADCASTER_ID ?? "demo-broadcaster";
const ACTIVE_BROADCASTER_KEY = "st-active-broadcaster";
const LOG_PREFIX = "[GuildCast Config]";

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

async function resolveTwitchChannelId(): Promise<string> {
  return new Promise((resolve) => {
    const twitch = (window as Window & { Twitch?: TwitchGlobal }).Twitch;
    const ext = twitch?.ext;

    if (!ext) {
      console.warn(`${LOG_PREFIX} Twitch helper not available yet; using fallback broadcaster id`);
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
  const [activeBroadcasterId, setActiveBroadcasterId] = useState(resolveInitialBroadcasterId);
  const [settings, setSettings] = useState<BroadcasterSettings | null>(null);
  const [creatorId, setCreatorId] = useState("1001");
  const [onboardBId, setOnboardBId] = useState(resolveInitialBroadcasterId);
  const [autoDetectedId, setAutoDetectedId] = useState(false);
  const [onboardName, setOnboardName] = useState("My Channel");
  const [onboardTeam, setOnboardTeam] = useState("Primary Team");
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [status, setStatus] = useState("Initializing config UI...");
  const [isLoading, setIsLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

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
      if (!mounted || !twitchId) {
        if (mounted) {
          console.info(`${LOG_PREFIX} no Twitch broadcaster id detected; using fallback`, {
            broadcasterId: activeBroadcasterId
          });
        }
        return;
      }

      console.info(`${LOG_PREFIX} resolved Twitch broadcaster id`, { twitchId });
      setAutoDetectedId(true);
      setActiveBroadcasterId((current) => (current === twitchId ? current : twitchId));
      setOnboardBId(twitchId);
    }

    void detectBroadcaster();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    async function load() {
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
        setNeedsOnboarding(false);
        setSettings(data);
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
  }, [activeBroadcasterId, reloadToken]);

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
        displayName: onboardName,
        primaryTeamName: onboardTeam
      })
    });

    if (!response.ok) {
      console.error(`${LOG_PREFIX} register broadcaster failed`, { status: response.status });
      setStatus("Setup failed. Please check your values.");
      return;
    }

    const data = (await response.json()) as BroadcasterOnboardingResponse;
    setActiveBroadcasterId(data.profile.broadcasterId);
    setSettings(data.settings);
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
          <label>
            Primary team name
            <input value={onboardTeam} onChange={(event) => setOnboardTeam(event.target.value)} />
          </label>
        </section>
        <section className="actions">
          <button onClick={registerBroadcaster}>Activate Extension</button>
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

      {!autoDetectedId && (
        <section className="actions switcher">
          <label>
            Switch broadcaster
            <input
              value={onboardBId}
              onChange={(event) => setOnboardBId(event.target.value)}
              placeholder="another-channel-login"
            />
          </label>
          <button onClick={() => setActiveBroadcasterId(onboardBId.trim().toLowerCase())}>
            Load Broadcaster
          </button>
        </section>
      )}

      <p className="status">{status}</p>
    </main>
  );
}
