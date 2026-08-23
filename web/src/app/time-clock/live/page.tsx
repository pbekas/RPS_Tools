import { redirect } from "next/navigation";
import { requireModule } from "@/lib/requireAccess";
import { isAdmin } from "@/lib/permissions";
import { listTeamLiveStatus } from "@/lib/timeClockDb";
import { TeamLiveBoard } from "@/components/TeamLiveBoard";

export default async function TeamLivePage() {
  const session = await requireModule("time_clock");
  if (!isAdmin(session.user)) redirect("/time-clock");

  const rows = await listTeamLiveStatus();

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
