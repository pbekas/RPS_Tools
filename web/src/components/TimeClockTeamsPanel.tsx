"use client";

import { useMemo, useState } from "react";
import type { TimeClockTeam } from "@/lib/timeClockTypes";

type UserRow = { email: string; name: string; role: string };

type Props = {
  initialTeams: TimeClockTeam[];
  initialUsers: UserRow[];
};

export function TimeClockTeamsPanel({ initialTeams, initialUsers }: Props) {
  const [teams, setTeams] = useState(initialTeams);
  const [users] = useState(initialUsers);
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
      <div className="rounded-xl border border-line bg-white/90 p-4">
        <h2 className="font-display text-xl text-ink">Create department</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Team name"
            className="rounded-lg border border-line px-3 py-2 text-sm"
          />
          <select
            value={supervisorEmail}
            onChange={(e) => setSupervisorEmail(e.target.value)}
            className="rounded-lg border border-line px-3 py-2 text-sm"
          >
            <option value="">Supervisor (optional)</option>
            {users.map((u) => (
              <option key={u.email} value={u.email}>
                {u.name} ({u.role})
              </option>
            ))}
          </select>
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

      <div className="space-y-4">
        {teams.map((team) => (
          <div key={team.id} className="rounded-xl border border-line bg-white/90 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-ink">{team.name}</h3>
                <p className="text-sm text-ink-soft">{team.member_count} member(s)</p>
              </div>
              <label className="text-sm">
                <span className="font-semibold text-ink-soft">Supervisor</span>
                <select
                  value={team.supervisor_email || ""}
                  onChange={(e) => updateSupervisor(team.id, e.target.value)}
                  className="mt-1 block rounded-lg border border-line px-3 py-2"
                >
                  <option value="">None</option>
                  {users.map((u) => (
                    <option key={u.email} value={u.email}>
                      {u.name} ({u.role})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {(team.members || []).map((member) => (
                <span
                  key={member.user_email}
                  className="rounded-full bg-wash px-3 py-1 text-sm font-semibold text-ink"
                >
                  {member.user_name}
                </span>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <select
                defaultValue=""
                onChange={(e) => {
                  const email = e.target.value;
                  if (email) assignMember(team.id, email);
                  e.currentTarget.value = "";
                }}
                className="rounded-lg border border-line px-3 py-2 text-sm"
              >
                <option value="">Add team member…</option>
                {unassignedUsers.map((u) => (
                  <option key={u.email} value={u.email}>
                    {u.name} ({u.email})
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
