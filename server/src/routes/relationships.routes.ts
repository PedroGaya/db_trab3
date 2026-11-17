import { Router } from "express";
import { parse } from "../middleware/validate";
import { FollowParamsSchema, IdParamSchema } from "../model/schemas";
import { run } from "./helpers";

// Mounted at /users
export const relationshipsRouter = Router();

relationshipsRouter.put("/:id/follows/:otherId", async (req, res) => {
  const { id, otherId } = parse(FollowParamsSchema, req.params);
  await run(res, (s) => s.follow(id, otherId));
});

relationshipsRouter.delete("/:id/follows/:otherId", async (req, res) => {
  const { id, otherId } = parse(FollowParamsSchema, req.params);
  await run(res, (s) => s.unfollow(id, otherId));
});

relationshipsRouter.get("/:id/followers", async (req, res) => {
  const { id } = parse(IdParamSchema, req.params);
  await run(res, (s) => s.followers(id));
});

relationshipsRouter.get("/:id/following", async (req, res) => {
  const { id } = parse(IdParamSchema, req.params);
  await run(res, (s) => s.following(id));
});
