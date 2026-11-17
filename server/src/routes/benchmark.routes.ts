import { Router } from "express";
import type { Stores } from "../drivers";
import { parse } from "../middleware/validate";
import { BenchmarkRequestSchema } from "../model/schemas";
import { runBenchmark } from "../services/benchmark";
import { listOperations } from "../services/operations";

export function benchmarkRouter(stores: Stores): Router {
  const router = Router();

  router.get("/operations", (_req, res) => {
    res.json(listOperations());
  });

  router.post("/run", async (req, res) => {
    const request = parse(BenchmarkRequestSchema, req.body ?? {});
    res.json(await runBenchmark(stores, request));
  });

  return router;
}
