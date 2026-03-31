import type { SpotlightCardData, TriggerSource } from "@stream-team/shared";
import { randomUUID } from "node:crypto";
import { InMemoryStore } from "./store";
import { sharedTeamsForCreator } from "./teamResolver";

export class SpotlightService {
  constructor(private readonly store: InMemoryStore) {}

  createSpotlight(
    broadcasterId: string,
    creatorUserId: string,
    source: TriggerSource
  ): SpotlightCardData | null {
    const members = this.store.getMembers(broadcasterId);
    const target = members.find((member) => member.userId === creatorUserId);

    if (!target) {
      return null;
    }

    const settings = this.store.getSettings(broadcasterId);
    const sharedTeams = sharedTeamsForCreator(members, creatorUserId);

    return {
      eventId: randomUUID(),
      broadcasterId,
      source,
      creator: {
        twitchUserId: target.userId,
        displayName: target.displayName,
        login: target.displayName.toLowerCase().replace(/\s+/g, "_"),
        avatarUrl: target.avatarUrl,
        live: target.live,
        currentCategory: target.category,
        bio: target.bio
      },
      sharedTeams,
      followCtaEnabled: settings.followCtaEnabled,
      createdAt: new Date().toISOString()
    };
  }
}
