export function QuotaNotice({ detail }: { detail?: string }) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="rounded-xl border border-[color:var(--warn)]/40 bg-amber-50 px-5 py-4">
        <h1 className="font-display text-2xl text-ink">Firestore quota exceeded</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-soft">
          Google Cloud Firestore has temporarily blocked reads for this project
          (daily free-tier limit). The CDR sync and large Ops queries used a lot of
          reads earlier today.
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-soft">
          <li>Wait for the quota to reset (usually daily), or</li>
          <li>
            Enable billing / raise limits in the Firebase / Google Cloud console
          </li>
        </ul>
        {detail ? (
          <p className="mt-3 font-mono text-xs text-ink-soft">{detail}</p>
        ) : null}
      </div>
    </div>
  );
}
