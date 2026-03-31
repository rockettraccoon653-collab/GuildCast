import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import type { BroadcasterOnboardingRequest, BroadcasterSettings } from "@stream-team/shared";
import { InMemoryStore } from "./domain/store";
import { SpotlightService } from "./domain/spotlight";
import { RealtimeBroker } from "./realtime/broker";
import { buildCustomPrimaryTeam, TwitchTeamsService } from "./domain/twitchTeams";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

const store = new InMemoryStore();
const spotlightService = new SpotlightService(store);
const broker = new RealtimeBroker();
const twitchTeamsService = new TwitchTeamsService(app.log);

const settingsSchema = z.object({
  broadcasterId: z.string().min(1),
  enableManualTrigger: z.boolean(),
  enableShoutoutTrigger: z.boolean(),
  showAllTeams: z.boolean(),
  followCtaEnabled: z.boolean(),
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
  displayName: z.string().min(2),
  primaryTeamName: z.string().min(2)
});

app.get("/health", async () => ({ ok: true, service: "stream-team-backend" }));

app.get("/api/panel/:broadcasterId/members", async (request) => {
  const { broadcasterId } = request.params as { broadcasterId: string };
  if (!store.hasBroadcaster(broadcasterId)) {
    app.log.info({ broadcasterId }, "Panel members requested for non-onboarded broadcaster");
    return { broadcasterId, members: [], teams: [], onboarded: false };
  }

  const members = store.getMembers(broadcasterId);
  const profile = store.getProfile(broadcasterId);
  const customTeams = buildCustomPrimaryTeam(broadcasterId, profile?.primaryTeamName);
  const mergedTeams = await twitchTeamsService.getMergedTeams(broadcasterId, customTeams);

  const membersWithResolvedTeams = members.map((member) => ({
    ...member,
    teams: mergedTeams
  }));

  return { broadcasterId, members: membersWithResolvedTeams, teams: mergedTeams, onboarded: true };
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
