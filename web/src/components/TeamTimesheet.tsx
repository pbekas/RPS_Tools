"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TimeClockPersonHours } from "@/components/TimeClockPersonHours";
import type {
  TimeClockReport,
  TimeClockSettings,
  TimeClockTeam,
} from "@/lib/timeClockTypes";
import { formatHours } from "@/lib/timeClockFormat";
import {
  resolveNamedRange,
  type NamedRangeKind,
} from "@/lib/timeClockPayPeriod";

type ReportUser = NonNullable<TimeClockReport["by_user"]>[number];

type Props = {
  initialReport: TimeClockReport;
  settings: TimeClockSettings;
  initialRange: NamedRangeKind;
  initialOffset: number;
  initialPerson?: string;
  initialTeam?: string;
  scopeLabel?: string;
  teams?: TimeClockTeam[];
  canFilterByTeam?: boolean;
};

const RANGE_TABS: Array<{ id: NamedRangeKind; label: string }> = [
  { id: "week", label: "Week" },
  { id: "pay_period", label: "Pay period" },
  { id: "month", label: "Month" },
];

const ALL_TEAMS = "all";
const UNASSIGNED = "unassigned";

type TeamGroup = {
  id: string;
  name: string;
  hours: number;
  people: ReportUser[];
};

export function parseTeamFilter(
  value: string | undefined,
  teams: TimeClockTeam[]
): string {
  const raw = (value || "").trim();
  if (!raw || raw.toLowerCase() === ALL_TEAMS) return ALL_TEAMS;
  if (raw.toLowerCase() === UNASSIGNED) return UNASSIGNED;
  const match = teams.find((team) => team.id.toLowerCase() === raw.toLowerCase());
  return match?.id || ALL_TEAMS;
}

