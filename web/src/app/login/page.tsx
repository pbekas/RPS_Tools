"use client";

import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

function LoginInner() {
  const { status } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const error = params.get("error");

  useEffect(() => {
    if (status === "authenticated") router.replace("/");
  }, [status, router]);

  return (
    <main className="relative flex min-h-screen items-center justify-center px-4">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(900px_500px_at_20%_0%,#cfe8e8_0%,transparent_55%),radial-gradient(700px_400px_at_90%_20%,#dce6f0_0%,transparent_50%)]" />
      <div className="w-full max-w-md rounded-3xl border border-line bg-white/90 p-8 shadow-soft backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
          Relevium Pain Specialists
        </p>
        <h1 className="mt-2 font-display text-4xl text-ink">Call QA</h1>
        <p className="mt-3 text-ink-soft">
          Sign in with your @releviumpain.com Google account to review scored
          calls and coaching feedback.
        </p>
        {error ? (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-fail">
            Sign-in failed. Use a Relevium Google account.
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => signIn("google", { callbackUrl: "/" })}
          className="mt-6 w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white hover:bg-accent-deep"
        >
          Continue with Google
        </button>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="min-h-screen" />}>
      <LoginInner />
    </Suspense>
  );
}
