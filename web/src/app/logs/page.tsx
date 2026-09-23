import { listCallLogs, listUsers, searchCalls } from "@/lib/database";
import { filterCallLogsForPeople } from "@/lib/callLogs";
import { CallLogsSearch } from "@/components/CallLogsSearch";
import { requireCallQaManager } from "@/lib/requireAccess";
import { canViewCallAgent } from "@/lib/orgTeamAccess";

export default async function LogsPage() {
  const { scope } = await requireCallQaManager();

  const [rawLogs, calls, users] = await Promise.all([
    listCallLogs({ limit: 100, days: 30 }),
    searchCalls({
      limit: 100,
      days: 30,
      status: "complete",
      agentEmails: scope.agentEmails,
      requireMinDuration: false,
    }),
    listUsers(),
  ]);
  const people = scope.agentEmails
    ? users.filter((user) => canViewCallAgent(scope, user.email))
    : null;
  const logs = filterCallLogsForPeople(rawLogs, people);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-wide text-accent">
        Search
      </p>
      <h1 className="font-display text-3xl text-ink">Call logs</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-soft">
        Find CDRs and QA recordings by phone, extension, agent, or Vonage id —
        without loading the full Call ops tower.
      </p>
      <div className="mt-6">
        <CallLogsSearch initialLogs={logs} initialCalls={calls} />
      </div>
    </main>
  );
}
