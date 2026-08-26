"use client";

import Image from "next/image";
import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { defaultHrefForUser } from "@/lib/permissions";

function LoginInner() {
  const { data, status } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const error = params.get("error");

  useEffect(() => {
    if (status === "authenticated" && data?.user) {
      router.replace(defaultHrefForUser(data.user));
    }
  }, [status, data?.user, router]);

  return (
    <main className="relative flex min-h-screen items-center justify-center px-4">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(900px_520px_at_15%_0%,#1a3a45_0%,transparent_55%),radial-gradient(800px_480px_at_90%_10%,#0c2a33_0%,transparent_50%),linear-gradient(180deg,#05080a_0%,#0a1216_100%)]" />
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-black/70 px-8 py-10 shadow-soft backdrop-blur">
        <div className="flex justify-center">
          <Image
            src="/relevium-logo.png"
            alt="Relevium Pain Specialists"
            width={360}
            height={154}
            priority
            className="h-auto w-full max-w-[280px]"
          />
        </div>
        <h1 className="mt-8 text-center font-display text-3xl tracking-tight text-white sm:text-4xl">
          Employee Tools
        </h1>
        <p className="mt-2 text-center text-sm text-white/70">
          Sign in with your Google Workspace account. First visit creates an
          Agent login with Time Clock. An admin can add Call QA or Contracts
          later.
        </p>
        {error ? (
          <p className="mt-4 rounded-lg bg-red-50/10 px-3 py-2 text-center text-sm text-red-300">
            Sign-in failed. Use an allowed Google Workspace account.
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => signIn("google", { callbackUrl: "/" })}
          className="mt-8 w-full rounded-xl bg-[#5bc0de] px-4 py-3 text-sm font-semibold text-[#062029] hover:bg-[#7ad0e8]"
        >
          Continue with Google
        </button>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#05080a]" />}>
      <LoginInner />
    </Suspense>
  );
}
