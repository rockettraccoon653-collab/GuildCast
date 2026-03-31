import type { FastifyBaseLogger } from "fastify";
import type { TeamBadge } from "@stream-team/shared";

type HelixChannelTeam = {
  id: string;
  team_name: string;
  team_display_name: string;
  thumbnail_url?: string | null;
};

type HelixChannelTeamsResponse = {
  data?: HelixChannelTeam[];
};

type HelixTeamUser = {
  user_id: string;
  user_login: string;
  user_name: string;
};

type HelixTeamRecord = {
  id: string;
  users?: HelixTeamUser[];
};

type HelixTeamResponse = {
  data?: HelixTeamRecord[];
};

function normalizeTeamId(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

function parseCsvList(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
}

export class TwitchTeamsService {
  private readonly clientId = process.env.TWITCH_CLIENT_ID?.trim() ?? "";
  private readonly appAccessToken = process.env.TWITCH_APP_ACCESS_TOKEN?.trim() ?? "";
  private readonly managedTeamIds = parseCsvList(process.env.TWITCH_TEAM_MANAGED_IDS);
  private readonly managedTeamNames = parseCsvList(process.env.TWITCH_TEAM_MANAGED_NAMES);

  constructor(private readonly logger: FastifyBaseLogger) {}

  async getMergedTeams(broadcasterId: string, customTeams: TeamBadge[]): Promise<TeamBadge[]> {
    const twitchTeams = await this.fetchTwitchTeams(broadcasterId);
    const merged = new Map<string, TeamBadge>();

    for (const team of twitchTeams) {
      merged.set(team.id, team);
    }

    for (const team of customTeams) {
      if (!merged.has(team.id)) {
        merged.set(team.id, team);
      }
    }

    const teams = [...merged.values()];
    this.logger.info(
      {
        broadcasterId,
        twitchCount: twitchTeams.length,
        customCount: customTeams.length,
        mergedCount: teams.length,
        dataSources: teams.map((team) => team.source ?? "unknown")
      },
      "Resolved broadcaster team memberships"
    );

    return teams;
  }

  private async fetchTwitchTeams(broadcasterId: string): Promise<TeamBadge[]> {
    if (!this.clientId || !this.appAccessToken) {
      this.logger.warn(
        { broadcasterId, hasClientId: Boolean(this.clientId), hasToken: Boolean(this.appAccessToken) },
        "Skipping Twitch teams fetch because TWITCH_CLIENT_ID or TWITCH_APP_ACCESS_TOKEN is missing"
      );
      return [];
    }

    try {
      const channelTeams = await this.helixGet<HelixChannelTeamsResponse>(
        `/teams/channel?broadcaster_id=${encodeURIComponent(broadcasterId)}`
      );

      const memberships = channelTeams.data ?? [];
      this.logger.info(
        { broadcasterId, memberships: memberships.map((team) => ({ id: team.id, name: team.team_display_name })) },
        "Fetched Twitch channel team memberships"
      );

      const teams: TeamBadge[] = [];
      for (const membership of memberships) {
        const detail = await this.helixGet<HelixTeamResponse>(
          `/teams?id=${encodeURIComponent(membership.id)}`
        );
        const record = detail.data?.[0];
        const ownerId = record?.users?.[0]?.user_id;
        const isOwnerByList = ownerId === broadcasterId;
        const isManagedOverride =
          this.managedTeamIds.has(membership.id.toLowerCase()) ||
          this.managedTeamNames.has(membership.team_name.toLowerCase());

        teams.push({
          id: membership.id,
          name: membership.team_display_name || membership.team_name,
          thumbnailUrl: membership.thumbnail_url ?? undefined,
          ownerId,
          isOwner: isOwnerByList || isManagedOverride,
          source: "twitch"
        });
      }

      return teams;
    } catch (error) {
      this.logger.error({ broadcasterId, error }, "Failed to fetch Twitch team memberships");
      return [];
    }
  }

  private async helixGet<T>(path: string): Promise<T> {
    const response = await fetch(`https://api.twitch.tv/helix${path}`, {
      headers: {
        Authorization: `Bearer ${this.appAccessToken}`,
        "Client-Id": this.clientId
      }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Helix ${path} failed with ${response.status}: ${body.slice(0, 400)}`);
    }

    return (await response.json()) as T;
  }
}

export function buildCustomPrimaryTeam(broadcasterId: string, teamName: string | undefined): TeamBadge[] {
  const normalizedName = (teamName ?? "").trim();
  if (!normalizedName) {
    return [];
  }

  return [
    {
      id: `custom-${normalizeTeamId(normalizedName)}`,
      name: normalizedName,
      ownerId: broadcasterId,
      isOwner: true,
      source: "custom"
    }
  ];
}
