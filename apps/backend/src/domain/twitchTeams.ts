import type { FastifyBaseLogger } from "fastify";
import type { TwitchTeamView } from "@stream-team/shared";

type HelixChannelTeam = {
  id: string;
  team_name: string;
  team_display_name: string;
  thumbnail_url?: string | null;
  background_image_url?: string | null;
  info?: string | null;
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
  team_name?: string;
  team_display_name?: string;
  thumbnail_url?: string | null;
  background_image_url?: string | null;
  info?: string | null;
  users?: HelixTeamUser[];
};

type HelixTeamResponse = {
  data?: HelixTeamRecord[];
};

type HelixUserRecord = {
  id: string;
  login: string;
  display_name: string;
};

type HelixUsersResponse = {
  data?: HelixUserRecord[];
};

type HelixUsersByIdRecord = {
  id: string;
  login: string;
  display_name: string;
  profile_image_url?: string;
  description?: string;
};

type HelixUsersByIdResponse = {
  data?: HelixUsersByIdRecord[];
};

type HelixStreamRecord = {
  user_id: string;
  game_name?: string;
};

type HelixStreamsResponse = {
  data?: HelixStreamRecord[];
};

type TwitchAppTokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
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
  private readonly clientSecret = process.env.TWITCH_CLIENT_SECRET?.trim() ?? "";
  private readonly appAccessToken = process.env.TWITCH_APP_ACCESS_TOKEN?.trim() ?? "";
  private readonly managedTeamIds = parseCsvList(process.env.TWITCH_TEAM_MANAGED_IDS);
  private readonly managedTeamNames = parseCsvList(process.env.TWITCH_TEAM_MANAGED_NAMES);
  private currentAppToken = this.appAccessToken;
  private currentAppTokenExpiresAt = 0;

  constructor(private readonly logger: FastifyBaseLogger) {}

  async getMemberProfiles(userIds: string[]): Promise<
    Map<
      string,
      {
        displayName?: string;
        avatarUrl?: string;
        bio?: string;
        live: boolean;
        category?: string;
      }
    >
  > {
    const uniqueUserIds = Array.from(
      new Set(
        userIds
          .map((value) => value.trim())
          .filter((value) => /^\d+$/.test(value))
      )
    );

    const byUserId = new Map<
      string,
      {
        displayName?: string;
        avatarUrl?: string;
        bio?: string;
        live: boolean;
        category?: string;
      }
    >();

    if (uniqueUserIds.length === 0) {
      return byUserId;
    }

    for (const batch of this.chunk(uniqueUserIds, 100)) {
      const usersPath = `/users?${batch.map((id) => `id=${encodeURIComponent(id)}`).join("&")}`;
      const usersResponse = await this.helixGet<HelixUsersByIdResponse>(usersPath);
      for (const user of usersResponse.data ?? []) {
        byUserId.set(user.id, {
          displayName: user.display_name || user.login,
          avatarUrl: user.profile_image_url,
          bio: user.description,
          live: false
        });
      }

      const streamsPath = `/streams?${batch.map((id) => `user_id=${encodeURIComponent(id)}`).join("&")}`;
      const streamsResponse = await this.helixGet<HelixStreamsResponse>(streamsPath);
      for (const stream of streamsResponse.data ?? []) {
        const existing = byUserId.get(stream.user_id) ?? { live: false };
        byUserId.set(stream.user_id, {
          ...existing,
          live: true,
          category: stream.game_name
        });
      }
    }

    this.logger.info(
      {
        requestedMembers: uniqueUserIds.length,
        enrichedMembers: byUserId.size,
        liveMembers: Array.from(byUserId.values()).filter((member) => member.live).length
      },
      "Resolved Twitch member profile enrichment"
    );

    return byUserId;
  }

  async getTwitchTeams(broadcasterId: string): Promise<TwitchTeamView[]> {
    const teams = await this.fetchTwitchTeams(broadcasterId);
    this.logger.info(
      {
        broadcasterId,
        teamsReturned: teams.length,
        teams: teams.map((team) => ({
          id: team.id,
          displayName: team.displayName,
          source: team.source,
          role: team.role
        }))
      },
      "Backend JSON returned for Twitch teams"
    );
    return teams;
  }

  private async fetchTwitchTeams(broadcasterId: string): Promise<TwitchTeamView[]> {
    if (!this.clientId || (!this.currentAppToken && !this.clientSecret)) {
      const message = "TWITCH credentials are incomplete; set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET or TWITCH_APP_ACCESS_TOKEN";
      this.logger.warn(
        {
          broadcasterId,
          hasClientId: Boolean(this.clientId),
          hasToken: Boolean(this.currentAppToken),
          hasClientSecret: Boolean(this.clientSecret)
        },
        message
      );
      throw new Error(message);
    }

    try {
      const verifiedBroadcasterId = await this.resolveBroadcasterId(broadcasterId);
      if (!verifiedBroadcasterId) {
        this.logger.warn(
          {
            broadcasterId,
            reason: "Could not resolve broadcaster to a Twitch user id"
          },
          "Skipping Twitch teams fetch"
        );
        return [];
      }

      const membershipPath = `/teams/channel?broadcaster_id=${encodeURIComponent(verifiedBroadcasterId)}`;
      this.logger.info(
        {
          broadcasterId,
          verifiedBroadcasterId,
          requestUrl: `https://api.twitch.tv/helix${membershipPath}`
        },
        "Requesting Twitch team memberships"
      );

      const channelTeams = await this.helixGet<HelixChannelTeamsResponse>(membershipPath);

      const memberships = channelTeams.data ?? [];
      this.logger.info(
        {
          broadcasterId,
          rawTwitchResponse: memberships,
          teamsReturned: memberships.length
        },
        "Fetched Twitch channel team memberships"
      );

      const teams: TwitchTeamView[] = [];
      for (const membership of memberships) {
        const detailPath = `/teams?id=${encodeURIComponent(membership.id)}`;
        const detail = await this.helixGet<HelixTeamResponse>(detailPath);
        const record = detail.data?.[0];
        const ownerId = record?.users?.[0]?.user_id;
        const users = record?.users ?? [];
        const isOwnerByList = ownerId === verifiedBroadcasterId;
        const isMemberByList = users.some((user) => user.user_id === verifiedBroadcasterId);
        const isManagedOverride =
          this.managedTeamIds.has(membership.id.toLowerCase()) ||
          this.managedTeamNames.has(membership.team_name.toLowerCase());

        const role: TwitchTeamView["role"] = isManagedOverride || isOwnerByList
          ? "owner"
          : isMemberByList
            ? "member"
            : "member-or-owner-unknown";

        teams.push({
          id: membership.id,
          name: membership.team_name,
          displayName: membership.team_display_name || membership.team_name,
          thumbnailUrl: record?.thumbnail_url ?? membership.thumbnail_url ?? undefined,
          backgroundImageUrl:
            record?.background_image_url ?? membership.background_image_url ?? undefined,
          info: record?.info ?? membership.info ?? undefined,
          source: "twitch-verified",
          role,
          ownerId,
          members: users.map((user) => ({
            userId: user.user_id,
            login: user.user_login,
            displayName: user.user_name
          }))
        });
      }

      this.logger.info(
        {
          broadcasterId,
          teamsReturned: teams.length,
          roles: teams.map((team) => team.role)
        },
        "Normalized Twitch teams response"
      );

      return teams;
    } catch (error) {
      this.logger.error(
        {
          broadcasterId,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined
        },
        "Failed to fetch Twitch team memberships"
      );
      throw error;
    }
  }

  private async resolveBroadcasterId(input: string): Promise<string> {
    const normalized = input.trim();
    if (!normalized) {
      return "";
    }

    if (/^\d+$/.test(normalized)) {
      return normalized;
    }

    const usersPath = `/users?login=${encodeURIComponent(normalized.toLowerCase())}`;
    this.logger.info(
      {
        input,
        requestUrl: `https://api.twitch.tv/helix${usersPath}`
      },
      "Resolving broadcaster login to Twitch user id"
    );

    const usersResponse = await this.helixGet<HelixUsersResponse>(usersPath);
    const user = usersResponse.data?.[0];
    this.logger.info(
      {
        input,
        resolvedBroadcasterId: user?.id ?? null,
        rawUsersResponse: usersResponse.data ?? []
      },
      "Resolved broadcaster identity"
    );

    return user?.id ?? "";
  }

  private async helixGet<T>(path: string): Promise<T> {
    let accessToken = await this.resolveAppAccessToken();
    let response = await fetch(`https://api.twitch.tv/helix${path}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-Id": this.clientId
      }
    });

    if (response.status === 401 && this.clientSecret) {
      accessToken = await this.refreshAppAccessToken();
      response = await fetch(`https://api.twitch.tv/helix${path}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Client-Id": this.clientId
        }
      });
    }

    const rawBody = await response.text();
    this.logger.info(
      {
        requestUrl: `https://api.twitch.tv/helix${path}`,
        responseStatus: response.status,
        rawBodyPreview: rawBody.slice(0, 2000)
      },
      "Twitch Helix raw response"
    );

    if (!response.ok) {
      throw new Error(`Helix ${path} failed with ${response.status}: ${rawBody.slice(0, 400)}`);
    }

    return JSON.parse(rawBody) as T;
  }

  private async resolveAppAccessToken(): Promise<string> {
    if (this.currentAppToken && Date.now() + 30_000 < this.currentAppTokenExpiresAt) {
      return this.currentAppToken;
    }

    if (this.currentAppToken && !this.clientSecret) {
      return this.currentAppToken;
    }

    if (!this.currentAppToken && this.clientSecret) {
      return this.refreshAppAccessToken();
    }

    if (!this.currentAppToken) {
      throw new Error("Missing TWITCH_APP_ACCESS_TOKEN and TWITCH_CLIENT_SECRET for token refresh");
    }

    return this.currentAppToken;
  }

  private async refreshAppAccessToken(): Promise<string> {
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "client_credentials"
    });

    const response = await fetch(`https://id.twitch.tv/oauth2/token?${params.toString()}`, {
      method: "POST"
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Twitch token refresh failed with ${response.status}: ${body.slice(0, 400)}`);
    }

    const payload = (await response.json()) as TwitchAppTokenResponse;
    this.currentAppToken = payload.access_token;
    this.currentAppTokenExpiresAt = Date.now() + Math.max(0, payload.expires_in - 60) * 1000;
    this.logger.info({ expiresInSeconds: payload.expires_in }, "Refreshed Twitch app access token");

    return this.currentAppToken;
  }

  private chunk<T>(input: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let index = 0; index < input.length; index += size) {
      result.push(input.slice(index, index + size));
    }
    return result;
  }
}
