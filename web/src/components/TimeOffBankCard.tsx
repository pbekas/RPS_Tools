import type { TimeOffBank } from "@/lib/timeClockTypes";
import { formatHours } from "@/lib/timeClockFormat";
import Link from "next/link";

type Props = {
  bank: TimeOffBank;
  linkToHistory?: boolean;
};

export function TimeOffBankCard({ bank, linkToHistory = false }: Props) {
  const bankPercent =
    bank.allotted_hours > 0
      ? Math.min(100, Math.round((bank.used_hours / bank.allotted_hours) * 100))
      : 0;

  return (
    <div className="rounded-xl border border-line bg-white/90 px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            {bank.year} time-off bank
          </p>
          <p className="mt-1 font-display text-2xl text-ink">
            {formatHours(bank.remaining_hours)} remaining
          </p>
          <p className="text-sm text-ink-soft">
            {formatHours(bank.used_hours)} used of {formatHours(bank.allotted_hours)} allotted
            {bank.is_default_allotment ? " (default)" : ""}
          </p>
        </div>
        <p className="text-sm font-semibold text-accent">{bankPercent}% used</p>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${bankPercent}%` }}
        />
      </div>
      {linkToHistory ? (
        <p className="mt-3 text-sm text-ink-soft">
          Log PTO or sick on{" "}
          <Link href="/time-clock/history" className="font-semibold text-accent hover:underline">
            My hours
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
