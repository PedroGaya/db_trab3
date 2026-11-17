import { Router } from "express";
import { parse } from "../middleware/validate";
import {
  IdParamSchema,
  LimitQuerySchema,
  PostBodySchema,
} from "../model/schemas";
import { run } from "./helpers";

// Mounted at /users, so these are /users/:id/posts and /users/:id/timeline
export const postsRouter = Router();

postsRouter.post("/:id/posts", async (req, res) => {
  const { id } = parse(IdParamSchema, req.params);
  const { body } = parse(PostBodySchema, req.body);
  await run(res, (s) => s.createPost({ authorId: id, body }), 201);
});

postsRouter.get("/:id/posts", async (req, res) => {
  const { id } = parse(IdParamSchema, req.params);
  const { limit } = parse(LimitQuerySchema, req.query);
  await run(res, (s) => s.listPostsByUser(id, limit));
});

postsRouter.get("/:id/timeline", async (req, res) => {
  const { id } = parse(IdParamSchema, req.params);
  const { limit } = parse(LimitQuerySchema, req.query);
  await run(res, (s) => s.timeline(id, limit));
});
