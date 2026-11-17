import type { Config } from "../config";
import type { DataStore } from "../model/DataStore";
import type { DbName } from "../model/types";
import { Neo4jStore } from "./neo4j/Neo4jStore";
import { SqliteStore } from "./sqlite/SqliteStore";

export type Stores = Record<DbName, DataStore>;

export function createStores(config: Config): Stores {
  return {
    sqlite: new SqliteStore(config.sqlitePath),
    neo4j: new Neo4jStore(config.neo4j),
  };
}

export async function initStores(stores: Stores): Promise<void> {
  await Promise.all(Object.values(stores).map((s) => s.init()));
}

export async function closeStores(stores: Stores): Promise<void> {
  await Promise.allSettled(Object.values(stores).map((s) => s.close()));
}
