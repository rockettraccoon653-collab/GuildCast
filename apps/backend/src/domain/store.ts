import type {
  BroadcasterOnboardingRequest,
  BroadcasterOnboardingResponse,
  BroadcasterProfile,
  BroadcasterSettings,
  TeamBadge,
  TeamMemberView
} from "@stream-team/shared";

const defaultTeams: TeamBadge[] = [
  { id: "alpha", name: "Alpha Squad" },
  { id: "night-ops", name: "Night Ops" }
];

const defaultMembers: TeamMemberView[] = [
  {
    userId: "1001",
    displayName: "PixelKnight",
    avatarUrl: "https://static-cdn.jtvnw.net/jtv_user_pictures/xarth/404_user_70x70.png",
    live: true,
    category: "VALORANT",
    bio: "Aim-heavy duelist and team caller.",
    teams: defaultTeams
  },
  {
    userId: "1002",
    displayName: "ArcMage",
    avatarUrl: "https://static-cdn.jtvnw.net/jtv_user_pictures/xarth/404_user_70x70.png",
    live: false,
    bio: "Cozy caster and lore crafter.",
    teams: [{ id: "alpha", name: "Alpha Squad" }]
  }
];

const defaultSettings: BroadcasterSettings = {
  broadcasterId: "demo-broadcaster",
  enableManualTrigger: true,
  enableShoutoutTrigger: true,
  showAllTeams: true,
  followCtaEnabled: true,
  theme: {
    id: "neon-arena",
    name: "Neon Arena",
    primary: "#15f5ba",
    accent: "#ff4d8d",
    glow: "#00d9ff",
    motionPreset: "arc",
    displayDurationMs: 8000
  }
};

const defaultProfile: BroadcasterProfile = {
  broadcasterId: "demo-broadcaster",
  displayName: "Demo Broadcaster",
  primaryTeamName: "Alpha Squad",
  createdAt: new Date().toISOString()
};

function normalizeId(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

function generateStarterMembers(displayName: string, primaryTeamName: string): TeamMemberView[] {
  const teamId = normalizeId(primaryTeamName) || "main-team";
  const coreTeam: TeamBadge = { id: teamId, name: primaryTeamName };

  return [
    {
      userId: "host",
      displayName,
      avatarUrl: "https://static-cdn.jtvnw.net/jtv_user_pictures/xarth/404_user_70x70.png",
      live: true,
      category: "Just Chatting",
      bio: `Host of ${primaryTeamName}.`,
      teams: [coreTeam]
    },
    {
      userId: "teammate-1",
      displayName: `${displayName} Ally`,
      avatarUrl: "https://static-cdn.jtvnw.net/jtv_user_pictures/xarth/404_user_70x70.png",
      live: false,
      bio: "Support creator focused on collab nights.",
      teams: [coreTeam]
    },
    {
      userId: "teammate-2",
      displayName: `${displayName} Raider`,
      avatarUrl: "https://static-cdn.jtvnw.net/jtv_user_pictures/xarth/404_user_70x70.png",
      live: true,
      category: "Apex Legends",
      bio: "Competitive squad partner and raid anchor.",
      teams: [coreTeam, { id: "shared-creators", name: "Shared Creators" }]
    }
  ];
}

export class InMemoryStore {
  private readonly profilesByBroadcaster = new Map<string, BroadcasterProfile>([
    ["demo-broadcaster", defaultProfile]
  ]);

  private readonly membersByBroadcaster = new Map<string, TeamMemberView[]>([
    ["demo-broadcaster", defaultMembers]
  ]);

  private readonly settingsByBroadcaster = new Map<string, BroadcasterSettings>([
    ["demo-broadcaster", defaultSettings]
  ]);

  hasBroadcaster(broadcasterId: string): boolean {
    return this.profilesByBroadcaster.has(broadcasterId);
  }

  getProfile(broadcasterId: string): BroadcasterProfile | null {
    return this.profilesByBroadcaster.get(broadcasterId) ?? null;
  }

  registerBroadcaster(request: BroadcasterOnboardingRequest): BroadcasterOnboardingResponse {
    const broadcasterId = normalizeId(request.broadcasterId);
    const existingProfile = this.profilesByBroadcaster.get(broadcasterId);
    if (existingProfile) {
      return {
        profile: existingProfile,
        settings: this.getSettings(broadcasterId),
        members: this.getMembers(broadcasterId)
      };
    }

    const profile: BroadcasterProfile = {
      broadcasterId,
      displayName: request.displayName.trim(),
      primaryTeamName: request.primaryTeamName.trim(),
      createdAt: new Date().toISOString()
    };

    const settings: BroadcasterSettings = {
      ...defaultSettings,
      broadcasterId,
      theme: {
        ...defaultSettings.theme
      }
    };

    const members = generateStarterMembers(profile.displayName, profile.primaryTeamName);

    this.profilesByBroadcaster.set(broadcasterId, profile);
    this.settingsByBroadcaster.set(broadcasterId, settings);
    this.membersByBroadcaster.set(broadcasterId, members);

    return { profile, settings, members };
  }

  getMembers(broadcasterId: string): TeamMemberView[] {
    return this.membersByBroadcaster.get(broadcasterId) ?? [];
  }

  upsertMembers(broadcasterId: string, members: TeamMemberView[]): void {
    this.membersByBroadcaster.set(broadcasterId, members);
  }

  getSettings(broadcasterId: string): BroadcasterSettings {
    return this.settingsByBroadcaster.get(broadcasterId) ?? {
      ...defaultSettings,
      broadcasterId
    };
  }

  upsertSettings(settings: BroadcasterSettings): void {
    this.settingsByBroadcaster.set(settings.broadcasterId, settings);
  }
}
