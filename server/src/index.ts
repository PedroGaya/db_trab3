import { createApp } from "./app";
import { config } from "./config";
import { closeStores, createStores, initStores } from "./drivers";

const stores = createStores(config);

try {
  await initStores(stores);
} catch (e) {
  console.error(
    `\nCould not initialise the databases: ${(e as Error).message}`,
  );
  console.error(`  • SQLite file: ${config.sqlitePath}`);
  console.error(
    `  • Neo4j:       ${config.neo4j.uri}  (is \`docker compose up -d\` running?)\n`,
  );
  await closeStores(stores);
  process.exit(1);
}

const server = createApp(stores).listen(config.port, () => {
  console.log(`API ready on http://localhost:${config.port}/api`);
});

async function shutdown() {
  server.close();
  await closeStores(stores);
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
