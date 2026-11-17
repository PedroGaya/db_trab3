import type { Response } from "express";
import type { DataStore } from "../model/DataStore";

const round = (n: number) => Math.round(n * 100) / 100;

export async function run<T>(
  res: Response,
  fn: (store: DataStore) => Promise<T>,
  status = 200,
): Promise<void> {
  const store = res.locals.store;
  store.takeQueryLog();
  const start = performance.now();
  const data = await fn(store);
  const durationMs = round(performance.now() - start);
  res.status(status).json({
    data: data ?? null,
    meta: { db: store.name, durationMs, queries: store.takeQueryLog() },
  });
}
