import { useEffect, useMemo, useState } from "react";
import type { SpotlightCardData } from "@stream-team/shared";

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
  const [card, setCard] = useState<SpotlightCardData | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState("Awaiting spotlight trigger...");

  useEffect(() => {
    let source: EventSource | null = null;

    async function connect() {
      const check = await fetch(`${API_BASE}/api/onboarding/${broadcasterId}`);
      if (check.status === 404) {
        setStatus(`Channel ${broadcasterId} is not activated yet.`);
        return;
      }

      source = new EventSource(`${API_BASE}/api/overlay/stream/${broadcasterId}`);
      source.onmessage = (event) => {
        const parsed = JSON.parse(event.data) as SpotlightCardData;
        setExpanded(false);
        setStatus("Live spotlight feed connected");
        setCard(parsed);
      };
      source.onerror = () => {
        setStatus("Overlay stream reconnecting...");
      };
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
