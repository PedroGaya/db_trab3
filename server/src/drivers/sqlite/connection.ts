import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import knex, { type Knex } from "knex";
import type { QueryLog } from "../shared";
import { BunSqliteClient } from "./bunDialect";

export function createKnex(filename: string, log: QueryLog): Knex {
  if (filename !== ":memory:")
    mkdirSync(dirname(filename), { recursive: true });

  const db = knex({
    client: BunSqliteClient as any,
    connection: { filename },
    useNullAsDefault: true,
  });

  db.on("query", (q: { sql: string; bindings?: unknown }) =>
    log.record(q.sql, q.bindings),
  );
  return db;
}
