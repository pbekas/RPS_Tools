import "server-only";

import { isAdmin, isSupervisor, type SessionUserLike } from "@/lib/permissions";
import {
  listTeamMemberEmails,
  listTeamsForSupervisor,
  listTimeClockTeams,
  listVisibleTimeClockUserEmails,
} from "@/lib/timeClockTeamsDb";
import type { TimeClockTeam } from "@/lib/timeClockTypes";

export type TimeClockAccess = {
  isAdmin: boolean;
  isSupervisorRole: boolean;
  isTeamSupervisor: boolean;
  isManager: boolean;
  canManageTeams: boolean;
  canViewAudit: boolean;
  teamIds: string[] | null;
  visibleUserEmails: string[] | null;
  supervisedTeams: TimeClockTeam[];
};

export async function resolveTimeClockAccess(
  user: SessionUserLike | null | undefined
): Promise<TimeClockAccess> {
  const empty: TimeClockAccess = {
    isAdmin: false,
    isSupervisorRole: false,
    isTeamSupervisor: false,
    isManager: false,
    canManageTeams: false,
    canViewAudit: false,
    teamIds: [],
    visibleUserEmails: [],
    supervisedTeams: [],
  };
  if (!user?.email) return empty;

  const email = user.email.toLowerCase();
  const admin = isAdmin(user);
  const supervisorRole = isSupervisor(user);
  const supervisedTeams = await listTeamsForSupervisor(email);
  const isTeamSupervisor = supervisedTeams.length > 0;
  const isManager = admin || supervisorRole || isTeamSupervisor;

  if (admin) {
    const teams = await listTimeClockTeams({ activeOnly: false });
    return {
      isAdmin: true,
      isSupervisorRole: supervisorRole,
      isTeamSupervisor,
      isManager: true,
      canManageTeams: true,
      canViewAudit: true,
      teamIds: null,
      visibleUserEmails: await listVisibleTimeClockUserEmails(null),
      supervisedTeams: teams,
    };
  }

  if (isManager) {
    const teamIds = supervisedTeams.map((t) => t.id);
    // Empty list means "nobody", not unscoped. A Supervisor with no teams
    // must not see the whole org.
    const visibleUserEmails = teamIds.length
      ? await listTeamMemberEmails(teamIds)
      : [];
    return {
      isAdmin: false,
      isSupervisorRole: supervisorRole,
      isTeamSupervisor,
      isManager: true,
      canManageTeams: false,
      canViewAudit: true,
      teamIds,
      visibleUserEmails,
      supervisedTeams,
    };
  }

  return {
    ...empty,
    visibleUserEmails: [email],
  };
}

export function canViewTimeClockUser(
  access: TimeClockAccess,
  targetEmail: string
): boolean {
  if (access.visibleUserEmails === null) return true;
  return access.visibleUserEmails.includes(targetEmail.toLowerCase());
}

export function filterByVisibleUsers<T extends { user_email: string }>(
  rows: T[],
  access: TimeClockAccess
): T[] {
  if (access.visibleUserEmails === null) return rows;
  const allowed = new Set(access.visibleUserEmails);
  return rows.filter((r) => allowed.has(r.user_email.toLowerCase()));
}
