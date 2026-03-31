export type TriggerSource = "manual" | "shoutout" | "presence";
export interface TeamBadge {
    id: string;
    name: string;
    thumbnailUrl?: string;
    ownerId?: string;
    isOwner?: boolean;
    source?: "twitch-verified";
}
export interface TwitchTeamView {
    id: string;
    name: string;
    displayName: string;
    thumbnailUrl?: string;
    backgroundImageUrl?: string;
    info?: string;
    source: "twitch-verified";
    role: "owner" | "member" | "member-or-owner-unknown";
    ownerId?: string;
    members?: Array<{
        userId: string;
        login: string;
        displayName: string;
    }>;
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
    createdAt: string;
}
export interface BroadcasterOnboardingRequest {
    broadcasterId: string;
    displayName: string;
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
export interface PanelMembersResponse {
    broadcasterId: string;
    members: TeamMemberView[];
    teams: TeamBadge[];
    twitchTeams: TwitchTeamView[];
    onboarded: boolean;
}
