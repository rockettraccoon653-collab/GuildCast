import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import type {
  BroadcasterOnboardingRequest,
  BroadcasterSettings,
  PanelMembersResponse,
  TeamMemberView,
  TwitchTeamView
} from "@stream-team/shared";
import { InMemoryStore } from "./domain/store";
import { SpotlightService } from "./domain/spotlight";
import { RealtimeBroker } from "./realtime/broker";
import { TwitchTeamsService } from "./domain/twitchTeams";

// Support running from either workspace root or apps/backend working directory.
loadEnv({ path: resolve(process.cwd(), ".env") });
loadEnv({ path: resolve(process.cwd(), "../../.env") });

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.log.info(
  {
    hasTwitchClientId: Boolean(process.env.TWITCH_CLIENT_ID?.trim()),
    hasTwitchClientSecret: Boolean(process.env.TWITCH_CLIENT_SECRET?.trim()),
    hasTwitchAppToken: Boolean(process.env.TWITCH_APP_ACCESS_TOKEN?.trim())
  },
  "Backend Twitch credential presence"
);

const store = new InMemoryStore();
const spotlightService = new SpotlightService(store);
const broker = new RealtimeBroker();
const twitchTeamsService = new TwitchTeamsService(app.log);

const settingsSchema = z.object({
  broadcasterId: z.string().min(1),
  enableManualTrigger: z.boolean(),
  enableShoutoutTrigger: z.boolean(),
  showAllTeams: z.boolean(),
  hiddenTeamIds: z.array(z.string().min(1)).default([]),
  followCtaEnabled: z.boolean(),
  panel: z.object({
    panelTitle: z.string().min(1).max(80),
    showSearch: z.boolean(),
    showTeamChips: z.boolean(),
    showMemberCards: z.boolean(),
    showLiveStatus: z.boolean(),
    emptyStateText: z.string().min(1).max(200),
    searchPlaceholder: z.string().min(1).max(120),
    style: z.object({
      pageBackground: z.string().min(1),
      panelBackground: z.string().min(1),
      panelHeightPx: z.number().int().min(280).max(500),
      primaryColor: z.string().min(1),
      accentColor: z.string().min(1),
      textColor: z.string().min(1),
      mutedTextColor: z.string().min(1),
      fontFamily: z.string().min(1),
      fontSizePx: z.number().int().min(10).max(32),
      fontWeight: z.number().int().min(300).max(900),
      letterSpacingPx: z.number().min(-1).max(6),
      cardPaddingPx: z.number().int().min(4).max(40),
      sectionGapPx: z.number().int().min(4).max(40),
      borderRadiusPx: z.number().int().min(0).max(40)
    })
  }),
  theme: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    primary: z.string().min(4),
    accent: z.string().min(4),
    glow: z.string().min(4),
    motionPreset: z.enum(["arc", "pulse", "warp"]),
    displayDurationMs: z.number().int().min(1000).max(30000)
  })
});

const manualTriggerSchema = z.object({
  broadcasterId: z.string().min(1),
  creatorUserId: z.string().min(1)
});

const shoutoutSchema = z.object({
  broadcasterId: z.string().min(1),
  creatorUserId: z.string().min(1)
});

const onboardingSchema = z.object({
  broadcasterId: z.string().min(3),
  displayName: z.string().min(2)
});

function mapVerifiedTeammates(
  twitchTeams: TwitchTeamView[],
  memberProfilesByUserId: Map<
    string,
    {
      displayName?: string;
      avatarUrl?: string;
      bio?: string;
      live: boolean;
      category?: string;
    }
  >
): TeamMemberView[] {
  const byUserId = new Map<string, TeamMemberView>();

  for (const team of twitchTeams) {
    for (const member of team.members ?? []) {
      const existing = byUserId.get(member.userId);
      const badge = {
        id: team.id,
        name: team.displayName || team.name,
        thumbnailUrl: team.thumbnailUrl,
        ownerId: team.ownerId,
        isOwner: team.role === "owner",
        source: "twitch-verified" as const
      };

      if (!existing) {
        const profile = memberProfilesByUserId.get(member.userId);
        byUserId.set(member.userId, {
          userId: member.userId,
          displayName: profile?.displayName || member.displayName || member.login,
          avatarUrl:
            profile?.avatarUrl ??
            "https://static-cdn.jtvnw.net/jtv_user_pictures/xarth/404_user_70x70.png",
          live: profile?.live ?? false,
          category: profile?.category,
          bio: profile?.bio ?? "",
          teams: [badge]
        });
        continue;
      }

      const hasBadge = existing.teams.some((item) => item.id === badge.id);
      if (!hasBadge) {
        existing.teams = [...existing.teams, badge];
      }
    }
  }

  return Array.from(byUserId.values());
}

