import { requireModule } from "@/lib/requireAccess";
import { isAdmin } from "@/lib/permissions";
import { getTimeClockProfile, getTimeClockSettings } from "@/lib/timeClockDb";
import { TimeClockProfilePanel } from "@/components/TimeClockProfilePanel";
import { TimeClockSettingsPanel } from "@/components/TimeClockSettingsPanel";

export default async function TimeClockSettingsPage() {
  const session = await requireModule("time_clock");
  const email = session.user.email!.toLowerCase();
  const admin = isAdmin(session.user);
  const [settings, profile] = await Promise.all([
    getTimeClockSettings(),
    getTimeClockProfile(email),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl text-ink">Time clock settings</h1>
      <p className="mt-1 text-ink-soft">
        {admin
          ? "Set your timezone, reminders, pay periods, and the practice default."
          : "Set the timezone used for your punches and timesheets."}
      </p>
      <div className="mt-6 space-y-6">
        <TimeClockProfilePanel initialProfile={profile} />
        {admin ? <TimeClockSettingsPanel initialSettings={settings} /> : null}
      </div>
    </main>
  );
}
