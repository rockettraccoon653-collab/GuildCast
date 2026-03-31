import type {
  BroadcasterOnboardingRequest,
  BroadcasterOnboardingResponse,
  BroadcasterProfile,
  BroadcasterSettings,
  TeamMemberView
} from "@stream-team/shared";

const defaultMembers: TeamMemberView[] = [
  {
    userId: "1001",
    displayName: "PixelKnight",
    avatarUrl: "https://static-cdn.jtvnw.net/jtv_user_pictures/xarth/404_user_70x70.png",
    live: true,
    category: "VALORANT",
    bio: "Aim-heavy duelist and team caller.",
    teams: []
  },
  {
    userId: "1002",
    displayName: "ArcMage",
    avatarUrl: "https://static-cdn.jtvnw.net/jtv_user_pictures/xarth/404_user_70x70.png",
    live: false,
    bio: "Cozy caster and lore crafter.",
    teams: []
  }
];

const defaultSettings: BroadcasterSettings = {
  broadcasterId: "demo-broadcaster",
  enableManualTrigger: true,
  enableShoutoutTrigger: true,
  showAllTeams: true,
  hiddenTeamIds: [],
  followCtaEnabled: true,
  panel: {
    panelTitle: "Spotlight Network",
    showSearch: true,
    showTeamChips: true,
    showMemberCards: true,
    showLiveStatus: true,
    emptyStateText: "No verified Twitch stream teams found for this broadcaster.",
    searchPlaceholder: "Search verified Twitch teammates",
    style: {
      pageBackground: "#071018",
      panelBackground: "rgba(15, 30, 44, 0.85)",
      panelHeightPx: 500,
      primaryColor: "#4effd6",
      accentColor: "#ff4d8d",
      textColor: "#e9f8ff",
      mutedTextColor: "#8fb2c2",
      fontFamily: "Space Grotesk, sans-serif",
      fontSizePx: 14,
      fontWeight: 500,
      letterSpacingPx: 0,
      cardPaddingPx: 14,
      sectionGapPx: 16,
      borderRadiusPx: 12
    }
  },
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
  createdAt: new Date().toISOString()
};

function normalizeId(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

function generateStarterMember(displayName: string): TeamMemberView {
  return {
    userId: normalizeId(displayName) || "host",
    displayName,
    avatarUrl: "https://static-cdn.jtvnw.net/jtv_user_pictures/xarth/404_user_70x70.png",
    live: false,
    bio: "",
    teams: []
  };
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
      createdAt: new Date().toISOString()
    };

    const settings: BroadcasterSettings = {
      ...defaultSettings,
      broadcasterId,
      hiddenTeamIds: [],
      panel: {
        ...defaultSettings.panel,
        style: {
          ...defaultSettings.panel.style
        }
      },
      theme: {
        ...defaultSettings.theme
      }
    };

    const members = [generateStarterMember(profile.displayName)];

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
    const existing = this.settingsByBroadcaster.get(broadcasterId);
    if (existing) {
      return {
        ...existing,
        hiddenTeamIds: existing.hiddenTeamIds ?? [],
        panel: {
          ...defaultSettings.panel,
          ...(existing.panel ?? {}),
          style: {
            ...defaultSettings.panel.style,
            ...(existing.panel?.style ?? {})
          }
        }
      };
    }

    return {
      ...defaultSettings,
      broadcasterId,
      panel: {
        ...defaultSettings.panel,
        style: {
          ...defaultSettings.panel.style
        }
      }
    };
  }

  upsertSettings(settings: BroadcasterSettings): void {
    this.settingsByBroadcaster.set(settings.broadcasterId, settings);
  }
}