app.get("/health", async () => ({ ok: true, service: "stream-team-backend" }));

app.get("/api/panel/:broadcasterId/members", async (request) => {
  const { broadcasterId } = request.params as { broadcasterId: string };
  let twitchTeams = [] as Awaited<ReturnType<typeof twitchTeamsService.getTwitchTeams>>;
  try {
    twitchTeams = await twitchTeamsService.getTwitchTeams(broadcasterId);
  } catch (error) {
    app.log.error(
      {
        broadcasterId,
        errorMessage: error instanceof Error ? error.message : String(error)
      },
      "Unable to load Twitch teams for panel response"
    );
  }

  const onboarded = store.hasBroadcaster(broadcasterId);
  const settings = store.getSettings(broadcasterId);
  const hiddenTeamIds = new Set((settings.hiddenTeamIds ?? []).map((teamId) => teamId.toLowerCase()));
  const visibleTwitchTeams = twitchTeams.filter((team) => !hiddenTeamIds.has(team.id.toLowerCase()));

  const twitchBadges = visibleTwitchTeams.map((team) => ({
    id: team.id,
    name: team.displayName || team.name,
    thumbnailUrl: team.thumbnailUrl,
    ownerId: team.ownerId,
    isOwner: team.role === "owner",
    source: "twitch-verified" as const
  }));

  let memberProfilesByUserId = new Map<
    string,
    {
      displayName?: string;
      avatarUrl?: string;
      bio?: string;
      live: boolean;
      category?: string;
    }
  >();

  try {
    memberProfilesByUserId = await twitchTeamsService.getMemberProfiles(
      visibleTwitchTeams.flatMap((team) => (team.members ?? []).map((member) => member.userId))
    );
  } catch (error) {
    app.log.warn(
      {
        broadcasterId,
        errorMessage: error instanceof Error ? error.message : String(error)
      },
      "Unable to enrich Twitch member profile/live status; continuing with roster identities"
    );
  }

  const membersWithTeams = mapVerifiedTeammates(visibleTwitchTeams, memberProfilesByUserId);

  app.log.info(
    {
      broadcasterId,
      onboarded,
      members: membersWithTeams.length,
      twitchTeamsTotal: twitchTeams.length,
      twitchTeamsVisible: visibleTwitchTeams.length,
      hiddenTeamIds: Array.from(hiddenTeamIds)
    },
    "Resolved panel members response"
  );

  return {
    broadcasterId,
    members: membersWithTeams,
    teams: twitchBadges,
    twitchTeams: visibleTwitchTeams,
    onboarded
  } satisfies PanelMembersResponse;
});

app.get("/api/twitch-teams/:broadcasterId", async (request) => {
  const { broadcasterId } = request.params as { broadcasterId: string };
  app.log.info(
    {
      broadcasterId,
      requestUrl: `/api/twitch-teams/${broadcasterId}`
    },
    "Twitch team membership request received"
  );
  let teams;
  try {
    teams = await twitchTeamsService.getTwitchTeams(broadcasterId);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    app.log.error(
      {
        broadcasterId,
        errorMessage
      },
      "Twitch team membership request failed"
    );
    return {
      broadcasterId,
      teams: [],
      error: errorMessage
    };
  }
  app.log.info(
    {
      broadcasterId,
      count: teams.length,
      fallbackShown: teams.length === 0,
      payload: { broadcasterId, teams }
    },
    "Returning Twitch team memberships"
  );
  return { broadcasterId, teams };
});

