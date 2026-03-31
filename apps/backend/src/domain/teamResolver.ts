import type { TeamBadge, TeamMemberView } from "@stream-team/shared";

export function sharedTeamsForCreator(
  broadcasterMembers: TeamMemberView[],
  creatorUserId: string
): TeamBadge[] {
  const broadcasterTeams = new Set<string>();
  for (const member of broadcasterMembers) {
    for (const team of member.teams) {
      broadcasterTeams.add(team.id);
    }
  }

  const target = broadcasterMembers.find((m) => m.userId === creatorUserId);
  if (!target) {
    return [];
  }

  return target.teams.filter((team) => broadcasterTeams.has(team.id));
}
