import { requireTimeClockAdmin } from "@/lib/requireAccess";
import { listUsersWithTimeClockAccess } from "@/lib/timeClockDb";
import { getTimeClockTeam, listTimeClockTeams } from "@/lib/timeClockTeamsDb";
import { TimeClockTeamsPanel } from "@/components/TimeClockTeamsPanel";

export default async function TimeClockTeamsPage() {
  await requireTimeClockAdmin();

  const [teams, users] = await Promise.all([
    listTimeClockTeams({ activeOnly: false, teamIds: null }),
    listUsersWithTimeClockAccess(),
  ]);

  const teamsWithMembers = await Promise.all(
    teams.map(async (team) => (await getTimeClockTeam(team.id)) || team)
  );

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl text-ink">Teams & departments</h1>
      <p className="mt-1 text-ink-soft">
        Group staff into departments, assign supervisors, and scope manager views.
      </p>
      <div className="mt-6">
        <TimeClockTeamsPanel initialTeams={teamsWithMembers} initialUsers={users} />
      </div>
    </main>
  );
}
