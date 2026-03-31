import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
const RAW_API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
const API_BASE = RAW_API_BASE.replace(/\/+$/, "");
const API_ROOT = API_BASE.endsWith("/api") ? API_BASE : `${API_BASE}/api`;
const DEFAULT_BROADCASTER_ID = import.meta.env.VITE_BROADCASTER_ID ?? "demo-broadcaster";
const ACTIVE_BROADCASTER_KEY = "st-active-broadcaster";
const LOG_PREFIX = "[GuildCast Panel]";
function readStoredBroadcasterId() {
    try {
        return window.localStorage.getItem(ACTIVE_BROADCASTER_KEY) ?? "";
    }
    catch {
        return "";
    }
}
function writeStoredBroadcasterId(value) {
    try {
        window.localStorage.setItem(ACTIVE_BROADCASTER_KEY, value);
    }
    catch {
        // Ignore storage errors in embedded/sandboxed contexts.
    }
}
function resolveBroadcasterId() {
    const query = new URLSearchParams(window.location.search);
    const fromUrl = query.get("b") ?? query.get("broadcaster") ?? "";
    const fromStorage = readStoredBroadcasterId();
    const id = (fromUrl || fromStorage || DEFAULT_BROADCASTER_ID).trim().toLowerCase();
    writeStoredBroadcasterId(id);
    return id;
}
function decodeJwtPayload(token) {
    try {
        const parts = token.split(".");
        if (parts.length < 2) {
            return null;
        }
        const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
        const payload = JSON.parse(window.atob(padded));
        return payload;
    }
    catch {
        return null;
    }
}
function sleep(ms) {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });
}
async function resolveTwitchChannelId() {
    for (let attempt = 1; attempt <= 20; attempt += 1) {
        const twitch = window.Twitch;
        const ext = twitch?.ext;
        if (!ext) {
            if (attempt === 1 || attempt % 5 === 0) {
                console.warn(`${LOG_PREFIX} Twitch helper not ready yet`, { attempt });
            }
            await sleep(250);
            continue;
        }
        const channelId = await new Promise((resolve) => {
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
    const [members, setMembers] = useState([]);
    const [teams, setTeams] = useState([]);
    const [query, setQuery] = useState("");
    const [onboarded, setOnboarded] = useState(true);
    const [status, setStatus] = useState("");
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
                const [panelResponse, twitchTeamsResponse] = await Promise.allSettled([
                    fetch(panelUrl),
                    fetch(twitchTeamsUrl)
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
                const data = (await panelResponse.value.json());
                let twitchTeams = data.twitchTeams ?? [];
                if (twitchTeamsResponse.status === "fulfilled") {
                    if (twitchTeamsResponse.value.ok) {
                        const twitchPayload = (await twitchTeamsResponse.value.json());
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
                    }
                    else {
                        console.warn(`${LOG_PREFIX} twitch teams request failed`, {
                            broadcasterId,
                            status: twitchTeamsResponse.value.status
                        });
                    }
                }
                else {
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
                    source: "twitch-verified"
                }));
                setOnboarded(data.onboarded ?? true);
                setMembers(data.members ?? []);
                setTeams(twitchAsBadges);
                console.info(`${LOG_PREFIX} panel data loaded`, {
                    broadcasterId,
                    members: data.members?.length ?? 0,
                    twitchTeams: twitchTeams.length,
                    source: "twitch-verified"
                });
            }
            catch {
                console.error(`${LOG_PREFIX} panel data request error`, { broadcasterId });
                setStatus("Unable to reach backend. Check VITE_API_BASE_URL and HTTPS hosting.");
            }
        }
        void loadMembers();
    }, [broadcasterId, identityResolved]);
    const filtered = useMemo(() => {
        if (!query.trim()) {
            return members;
        }
        const normalized = query.toLowerCase();
        return members.filter((member) => member.displayName.toLowerCase().includes(normalized));
    }, [members, query]);
    return (_jsxs("main", { className: "panel-root", children: [_jsxs("header", { className: "panel-header", children: [_jsx("p", { className: "kicker", children: "Stream Team Hub" }), _jsx("h1", { children: "Spotlight Network" }), _jsxs("p", { className: "broadcaster", children: ["Channel: ", broadcasterId] }), _jsx("input", { value: query, onChange: (event) => setQuery(event.target.value), placeholder: "Search verified Twitch teammates", className: "search" }), status && _jsx("p", { className: "broadcaster", children: status })] }), !onboarded && (_jsx("section", { className: "empty-state", children: _jsx("p", { children: "This channel is not activated yet for settings. Verified Twitch teams and teammates still load automatically." }) })), teams.length > 0 && members.length === 0 && (_jsx("section", { className: "empty-state", children: _jsx("p", { children: "No verified Twitch teammates were returned by Twitch for these teams." }) })), teams.length > 0 && members.length > 0 && filtered.length === 0 && (_jsx("section", { className: "empty-state", children: _jsx("p", { children: "No verified Twitch teammates matched your search." }) })), teams.length > 0 && (_jsx("section", { className: "empty-state", children: _jsx("p", { children: "Search shows members from verified Twitch team rosters (across all teams)." }) })), teams.length === 0 && (_jsx("section", { className: "empty-state", children: _jsx("p", { children: "No verified Twitch stream teams found for this broadcaster." }) })), teams.length > 0 && (_jsxs("section", { className: "empty-state", children: [_jsx("p", { children: "Verified Twitch Teams" }), _jsx("div", { className: "badges", children: teams.map((team) => (_jsxs("span", { children: [team.name, " \u00B7 ", team.isOwner ? "Owner" : "Member"] }, team.id))) })] })), _jsx("section", { className: "member-grid", children: filtered.map((member) => (_jsxs("article", { className: "member-card", children: [_jsx("img", { src: member.avatarUrl, alt: member.displayName }), _jsxs("div", { children: [_jsx("h2", { children: member.displayName }), _jsx("p", { className: member.live ? "live" : "offline", children: member.live ? "Live now" : "Offline" }), _jsx("p", { className: "bio", children: member.bio ?? "No bio configured yet." }), _jsx("div", { className: "badges", children: (teams.length > 0 ? teams : member.teams).map((team) => (_jsxs("span", { children: [team.name, " \u00B7 ", team.isOwner ? "Owner" : "Member"] }, team.id))) })] })] }, member.userId))) })] }));
}
//# sourceMappingURL=App.js.map