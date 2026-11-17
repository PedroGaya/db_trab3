import { Router } from "express";
import type { Stores } from "../drivers";
import { parse } from "../middleware/validate";
import { SeedRequestSchema } from "../model/schemas";
import { seedAll } from "../services/seed";

export function adminRouter(stores: Stores): Router {
  const router = Router();

  router.post("/seed", async (req, res) => {
    const request = parse(SeedRequestSchema, req.body ?? {});
    res.json(await seedAll(stores, request));
  });

  router.post("/reset", async (_req, res) => {
    for (const store of Object.values(stores)) await store.reset();
    res.json({ ok: true });
  });

  return router;
}
