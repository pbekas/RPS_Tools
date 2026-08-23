import { redirect } from "next/navigation";
import { requireModule } from "@/lib/requireAccess";
import { isAdmin } from "@/lib/permissions";
import { getTimeClockSettings } from "@/lib/timeClockDb";
import { TimeClockSettingsPanel } from "@/components/TimeClockSettingsPanel";

export default async function TimeClockSettingsPage() {
  const session = await requireModule("time_clock");
  if (!isAdmin(session.user)) redirect("/time-clock");

  const settings = await getTimeClockSettings();

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl text-ink">Time clock settings</h1>
      <p className="mt-1 text-ink-soft">
        Configure clock-out reminders and reporting timezone.
      </p>
      <div className="mt-6">
        <TimeClockSettingsPanel initialSettings={settings} />
      </div>
    </main>
  );
}
