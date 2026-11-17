import neo4j, { type Driver } from "neo4j-driver";

export interface Neo4jConnectionConfig {
  uri: string;
  user: string;
  password: string;
  database: string;
}

export function createNeo4jDriver(c: Neo4jConnectionConfig): Driver {
  return neo4j.driver(c.uri, neo4j.auth.basic(c.user, c.password), {
    disableLosslessIntegers: true,
  });
}

export const int = (n: number) => neo4j.int(n);
