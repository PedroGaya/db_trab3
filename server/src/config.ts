import path from "node:path";
import { z } from "zod";

const rootDir = path.resolve(import.meta.dir, "../..");

const EnvSchema = z.object({
  PORT: z.coerce.number().int().default(4000),
  SQLITE_PATH: z.string().default("./server/data/app.sqlite"),
  NEO4J_URI: z.string().default("bolt://localhost:7687"),
  NEO4J_USER: z.string().default("neo4j"),
  NEO4J_PASSWORD: z.string().default("localdevpassword"),
  NEO4J_DATABASE: z.string().default("neo4j"),
});

const env = EnvSchema.parse(process.env);

export const config = {
  port: env.PORT,
  sqlitePath:
    env.SQLITE_PATH === ":memory:"
      ? ":memory:"
      : path.resolve(rootDir, env.SQLITE_PATH),
  neo4j: {
    uri: env.NEO4J_URI,
    user: env.NEO4J_USER,
    password: env.NEO4J_PASSWORD,
    database: env.NEO4J_DATABASE,
  },
};

export type Config = typeof config;
