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
  const [onboardTeam, setOnboardTeam] = useState("My Stream Team");
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let mounted = true;

    async function detectBroadcaster() {
      const twitchId = await resolveTwitchChannelId();
      if (!mounted || !twitchId) {
        return;
      }

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
      setStatus("Loading broadcaster settings...");
      try {
        const response = await fetch(`${API_ROOT}/settings/${activeBroadcasterId}`);

        if (response.status === 404) {
          setNeedsOnboarding(true);
          setSettings(null);
          setStatus("Run first-time setup to activate this broadcaster.");
          return;
        }

        if (!response.ok) {
          setStatus("Could not load settings. Check backend URL and try again.");
          return;
        }

        const data = (await response.json()) as BroadcasterSettings;
        setNeedsOnboarding(false);
        setSettings(data);
        setStatus("Ready");
      } catch {
        setStatus("Unable to reach backend. Check VITE_API_BASE_URL and HTTPS hosting.");
      }
    }
    void load();
  }, [activeBroadcasterId]);

  useEffect(() => {
    writeStoredBroadcasterId(activeBroadcasterId);
  }, [activeBroadcasterId]);

  async function registerBroadcaster() {
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
      setStatus("Setup failed. Please check your values.");
      return;
    }

    const data = (await response.json()) as BroadcasterOnboardingResponse;
    setActiveBroadcasterId(data.profile.broadcasterId);
    setSettings(data.settings);
    setNeedsOnboarding(false);
    setStatus(`Broadcaster ${data.profile.displayName} is now active.`);
  }

  async function save() {
    if (!settings) {
      return;
    }

    const response = await fetch(`${API_ROOT}/settings/${activeBroadcasterId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings)
    });

    if (response.ok) {
      setStatus("Settings saved");
    } else {
      setStatus("Save failed");
    }
  }

  async function triggerManual() {
    const response = await fetch(`${API_ROOT}/spotlight/manual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ broadcasterId: activeBroadcasterId, creatorUserId: creatorId })
    });

    if (response.ok) {
      setStatus("Spotlight triggered");
    } else {
      setStatus("Trigger failed");
    }
  }

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

  if (!settings) {
    return <div className="loading">Loading settings for {activeBroadcasterId}...</div>;
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
