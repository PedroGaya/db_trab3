import type { DbName, Stats } from "../../server/src/model/types";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  return body as T;
}

export const get = <T>(path: string) => call<T>(path);

export const post = <T>(path: string, body: unknown = {}) =>
  call<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** Every `?db=` endpoint wraps its payload like this. */
export interface Envelope<T> {
  data: T;
  meta: { db: DbName; durationMs: number; queries: string[] };
}

export type Health = Record<
  DbName,
  { ok: true; stats: Stats } | { ok: false; error: string }
>;

export interface SeedResponse {
  counts: Stats;
  timings: Record<DbName, { totalMs: number }>;
}
