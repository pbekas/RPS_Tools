/** Server-side helper to call the private poller ops API. */

const DEFAULT_TIMEOUT_MS = 120_000;

export class PollerError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}

function pollerConfig(): { baseUrl: string; token: string } {
  const baseUrl = (process.env.POLLER_INTERNAL_URL || "").trim().replace(/\/$/, "");
  const token = (process.env.OPS_INTERNAL_TOKEN || "").trim();
  if (!baseUrl) {
    throw new PollerError(
      503,
      "POLLER_INTERNAL_URL is not configured — start the poller and set the URL (e.g. http://127.0.0.1:8080)"
    );
  }
  if (!token) {
    throw new PollerError(503, "OPS_INTERNAL_TOKEN is not configured");
  }
  return { baseUrl, token };
}

export async function pollerFetch(
  path: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const { baseUrl, token } = pollerConfig();
  const headers = new Headers(init.headers);
  headers.set("x-ops-token", token);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new PollerError(504, "Poller request timed out");
    }
    throw new PollerError(
      502,
      err instanceof Error ? err.message : "Failed to reach poller"
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function pollerJson<T = Record<string, unknown>>(
  path: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const res = await pollerFetch(path, init, timeoutMs);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const detail =
      (body as { detail?: string; error?: string } | null)?.detail ||
      (body as { error?: string } | null)?.error ||
      `Poller error (${res.status})`;
    throw new PollerError(res.status, String(detail));
  }
  return body as T;
}
