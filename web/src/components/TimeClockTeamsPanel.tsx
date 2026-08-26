"use client";

import { useEffect, useMemo, useState } from "react";
import { SearchSelect } from "@/components/SearchSelect";
import type { TimeClockTeam } from "@/lib/timeClockTypes";

type UserRow = { email: string; name: string; role: string };

type Props = {
  initialTeams: TimeClockTeam[];
  initialUsers: UserRow[];
  canCreateTeams?: boolean;
  canEditSupervisor?: boolean;
};

export function TimeClockTeamsPanel({
  initialTeams,
  initialUsers,
  canCreateTeams = true,
  canEditSupervisor = true,
}: Props) {
  const [teams, setTeams] = useState(initialTeams);
  const users = initialUsers;
  const [name, setName] = useState("");
  const [supervisorEmail, setSupervisorEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const unassignedUsers = useMemo(() => {
    const assigned = new Set(
      teams.flatMap((t) => (t.members || []).map((m) => m.user_email.toLowerCase()))
    );
    return users.filter((u) => !assigned.has(u.email.toLowerCase()));
  }, [teams, users]);

  const userOptions = useMemo(
    () =>
      users.map((u) => ({
        value: u.email,
        label: u.name,
        hint: `${u.role} · ${u.email}`,
      })),
    [users]
  );

  const unassignedOptions = useMemo(
    () =>
      unassignedUsers.map((u) => ({
        value: u.email,
        label: u.name,
        hint: u.email,
      })),
    [unassignedUsers]
  );

  useEffect(() => {
    void refresh();
    // Load current org teams after mount so this panel works on Users & access.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    const res = await fetch("/api/time-clock/teams");
    const data = await res.json();
    if (res.ok) setTeams(data.teams || []);
  }

  async function createTeam() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/time-clock/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          supervisor_email: supervisorEmail || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Create failed");
      setName("");
      setSupervisorEmail("");
      setMsg(`Created team ${data.team.name}`);
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function assignMember(teamId: string, userEmail: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/time-clock/teams/${teamId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign_member", user_email: userEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Assign failed");
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Assign failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(teamId: string, userEmail: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/time-clock/teams/${teamId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove_member", user_email: userEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Remove failed");
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  }

  async function updateSupervisor(teamId: string, email: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/time-clock/teams/${teamId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supervisor_email: email || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {canCreateTeams ? (
        <div className="rounded-xl border border-line bg-white/90 p-4">
          <h2 className="font-display text-xl text-ink">Create department</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Departments apply to Call QA coaching and Time Clock manager views.
            Each person can belong to one team.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Team name"
              className="rounded-lg border border-line px-3 py-2 text-sm"
            />
            <SearchSelect
              options={userOptions}
              value={supervisorEmail}
              onChange={setSupervisorEmail}
              placeholder="Search supervisor…"
              blankLabel="Supervisor (optional)"
            />
            <button
              type="button"
              disabled={busy || !name.trim()}
              onClick={createTeam}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Create team
            </button>
          </div>
          {msg ? <p className="mt-2 text-sm text-ink">{msg}</p> : null}
        </div>
      ) : msg ? (
        <p className="text-sm text-ink">{msg}</p>
      ) : null}

      <div className="space-y-4">
        {teams.map((team) => (
          <div key={team.id} className="rounded-xl border border-line bg-white/90 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-ink">{team.name}</h3>
                <p className="text-sm text-ink-soft">{team.member_count} member(s)</p>
              </div>
              {canEditSupervisor ? (
                <label className="text-sm">
                  <span className="font-semibold text-ink-soft">Supervisor</span>
                  <SearchSelect
                    options={userOptions}
                    value={team.supervisor_email || ""}
                    onChange={(email) => updateSupervisor(team.id, email)}
                    placeholder="Search supervisor…"
                    blankLabel="None"
                    disabled={busy}
                    className="mt-1 min-w-[16rem]"
                  />
                </label>
              ) : (
                <p className="text-sm text-ink-soft">
                  Supervisor: {team.supervisor_name || team.supervisor_email || "None"}
                </p>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {(team.members || []).map((member) => (
                <span
                  key={member.user_email}
                  className="inline-flex items-center gap-1 rounded-full bg-wash px-3 py-1 text-sm font-semibold text-ink"
                >
                  {member.user_name}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void removeMember(team.id, member.user_email)}
                    className="ml-1 text-ink-soft hover:text-fail disabled:opacity-50"
                    aria-label={`Remove ${member.user_name}`}
                    title="Remove from team"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            <div className="mt-4 max-w-sm">
              <SearchSelect
                options={unassignedOptions}
                value=""
                onChange={(email) => {
                  if (email) void assignMember(team.id, email);
                }}
                placeholder="Search people to add…"
                disabled={busy}
              />
            </div>
          </div>
        ))}
        {!teams.length ? (
          <p className="text-sm text-ink-soft">No teams assigned to you yet.</p>
        ) : null}
      </div>
    </div>
  );
}
