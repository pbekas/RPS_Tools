"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { QUEUE_STORAGE_KEY, type StoredQueue } from "@/lib/qa";

export function QueueNav({ callId }: { callId: string }) {
  const searchParams = useSearchParams();
  const inQueue = searchParams.get("queue") === "1";
  const router = useRouter();
  const [queue, setQueue] = useState<StoredQueue | null>(null);

  useEffect(() => {
    if (!inQueue) return;
    try {
      const raw = sessionStorage.getItem(QUEUE_STORAGE_KEY);
      if (!raw) return;
      const q = JSON.parse(raw) as StoredQueue;
      const idx = q.ids.indexOf(callId);
      if (idx >= 0) {
        q.cursor = idx;
        sessionStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(q));
      }
      setQueue(q);
    } catch {
      setQueue(null);
    }
  }, [callId, inQueue]);

  if (!inQueue || !queue?.ids?.length) return null;

  const idx = Math.max(0, queue.ids.indexOf(callId));
  const prevId = idx > 0 ? queue.ids[idx - 1] : null;
  const nextId = idx < queue.ids.length - 1 ? queue.ids[idx + 1] : null;

  function go(id: string | null) {
    if (!id) {
      router.push("/queue");
      return;
    }
    router.push(`/calls/${id}?queue=1`);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-wash/80 px-4 py-2.5 text-sm sm:px-6">
      <div className="font-semibold text-ink">
        Queue {idx + 1} of {queue.ids.length}
        <Link href="/queue" className="ml-3 text-xs font-semibold text-accent hover:underline">
          Back to sample
        </Link>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!prevId}
          onClick={() => go(prevId)}
          className="rounded-lg border border-line bg-white px-3 py-1.5 font-semibold text-ink-soft disabled:opacity-40"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => go(nextId)}
          className="rounded-lg bg-accent px-3 py-1.5 font-semibold text-white hover:bg-accent-deep"
        >
          {nextId ? "Next" : "Done"}
        </button>
      </div>
    </div>
  );
}
