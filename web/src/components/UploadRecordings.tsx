"use client";

import Link from "next/link";
import { useRef, useState } from "react";

type UploadRow = {
  name: string;
  status: "pending" | "uploading" | "ok" | "error";
  callId?: string;
  error?: string;
};

const ACCEPT = "audio/mpeg,audio/wav,audio/x-wav,audio/wave,.mp3,.wav";

export function UploadRecordings() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [busy, setBusy] = useState(false);

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.size > 0);
    if (!list.length) return;

    const initial: UploadRow[] = list.map((f) => ({
      name: f.name,
      status: "pending",
    }));
    setRows(initial);
    setBusy(true);

    for (let i = 0; i < list.length; i += 1) {
      const file = list[i];
      setRows((prev) =>
        prev.map((row, idx) =>
          idx === i ? { ...row, status: "uploading" } : row
        )
      );
      try {
        const body = new FormData();
        body.append("file", file, file.name);
        const res = await fetch("/api/uploads", { method: "POST", body });
        const data = (await res.json().catch(() => ({}))) as {
          call_id?: string;
          error?: string;
          detail?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || data.detail || `Upload failed (${res.status})`);
        }
        setRows((prev) =>
          prev.map((row, idx) =>
            idx === i
              ? {
                  ...row,
                  status: "ok",
                  callId: data.call_id || undefined,
                }
              : row
          )
        );
      } catch (err) {
        setRows((prev) =>
          prev.map((row, idx) =>
            idx === i
              ? {
                  ...row,
                  status: "error",
                  error: err instanceof Error ? err.message : "Upload failed",
                }
              : row
          )
        );
      }
    }

    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <section className="mb-8 rounded-2xl border border-line bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-xl text-ink">Upload recordings</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            Queue MP3/WAV files for Transcribe + Bedrock QA. Most calls arrive
            automatically via the Vonage poller — use this for one-offs.
          </p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-wash px-3 py-2 text-sm font-semibold text-ink hover:bg-white">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            disabled={busy}
            className="sr-only"
            onChange={(e) => {
              if (e.target.files?.length) void uploadFiles(e.target.files);
            }}
          />
          {busy ? "Uploading…" : "Choose files"}
        </label>
      </div>

      {rows.length > 0 ? (
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
          {rows.map((row) => (
            <li
              key={`${row.name}-${row.callId || row.status}`}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <span className="font-medium text-ink">{row.name}</span>
              <span className="text-ink-soft">
                {row.status === "pending" || row.status === "uploading"
                  ? "Uploading…"
                  : null}
                {row.status === "ok" && row.callId ? (
                  <>
                    Queued ·{" "}
                    <Link
                      href={`/calls/${row.callId}`}
                      className="font-semibold text-accent hover:underline"
                    >
                      Open review
                    </Link>
                  </>
                ) : null}
                {row.status === "ok" && !row.callId ? "Queued" : null}
                {row.status === "error" ? (
                  <span className="text-fail">{row.error || "Failed"}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