app.get("/api/onboarding/:broadcasterId", async (request, reply) => {
  const { broadcasterId } = request.params as { broadcasterId: string };
  const profile = store.getProfile(broadcasterId);

  if (!profile) {
    return reply.code(404).send({ exists: false });
  }

  return {
    exists: true,
    profile,
    settings: store.getSettings(broadcasterId),
    members: store.getMembers(broadcasterId)
  };
});

app.post("/api/onboarding/register", async (request, reply) => {
  const parsed = onboardingSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.flatten() });
  }

  const payload: BroadcasterOnboardingRequest = parsed.data;
  const registration = store.registerBroadcaster(payload);
  return reply.code(201).send(registration);
});

app.get("/api/settings/:broadcasterId", async (request, reply) => {
  const { broadcasterId } = request.params as { broadcasterId: string };
  if (!store.hasBroadcaster(broadcasterId)) {
    return reply.code(404).send({ error: "Broadcaster is not onboarded" });
  }
  const settings = store.getSettings(broadcasterId);
  return settings;
});

app.put("/api/settings/:broadcasterId", async (request, reply) => {
  const { broadcasterId } = request.params as { broadcasterId: string };
  const parsed = settingsSchema.safeParse({
    ...(request.body as object),
    broadcasterId
  });

  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.flatten() });
  }

  store.upsertSettings(parsed.data as BroadcasterSettings);
  return parsed.data;
});

app.post("/api/spotlight/manual", async (request, reply) => {
  const parsed = manualTriggerSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.flatten() });
  }

  if (!store.hasBroadcaster(parsed.data.broadcasterId)) {
    return reply.code(404).send({ error: "Broadcaster is not onboarded" });
  }

  const settings = store.getSettings(parsed.data.broadcasterId);
  if (!settings.enableManualTrigger) {
    return reply.code(403).send({ error: "Manual trigger disabled" });
  }

  const card = spotlightService.createSpotlight(
    parsed.data.broadcasterId,
    parsed.data.creatorUserId,
    "manual"
  );

  if (!card) {
    return reply.code(404).send({ error: "Creator not found" });
  }

  broker.publish(parsed.data.broadcasterId, card);
  return card;
});

app.post("/webhooks/eventsub/shoutout", async (request, reply) => {
  const parsed = shoutoutSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.flatten() });
  }

  if (!store.hasBroadcaster(parsed.data.broadcasterId)) {
    return reply.code(404).send({ error: "Broadcaster is not onboarded" });
  }

  const settings = store.getSettings(parsed.data.broadcasterId);
  if (!settings.enableShoutoutTrigger) {
    return reply.code(202).send({ accepted: false, reason: "Shoutout trigger disabled" });
  }

  const card = spotlightService.createSpotlight(
    parsed.data.broadcasterId,
    parsed.data.creatorUserId,
    "shoutout"
  );

  if (!card) {
    return reply.code(404).send({ error: "Creator not found" });
  }

  broker.publish(parsed.data.broadcasterId, card);
  return reply.code(202).send({ accepted: true, eventId: card.eventId });
});

app.get("/api/overlay/stream/:broadcasterId", async (request, reply) => {
  const { broadcasterId } = request.params as { broadcasterId: string };

  reply.raw.setHeader("Content-Type", "text/event-stream");
  reply.raw.setHeader("Cache-Control", "no-cache");
  reply.raw.setHeader("Connection", "keep-alive");
  reply.raw.flushHeaders();

  const unsubscribe = broker.subscribe(broadcasterId, (event) => {
    reply.raw.write(`data: ${JSON.stringify(event)}\\n\\n`);
  });

  const keepAlive = setInterval(() => {
    reply.raw.write("event: ping\\ndata: {}\\n\\n");
  }, 15000);

  request.raw.on("close", () => {
    clearInterval(keepAlive);
    unsubscribe();
  });

  return reply;
});

const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: "0.0.0.0" });
app.log.info(`Backend running on :${port}`);
