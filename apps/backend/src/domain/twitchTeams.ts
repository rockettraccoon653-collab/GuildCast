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

  async getTwitchTeams(broadcasterId: string): Promise<TwitchTeamView[]> {
    return this.fetchTwitchTeams(broadcasterId);
  }

  private async fetchTwitchTeams(broadcasterId: string): Promise<TwitchTeamView[]> {
    if (!this.clientId || (!this.currentAppToken && !this.clientSecret)) {
      this.logger.warn(
        {
          broadcasterId,
          hasClientId: Boolean(this.clientId),
          hasToken: Boolean(this.currentAppToken),
          hasClientSecret: Boolean(this.clientSecret)
        },
        "Skipping Twitch teams fetch because TWITCH credentials are incomplete"
      );
      return [];
    }

    try {
      const membershipPath = `/teams/channel?broadcaster_id=${encodeURIComponent(broadcasterId)}`;
      this.logger.info(
        {
          broadcasterId,
          requestUrl: `https://api.twitch.tv/helix${membershipPath}`
        },
        "Requesting Twitch team memberships"
      );

      const channelTeams = await this.helixGet<HelixChannelTeamsResponse>(membershipPath);

      const memberships = channelTeams.data ?? [];
      this.logger.info(
        {
          broadcasterId,
          responseStatus: 200,
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
        const isOwnerByList = ownerId === broadcasterId;
        const isMemberByList = users.some((user) => user.user_id === broadcasterId);
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
      this.logger.error({ broadcasterId, error }, "Failed to fetch Twitch team memberships");
      return [];
    }
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

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Helix ${path} failed with ${response.status}: ${body.slice(0, 400)}`);
    }

    return (await response.json()) as T;
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
}
