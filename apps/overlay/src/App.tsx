import { useEffect, useMemo, useState } from "react";
import type { SpotlightCardData } from "@stream-team/shared";

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
  const [card, setCard] = useState<SpotlightCardData | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState("Awaiting spotlight trigger...");

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
    let source: EventSource | null = null;

    async function connect() {
      try {
        const check = await fetch(`${API_ROOT}/onboarding/${broadcasterId}`);
        if (check.status === 404) {
          setStatus(`Channel ${broadcasterId} is not activated yet.`);
          return;
        }

        if (!check.ok) {
          setStatus("Unable to verify onboarding status.");
          return;
        }

        source = new EventSource(`${API_ROOT}/overlay/stream/${broadcasterId}`);
        source.onmessage = (event) => {
          const parsed = JSON.parse(event.data) as SpotlightCardData;
          setExpanded(false);
          setStatus("Live spotlight feed connected");
          setCard(parsed);
        };
        source.onerror = () => {
          setStatus("Overlay stream reconnecting...");
        };
      } catch {
        setStatus("Unable to reach backend. Check VITE_API_BASE_URL and HTTPS hosting.");
      }
    }

    void connect();

    return () => {
      source?.close();
    };
  }, [broadcasterId]);

  const teamList = useMemo(() => {
    if (!card) {
      return "";
    }
    return card.sharedTeams.map((team) => team.name).join(" • ");
  }, [card]);

  if (!card) {
    return <div className="idle">{status}</div>;
  }

  return (
    <section className={`spotlight ${expanded ? "expanded" : ""}`}>
      <div className="halo" />
      <img src={card.creator.avatarUrl} alt={card.creator.displayName} className="avatar" />
      <div className="content">
        <p className="chip">{card.source.toUpperCase()} SPOTLIGHT</p>
        <h1>{card.creator.displayName}</h1>
        <p className={card.creator.live ? "live" : "offline"}>
          {card.creator.live ? `LIVE • ${card.creator.currentCategory ?? "Streaming"}` : "OFFLINE"}
        </p>
        <p className="bio">{card.creator.bio ?? "No custom bio yet."}</p>
        <div className="teams">{teamList || "No shared teams detected"}</div>
      </div>
      <div className="actions">
        <button onClick={() => setExpanded((v) => !v)}>{expanded ? "Collapse" : "Expand"}</button>
        <button onClick={() => setCard(null)}>Dismiss</button>
      </div>
    </section>
  );
}
