import type { Knex } from "knex";
import * as init from "./001_init";

const migrations: Record<string, Knex.Migration> = {
  "001_init": init,
};

export const migrationSource: Knex.MigrationSource<string> = {
  getMigrations: async () => Object.keys(migrations).sort(),
  getMigrationName: (name) => name,
  getMigration: async (name) => migrations[name]!,
};
