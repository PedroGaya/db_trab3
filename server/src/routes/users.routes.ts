import { Router } from "express";
import { parse } from "../middleware/validate";
import {
  IdParamSchema,
  ListUsersOptsSchema,
  NewUserSchema,
  UpdateUserSchema,
} from "../model/schemas";
import { run } from "./helpers";

export const usersRouter = Router();

usersRouter.get("/", async (req, res) => {
  const opts = parse(ListUsersOptsSchema, req.query);
  await run(res, (s) => s.listUsers(opts));
});

usersRouter.post("/", async (req, res) => {
  const input = parse(NewUserSchema, req.body);
  await run(res, (s) => s.createUser(input), 201);
});

usersRouter.get("/:id", async (req, res) => {
  const { id } = parse(IdParamSchema, req.params);
  await run(res, (s) => s.getUser(id));
});

usersRouter.patch("/:id", async (req, res) => {
  const { id } = parse(IdParamSchema, req.params);
  const patch = parse(UpdateUserSchema, req.body);
  await run(res, (s) => s.updateUser(id, patch));
});

usersRouter.delete("/:id", async (req, res) => {
  const { id } = parse(IdParamSchema, req.params);
  await run(res, (s) => s.deleteUser(id));
});
