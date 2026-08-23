"use client";

import { useCallback, useState } from "react";
import type { TimeOffBank } from "@/lib/timeClockTypes";
import { formatHours } from "@/lib/timeClockFormat";

type Props = {
  initialBanks: TimeOffBank[];
  initialYear: number;
  defaultAnnualHours: number;
};

export function TimeOffBanksPanel({
  initialBanks,
  initialYear,
  defaultAnnualHours,
}: Props) {
  const [banks, setBanks] = useState(initialBanks);
  const [year, setYear] = useState(initialYear);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initialBanks.map((b) => [b.user_email, String(b.allotted_hours)])
    )
  );

  const loadYear = useCallback(async (nextYear: number) => {
    setBusy(true);
    setMsg("");
    try {
      const params = new URLSearchParams({
        view: "team",
        year: String(nextYear),
      });
      const res = await fetch(`/api/time-clock/time-off/bank?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load banks");
      setBanks(data.banks || []);
      setYear(nextYear);
      setDrafts(
        Object.fromEntries(
          (data.banks || []).map((b: TimeOffBank) => [
            b.user_email,
            String(b.allotted_hours),
          ])
        )
      );
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed to load banks");
    } finally {
      setBusy(false);
    }
  }, []);

  async function saveAllotment(userEmail: string) {
    setBusy(true);
    setMsg("");
    try {
      const allotted = Number(drafts[userEmail]);
      const res = await fetch("/api/time-clock/time-off/bank", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_email: userEmail,
          year,
          allotted_hours: allotted,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setBanks((prev) =>
        prev.map((b) => (b.user_email === userEmail ? data.bank : b))
      );
      setDrafts((prev) => ({
        ...prev,
        [userEmail]: String(data.bank.allotted_hours),
      }));
      setMsg(`Updated allotment for ${data.bank.user_name || userEmail}.`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white/90 p-4">
        <label className="text-sm">
          <span className="font-semibold text-ink-soft">Year</span>
          <input
            type="number"
            min={2000}
            max={2100}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="mt-1 block w-28 rounded-lg border border-line px-3 py-2"
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => loadYear(year)}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Loading…" : "Load year"}
        </button>
        <p className="text-sm text-ink-soft">
          Default allotment: {formatHours(defaultAnnualHours)} / year (when no custom
          amount is set)
        </p>
      </div>

      {msg ? <p className="text-sm text-ink">{msg}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-line bg-white/90">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-line bg-wash text-xs uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="px-4 py-3 font-semibold">Employee</th>
              <th className="px-4 py-3 font-semibold">Allotted</th>
              <th className="px-4 py-3 font-semibold">Used</th>
              <th className="px-4 py-3 font-semibold">Remaining</th>
              <th className="px-4 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {banks.map((bank) => (
              <tr key={bank.user_email} className="border-b border-line last:border-0">
                <td className="px-4 py-3">
                  <p className="font-semibold text-ink">{bank.user_name}</p>
                  <p className="text-xs text-ink-soft">{bank.user_email}</p>
                  {bank.is_default_allotment ? (
                    <p className="text-xs text-ink-soft">Using default</p>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <input
                    type="number"
                    min={0}
                    max={2000}
                    step={0.5}
                    value={drafts[bank.user_email] ?? String(bank.allotted_hours)}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [bank.user_email]: e.target.value,
                      }))
                    }
                    className="w-24 rounded-lg border border-line px-2 py-1"
                  />
                </td>
                <td className="px-4 py-3 font-semibold text-ink">
                  {formatHours(bank.used_hours)}
                </td>
                <td className="px-4 py-3 font-semibold text-accent">
                  {formatHours(bank.remaining_hours)}
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => saveAllotment(bank.user_email)}
                    className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-wash disabled:opacity-50"
                  >
                    Save
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!banks.length ? (
          <p className="px-4 py-6 text-sm text-ink-soft">No time clock users found.</p>
        ) : null}
      </div>
    </div>
  );
}