function groupPeopleByTeam(
  people: ReportUser[],
  teams: TimeClockTeam[]
): TeamGroup[] {
  const byId = new Map<string, TeamGroup>();
  for (const team of teams) {
    byId.set(team.id, {
      id: team.id,
      name: team.name,
      hours: 0,
      people: [],
    });
  }
  const unassigned: TeamGroup = {
    id: UNASSIGNED,
    name: "No team",
    hours: 0,
    people: [],
  };
  for (const person of people) {
    const group =
      (person.team_id && byId.get(person.team_id)) || unassigned;
    group.people.push(person);
    group.hours += person.total_hours;
  }
  const named = [...byId.values()]
    .filter((group) => group.people.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (unassigned.people.length) named.push(unassigned);
  return named;
}

export function TeamTimesheet({
  initialReport,
  settings,
  initialRange,
  initialOffset,
  initialPerson,
  initialTeam,
  scopeLabel,
  teams = [],
  canFilterByTeam = false,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [range, setRange] = useState<NamedRangeKind>(initialRange);
  const [offset, setOffset] = useState(initialOffset);
  const [report, setReport] = useState(initialReport);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [query, setQuery] = useState("");
  const [teamFilter, setTeamFilter] = useState(() =>
    parseTeamFilter(initialTeam, teams)
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    initialPerson ? { [initialPerson.toLowerCase()]: true } : {}
  );

  const bounds = useMemo(
    () => resolveNamedRange(range, settings.timezone, new Date(), offset),
    [range, settings.timezone, offset]
  );

  const writeUrl = useCallback(
    (
      nextRange: NamedRangeKind,
      nextOffset: number,
      person?: string,
      nextTeam = teamFilter
    ) => {
      const params = new URLSearchParams();
      params.set("range", nextRange);
      if (nextOffset) params.set("offset", String(nextOffset));
      if (nextTeam && nextTeam !== ALL_TEAMS) params.set("team", nextTeam);
      if (person) params.set("person", person);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, teamFilter]
  );

  async function loadRange(
    nextRange: NamedRangeKind,
    nextOffset: number,
    keepExpanded = false
  ) {
    setBusy(true);
    setMsg("");
    try {
      const params = new URLSearchParams({
        team: "1",
        range: nextRange,
        offset: String(nextOffset),
      });
      const res = await fetch(`/api/time-clock/report?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load team hours");
      setRange(nextRange);
      setOffset(nextOffset);
      setReport(data.report);
      if (!keepExpanded) {
        setExpanded({});
        writeUrl(nextRange, nextOffset);
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed to load team hours");
    } finally {
      setBusy(false);
    }
  }

  function togglePerson(email: string) {
    const key = email.toLowerCase();
    setExpanded((current) => {
      const nextOpen = !current[key];
      writeUrl(range, offset, nextOpen ? key : undefined);
      return nextOpen ? { [key]: true } : {};
    });
  }

  function changeTeam(nextTeam: string) {
    setTeamFilter(nextTeam);
    setExpanded({});
    writeUrl(range, offset, undefined, nextTeam);
  }

  const people = useMemo(() => {
    const rows = report.by_user || [];
    const needle = query.trim().toLowerCase();
    return rows.filter((user) => {
      if (canFilterByTeam && teamFilter !== ALL_TEAMS) {
        if (teamFilter === UNASSIGNED) {
          if (user.team_id) return false;
        } else if ((user.team_id || "") !== teamFilter) {
          return false;
        }
      }
      if (!needle) return true;
      return (
        user.user_name.toLowerCase().includes(needle) ||
        user.user_email.toLowerCase().includes(needle) ||
        (user.team_name || "").toLowerCase().includes(needle)
      );
    });
  }, [report, query, teamFilter, canFilterByTeam]);

  const groups = useMemo(() => {
    if (!canFilterByTeam || teamFilter !== ALL_TEAMS) return null;
    return groupPeopleByTeam(people, teams);
  }, [canFilterByTeam, teamFilter, people, teams]);

  const visibleHours = people.reduce((sum, user) => sum + user.total_hours, 0);
  const showWeekly = range !== "week";
  const selectedTeamName =
    teamFilter === ALL_TEAMS
      ? null
      : teamFilter === UNASSIGNED
        ? "No team"
        : teams.find((team) => team.id === teamFilter)?.name ||
          "Team";
  const hasUnassigned = (report.by_user || []).some((user) => !user.team_id);
  const assignedTeamIds = useMemo(() => {
    const ids = new Set<string>();
    for (const user of report.by_user || []) {
      if (user.team_id) ids.add(user.team_id);
    }
    return ids;
  }, [report]);
  const dropdownTeams = useMemo(
    () =>
      teams.filter((team) => team.active || assignedTeamIds.has(team.id)),
    [teams, assignedTeamIds]
  );
  const showTeamFilter =
    canFilterByTeam && (dropdownTeams.length > 0 || hasUnassigned);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-line bg-wash p-1 text-sm font-semibold">
          {RANGE_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              disabled={busy}
              onClick={() => loadRange(tab.id, 0)}
              className={`rounded-md px-3 py-1.5 ${
                range === tab.id ? "bg-white text-accent shadow-sm" : "text-ink-soft"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showTeamFilter ? (
            <label className="text-sm">
              <span className="sr-only">Team</span>
              <select
                value={teamFilter}
                onChange={(e) => changeTeam(e.target.value)}
                className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink"
              >
                <option value={ALL_TEAMS}>All teams</option>
                {dropdownTeams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.active ? team.name : `${team.name} (inactive)`}
                  </option>
                ))}
                {hasUnassigned ? (
                  <option value={UNASSIGNED}>No team</option>
                ) : null}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => loadRange(range, offset - 1)}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft hover:bg-wash"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={busy || offset === 0}
            onClick={() => loadRange(range, 0)}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft hover:bg-wash disabled:opacity-40"
          >
            Current
          </button>
          <button
            type="button"
            disabled={busy || offset >= 0}
            onClick={() => loadRange(range, offset + 1)}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft hover:bg-wash disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-white/90 px-4 py-4">
        <p className="text-sm text-ink-soft">{bounds.label}</p>
        <p className="font-display text-3xl text-ink">
          {formatHours(visibleHours)}
        </p>
        <p className="mt-1 text-xs text-ink-soft">
          {selectedTeamName
            ? `${selectedTeamName} · `
            : scopeLabel
              ? `${scopeLabel} · `
              : ""}
          {bounds.start} – {bounds.end} · {report.timezone}
        </p>
      </div>

      {msg ? <p className="text-sm text-fail">{msg}</p> : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl text-ink">
            {groups ? "Hours by team" : "Hours by person"}
          </h2>
          <p className="text-sm text-ink-soft">
            {groups
              ? "People are grouped by team. Expand a person to see punches and edit them."
              : "Click a person to see the punches that make up their hours. Use Edit to correct a punch; edited punches stay marked and logged."}
          </p>
        </div>
        {(report.by_user?.length || 0) > 6 ? (
          <label className="text-sm">
            <span className="sr-only">Search people</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people"
              className="rounded-lg border border-line px-3 py-2"
            />
          </label>
        ) : null}
      </div>

      {groups ? (
        groups.length ? (
          <div className="space-y-4">
            {groups.map((group) => (
              <TeamHoursSection
                key={group.id}
                name={group.name}
                hours={group.hours}
                people={group.people}
                timezone={report.timezone}
                expanded={expanded}
                showWeekly={showWeekly}
                onToggle={togglePerson}
                onPunchUpdated={() => loadRange(range, offset, true)}
              />
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-line bg-white/90 px-4 py-4 text-sm text-ink-soft">
            {query.trim() ? "No people match that search." : "No people on this team."}
          </p>
        )
      ) : (
        <PersonHoursList
          people={people}
          query={query}
          timezone={report.timezone}
          expanded={expanded}
          showWeekly={showWeekly}
          onToggle={togglePerson}
          onPunchUpdated={() => loadRange(range, offset, true)}
        />
      )}
    </div>
  );
}

function TeamHoursSection({
  name,
  hours,
  people,
  timezone,
  expanded,
  showWeekly,
  onToggle,
  onPunchUpdated,
}: {
  name: string;
  hours: number;
  people: ReportUser[];
  timezone: string;
  expanded: Record<string, boolean>;
  showWeekly: boolean;
  onToggle: (email: string) => void;
  onPunchUpdated: () => void;
}) {
  const withHours = people.filter((user) => user.total_hours > 0);
  const noPunches = people.filter((user) => user.total_hours <= 0);
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-white/90">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-wash/40 px-4 py-3">
        <h3 className="font-semibold text-ink">{name}</h3>
        <p className="text-sm font-semibold text-accent">{formatHours(hours)}</p>
      </div>
      {withHours.length ? (
        withHours.map((user) => (
          <TimeClockPersonHours
            key={user.user_email}
            user={user}
            timezone={timezone}
            open={Boolean(expanded[user.user_email.toLowerCase()])}
            onToggle={() => onToggle(user.user_email)}
            showWeekly={showWeekly}
            canEditPunches
            onPunchUpdated={onPunchUpdated}
          />
        ))
      ) : (
        <p className="px-4 py-3 text-sm text-ink-soft">No hours in this period.</p>
      )}
      {noPunches.length ? (
        <details className="group border-t border-line">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-ink-soft hover:bg-wash/70 [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-2">
              <span
                className="inline-block transition-transform group-open:rotate-90"
                aria-hidden
              >
                ▸
              </span>
              No punches ({noPunches.length})
            </span>
          </summary>
          <div className="border-t border-line">
            {noPunches.map((user) => (
              <TimeClockPersonHours
                key={user.user_email}
                user={user}
                timezone={timezone}
                open={Boolean(expanded[user.user_email.toLowerCase()])}
                onToggle={() => onToggle(user.user_email)}
                canEditPunches
                onPunchUpdated={onPunchUpdated}
              />
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function PersonHoursList({
  people,
  query,
  timezone,
  expanded,
  showWeekly,
  onToggle,
  onPunchUpdated,
}: {
  people: ReportUser[];
  query: string;
  timezone: string;
  expanded: Record<string, boolean>;
  showWeekly: boolean;
  onToggle: (email: string) => void;
  onPunchUpdated: () => void;
}) {
  const withHours = people.filter((user) => user.total_hours > 0);
  const noPunches = people.filter((user) => user.total_hours <= 0);

  if (!withHours.length && !noPunches.length) {
    return (
      <p className="rounded-xl border border-line bg-white/90 px-4 py-4 text-sm text-ink-soft">
        {query.trim() ? "No people match that search." : "No people on this team."}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {withHours.length ? (
        <div className="overflow-hidden rounded-xl border border-line bg-white/90">
          {withHours.map((user) => (
            <TimeClockPersonHours
              key={user.user_email}
              user={user}
              timezone={timezone}
              open={Boolean(expanded[user.user_email.toLowerCase()])}
              onToggle={() => onToggle(user.user_email)}
              showWeekly={showWeekly}
              canEditPunches
              onPunchUpdated={onPunchUpdated}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-line bg-white/90 px-4 py-4 text-sm text-ink-soft">
          {query.trim()
            ? "No matching people with hours in this period."
            : "No hours in this period."}
        </p>
      )}

      {noPunches.length ? (
        <details className="group overflow-hidden rounded-xl border border-line bg-white/90">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-ink-soft hover:bg-wash/70 [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-2">
              <span
                className="inline-block transition-transform group-open:rotate-90"
                aria-hidden
              >
                ▸
              </span>
              No punches ({noPunches.length})
            </span>
          </summary>
          <div className="border-t border-line">
            {noPunches.map((user) => (
              <TimeClockPersonHours
                key={user.user_email}
                user={user}
                timezone={timezone}
                open={Boolean(expanded[user.user_email.toLowerCase()])}
                onToggle={() => onToggle(user.user_email)}
                canEditPunches
                onPunchUpdated={onPunchUpdated}
              />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
