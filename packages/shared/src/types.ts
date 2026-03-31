export type TriggerSource = "manual" | "shoutout" | "presence";

export interface TeamBadge {
  id: string;
  name: string;
  thumbnailUrl?: string;
  ownerId?: string;
  isOwner?: boolean;
  source?: "twitch" | "custom";
}

export interface CreatorProfile {
  twitchUserId: string;
  displayName: string;
  login: string;
  avatarUrl?: string;
  live: boolean;
  currentCategory?: string;
  bio?: string;
}

export interface SpotlightCardData {
  eventId: string;
  broadcasterId: string;
  source: TriggerSource;
  creator: CreatorProfile;
  sharedTeams: TeamBadge[];
  followCtaEnabled: boolean;
  createdAt: string;
}

export interface ThemeSettings {
  id: string;
  name: string;
  primary: string;
  accent: string;
  glow: string;
  motionPreset: "arc" | "pulse" | "warp";
  displayDurationMs: number;
}

export interface BroadcasterSettings {
  broadcasterId: string;
  enableManualTrigger: boolean;
  enableShoutoutTrigger: boolean;
  showAllTeams: boolean;
  followCtaEnabled: boolean;
  theme: ThemeSettings;
}

export interface BroadcasterProfile {
  broadcasterId: string;
  displayName: string;
  primaryTeamName: string;
  createdAt: string;
}

export interface BroadcasterOnboardingRequest {
  broadcasterId: string;
  displayName: string;
  primaryTeamName: string;
}

export interface BroadcasterOnboardingResponse {
  profile: BroadcasterProfile;
  settings: BroadcasterSettings;
  members: TeamMemberView[];
}

export interface TeamMemberView {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  live: boolean;
  category?: string;
  bio?: string;
  teams: TeamBadge[];
}
