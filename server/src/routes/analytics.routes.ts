import { Router } from "express";
import { parse } from "../middleware/validate";
import { LimitQuerySchema } from "../model/schemas";
import { run } from "./helpers";

export const analyticsRouter = Router();

analyticsRouter.get("/users-per-city", async (_req, res) => {
  await run(res, (s) => s.usersPerCity());
});

analyticsRouter.get("/top-followed", async (req, res) => {
  const { limit } = parse(LimitQuerySchema, req.query);
  await run(res, (s) => s.topFollowed(limit));
});
