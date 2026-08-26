import "server-only";

import { isAdmin, isSupervisor, type SessionUserLike } from "@/lib/permissions";
import {
  getTeamForUser,
  listTeamMemberEmails,
  listTeamsForSupervisor,
} from "@/lib/timeClockTeamsDb";

export type CallQaScope = {
  isAdmin: boolean;
  canViewTeam: boolean;
  /** Admin, Supervisor role, or assigned supervisor of a team. */
  isManager: boolean;
  /** null = all agents */
  agentEmails: string[] | null;
};

export async function resolveCallQaScope(
  user: SessionUserLike | null | undefined
): Promise<CallQaScope> {
  const email = (user?.email || "").toLowerCase();
  if (!email) {
    return {
      isAdmin: false,
      canViewTeam: false,
      isManager: false,
      agentEmails: [],
    };
  }
  if (isAdmin(user)) {
    return {
      isAdmin: true,
      canViewTeam: true,
      isManager: true,
      agentEmails: null,
    };
  }

  const teamIds = new Set<string>();
  try {
    for (const team of await listTeamsForSupervisor(email)) {
      teamIds.add(team.id);
    }
  } catch {
    // Teams table is postgres-only; Call QA still works without it.
  }
  if (isSupervisor(user)) {
    try {
      const own = await getTeamForUser(email);
      if (own) teamIds.add(own.id);
    } catch {
      // Ignore if this user has no team row.
    }
  }

  let memberEmails: string[] = [];
  if (teamIds.size) {
    try {
      memberEmails = await listTeamMemberEmails([...teamIds]);
    } catch {
      memberEmails = [];
    }
  }
  const agentEmails = Array.from(
    new Set([email, ...memberEmails.map((value) => value.toLowerCase())])
  );
  const canViewTeam = teamIds.size > 0;
  return {
    isAdmin: false,
    canViewTeam,
    isManager: canViewTeam || isSupervisor(user),
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
