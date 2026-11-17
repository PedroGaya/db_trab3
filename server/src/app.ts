import cors from "cors";
import express, { type Express } from "express";
import type { Stores } from "./drivers";
import { errorHandler, notFound } from "./middleware/errorHandler";
import { createApiRouter } from "./routes";

export function createApp(stores: Stores): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", createApiRouter(stores));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
