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
  userEmail: string | null;
};

function withSelf(emails: string[], email: string): string[] {
  const set = new Set(emails.map((value) => value.toLowerCase()).filter(Boolean));
  set.add(email.toLowerCase());
  return [...set];
}

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
    userEmail: null,
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
    const visible = await listVisibleTimeClockUserEmails(null);
    return {
      isAdmin: true,
      isSupervisorRole: supervisorRole,
      isTeamSupervisor,
      isManager: true,
      canManageTeams: true,
      canViewAudit: true,
      teamIds: null,
      visibleUserEmails: visible ? withSelf(visible, email) : null,
      supervisedTeams: teams,
      userEmail: email,
    };
  }

  if (isManager) {
    const teamIds = supervisedTeams.map((t) => t.id);
    // Empty list means "nobody else", not unscoped. A Supervisor with no teams
    // must not see the whole org — but they can still punch and request PTO.
    const members = teamIds.length ? await listTeamMemberEmails(teamIds) : [];
    return {
      isAdmin: false,
      isSupervisorRole: supervisorRole,
      isTeamSupervisor,
      isManager: true,
      canManageTeams: false,
      canViewAudit: true,
      teamIds,
      visibleUserEmails: withSelf(members, email),
      supervisedTeams,
      userEmail: email,
    };
  }

  return {
    ...empty,
    visibleUserEmails: [email],
    userEmail: email,
  };
}

export function canViewTimeClockUser(
  access: TimeClockAccess,
  targetEmail: string
): boolean {
  const target = targetEmail.toLowerCase();
  if (access.userEmail && target === access.userEmail) return true;
  if (access.visibleUserEmails === null) return true;
  return access.visibleUserEmails.includes(target);
}

export function filterByVisibleUsers<T extends { user_email: string }>(
  rows: T[],
  access: TimeClockAccess
): T[] {
  if (access.visibleUserEmails === null) return rows;
  const allowed = new Set(access.visibleUserEmails);
  return rows.filter((r) => allowed.has(r.user_email.toLowerCase()));
}
