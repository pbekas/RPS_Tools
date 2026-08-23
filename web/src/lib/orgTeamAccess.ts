import "server-only";

import { isAdmin, type SessionUserLike } from "@/lib/permissions";
import {
  listTeamMemberEmails,
  listTeamsForSupervisor,
} from "@/lib/timeClockTeamsDb";

export type CallQaScope = {
  isAdmin: boolean;
  canViewTeam: boolean;
  /** null = all agents */
  agentEmails: string[] | null;
};

export async function resolveCallQaScope(
  user: SessionUserLike | null | undefined
): Promise<CallQaScope> {
  const email = (user?.email || "").toLowerCase();
  if (!email) {
    return { isAdmin: false, canViewTeam: false, agentEmails: [] };
  }
  if (isAdmin(user)) {
    return { isAdmin: true, canViewTeam: true, agentEmails: null };
  }

  let memberEmails: string[] = [];
  try {
    const teams = await listTeamsForSupervisor(email);
    if (teams.length) {
      memberEmails = await listTeamMemberEmails(teams.map((team) => team.id));
    }
  } catch {
    memberEmails = [];
  }

  const agentEmails = Array.from(
    new Set([email, ...memberEmails.map((value) => value.toLowerCase())])
  );
  return {
    isAdmin: false,
    canViewTeam: memberEmails.length > 0,
    agentEmails,
  };
}

export function canViewCallAgent(
  scope: CallQaScope,
  agentEmail: string | null | undefined
): boolean {
  if (scope.agentEmails === null) return true;
  return scope.agentEmails.includes((agentEmail || "").toLowerCase());
}
