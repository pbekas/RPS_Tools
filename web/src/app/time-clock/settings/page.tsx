import { requireTimeClockAdmin } from "@/lib/requireAccess";
import { getTimeClockSettings } from "@/lib/timeClockDb";
import { TimeClockSettingsPanel } from "@/components/TimeClockSettingsPanel";

export default async function TimeClockSettingsPage() {
  await requireTimeClockAdmin();
  const settings = await getTimeClockSettings();

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl text-ink">Time clock settings</h1>
      <p className="mt-1 text-ink-soft">
        Configure reminders, pay periods, practice timezone, and Google Chat alerts.
      </p>
      <div className="mt-6">
        <TimeClockSettingsPanel initialSettings={settings} />
      </div>
    </main>
  );
}
