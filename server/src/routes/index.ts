import { Router } from "express";
import type { Stores } from "../drivers";
import { driverSelect } from "../middleware/driverSelect";
import { adminRouter } from "./admin.routes";
import { analyticsRouter } from "./analytics.routes";
import { benchmarkRouter } from "./benchmark.routes";
import { graphRouter } from "./graph.routes";
import { run } from "./helpers";
import { postsRouter } from "./posts.routes";
import { relationshipsRouter } from "./relationships.routes";
import { usersRouter } from "./users.routes";

export function createApiRouter(stores: Stores): Router {
  const api = Router();
  const withDb = driverSelect(stores);

  api.get("/health", async (_req, res) => {
    const entries = await Promise.all(
      Object.entries(stores).map(async ([name, store]) => {
        try {
          const stats = await store.stats();
          store.takeQueryLog();
          return [name, { ok: true, stats }] as const;
        } catch (e) {
          return [name, { ok: false, error: (e as Error).message }] as const;
        }
      }),
    );
    res.json(Object.fromEntries(entries));
  });

  api.get("/stats", withDb, async (_req, res) => {
    await run(res, (s) => s.stats());
  });

  api.use("/admin", adminRouter(stores));
  api.use("/benchmark", benchmarkRouter(stores));
  api.use("/users", withDb, usersRouter, postsRouter, relationshipsRouter);
  api.use("/graph", withDb, graphRouter);
  api.use("/analytics", withDb, analyticsRouter);

  return api;
}
