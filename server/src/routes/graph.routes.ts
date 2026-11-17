import { Router } from "express";
import { parse } from "../middleware/validate";
import {
  IdParamSchema,
  LimitQuerySchema,
  MutualQuerySchema,
  PathQuerySchema,
  ReachableQuerySchema,
} from "../model/schemas";
import { run } from "./helpers";

export const graphRouter = Router();

graphRouter.get("/reachable/:id", async (req, res) => {
  const { id } = parse(IdParamSchema, req.params);
  const { depth } = parse(ReachableQuerySchema, req.query);
  await run(res, (s) => s.reachableWithin(id, depth));
});

graphRouter.get("/path", async (req, res) => {
  const { from, to, max } = parse(PathQuerySchema, req.query);
  await run(res, (s) => s.shortestPath(from, to, max));
});

graphRouter.get("/recommend/:id", async (req, res) => {
  const { id } = parse(IdParamSchema, req.params);
  const { limit } = parse(LimitQuerySchema, req.query);
  await run(res, (s) => s.recommend(id, limit));
});

graphRouter.get("/mutual", async (req, res) => {
  const { a, b } = parse(MutualQuerySchema, req.query);
  await run(res, (s) => s.mutualFollows(a, b));
});
