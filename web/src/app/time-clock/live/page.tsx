import { requireTimeClockManager } from "@/lib/requireAccess";
import { listTeamLiveStatus } from "@/lib/timeClockDb";
import { TeamLiveBoard } from "@/components/TeamLiveBoard";

export default async function TeamLivePage() {
  const { access } = await requireTimeClockManager();
  const rows = await listTeamLiveStatus(access.visibleUserEmails);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl text-ink">Live team status</h1>
      <p className="mt-1 text-ink-soft">
        See who is working, on break, or has not punched in yet. Refreshes automatically.
      </p>
      <div className="mt-6">
        <TeamLiveBoard
          initialRows={rows}
          initialRefreshedAt={new Date().toISOString()}
        />
      </div>
    </main>
  );
}
