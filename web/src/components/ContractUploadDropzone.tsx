"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

type UploadRow = {
  filename: string;
  status: "queued" | "uploading" | "done" | "error";
  error?: string;
  id?: string;
};

export function ContractUploadDropzone({
  renewFrom,
}: {
  renewFrom?: { id: string; title: string } | null;
}) {
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState("");

  const uploadFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) => f.size > 0);
    if (!files.length) return;
    setBusy(true);
    setSummary("");
    setRows(files.map((f) => ({ filename: f.name, status: "queued" })));

    let uploaded = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setRows((prev) =>
          prev.map((row, idx) =>
            idx === i ? { ...row, status: "uploading" } : row
          )
        );
        const form = new FormData();
        form.append("files", file, file.name);
        if (renewFrom?.id) form.set("renew_from", renewFrom.id);
        const res = await fetch("/api/contracts/upload", {
          method: "POST",
          body: form,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const message = String(data.error || "Upload failed");
          setRows((prev) =>
            prev.map((row, idx) =>
              idx === i ? { ...row, status: "error", error: message } : row
            )
          );
          continue;
        }
        const failure = Array.isArray(data.failures) ? data.failures[0] : null;
        const created = Array.isArray(data.created) ? data.created[0] : null;
        if (failure) {
          setRows((prev) =>
            prev.map((row, idx) =>
              idx === i
                ? {
                    ...row,
                    status: "error",
                    error: String(failure.error || "Upload failed"),
                  }
                : row
            )
          );
          continue;
        }
        uploaded += 1;
        setRows((prev) =>
          prev.map((row, idx) =>
            idx === i
              ? {
                  ...row,
                  status: "done",
                  id: created?.id as string | undefined,
                }
              : row
          )
        );
      }
      setSummary(
        uploaded
          ? `Uploaded ${uploaded} file(s). Extraction will run via Bedrock shortly.`
          : "No files uploaded."
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "Upload failed";
      setRows((prev) =>
        prev.map((row) =>
          row.status === "done" ? row : { ...row, status: "error", error: message }
        )
      );
      setSummary(message);
    } finally {
      setBusy(false);
    }
  }, [renewFrom?.id]);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const items = e.dataTransfer.files;
    void uploadFiles(items);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">
          Contracts
        </p>
        <h1 className="mt-1 font-display text-3xl text-ink">
          {renewFrom ? "Upload renewal" : "Upload contracts"}
        </h1>
        <p className="mt-2 text-ink-soft">
          {renewFrom
            ? `This file will be linked as a renewal of “${renewFrom.title}”. The current agreement will be marked expired.`
            : "Drop a folder or multiple PDFs. We’ll store them in S3 and extract key terms with Bedrock."}
        </p>
      </div>

      <div
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDrop={onDrop}
        className={`rounded-3xl border-2 border-dashed px-6 py-16 text-center transition ${
          dragging
            ? "border-accent bg-wash"
            : "border-line bg-white/70 hover:border-accent/50"
        }`}
      >
        <p className="font-display text-2xl text-ink">Drop contracts here</p>
        <p className="mt-2 text-sm text-ink-soft">
          PDF preferred. PNG/JPEG/TIFF also supported via Textract. Max 40MB each.
        </p>
        <label className="mt-6 inline-flex cursor-pointer rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-deep">
          {busy ? "Uploading…" : "Choose folder"}
          <input
            type="file"
            multiple
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              if (e.target.files) void uploadFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <label className="ml-3 mt-6 inline-flex cursor-pointer rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink-soft hover:bg-wash">
          Select files
          <input
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.doc,.docx,application/pdf"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              if (e.target.files) void uploadFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {summary ? <p className="mt-4 text-sm text-ink-soft">{summary}</p> : null}

      {rows.length ? (
        <ul className="mt-6 space-y-2">
          {rows.map((row) => (
            <li
              key={row.filename}
              className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white/80 px-4 py-3 text-sm"
            >
              <div className="min-w-0">
                <div className="truncate font-semibold text-ink">{row.filename}</div>
                {row.error ? <div className="text-fail">{row.error}</div> : null}
              </div>
              <div className="shrink-0">
                {row.status === "done" && row.id ? (
                  <Link href={`/contracts/${row.id}`} className="font-semibold text-accent">
                    Open
                  </Link>
                ) : (
                  <span className="text-ink-soft">{row.status}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-8 text-sm text-ink-soft">
        After upload, review extracted fields in the{" "}
        <Link href="/contracts?needsReview=1" className="font-semibold text-accent">
          library
        </Link>
        .
      </p>
    </div>
  );
}
