import { requireTimeClockManager } from "@/lib/requireAccess";
import { buildTimeClockReport, getTimeClockSettings } from "@/lib/timeClockDb";
import {
  parseNamedRangeKind,
  parseRangeOffset,
  resolveNamedRange,
} from "@/lib/timeClockPayPeriod";
import { TeamTimesheet } from "@/components/TeamTimesheet";

type Props = {
  searchParams?:
    | Promise<{
        range?: string;
        offset?: string;
        person?: string;
        team?: string;
      }>
    | { range?: string; offset?: string; person?: string; team?: string };
};

export default async function TeamTimeClockPage({ searchParams }: Props) {
  const { access } = await requireTimeClockManager();
  const params = await Promise.resolve(searchParams || {});
  const range = parseNamedRangeKind(params.range);
  const offset = parseRangeOffset(params.offset);
  const person = (params.person || "").trim().toLowerCase() || undefined;
  const teams = access.supervisedTeams;
  const canFilterByTeam = access.isAdmin || teams.length > 1;

  const settings = await getTimeClockSettings();
  const bounds = resolveNamedRange(range, settings.timezone, new Date(), offset);
  const report = await buildTimeClockReport({
    from: bounds.from,
    to: bounds.to,
    team: true,
    userEmails: access.visibleUserEmails,
    payPeriod: bounds.payPeriod,
  });

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl text-ink">Team hours</h1>
      <p className="mt-1 text-ink-soft">
        {canFilterByTeam
          ? "Hours are grouped by team. Switch teams, or expand a person to see and edit punches."
          : "Click a person to see the punches that make up their hours. Admins and supervisors can edit a punch from that list; every change is marked and logged."}
      </p>
      <div className="mt-6">
        <TeamTimesheet
          initialReport={report}
          settings={settings}
          initialRange={range}
          initialOffset={offset}
          initialPerson={person}
          initialTeam={params.team}
          scopeLabel={access.isAdmin ? "All Time Clock users" : "Your team"}
          teams={teams}
          canFilterByTeam={canFilterByTeam}
        />
      </div>
    </main>
  );
}
