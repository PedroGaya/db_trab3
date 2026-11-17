import { parseArgs } from "node:util";
import { config } from "../config";
import { closeStores, createStores, initStores } from "../drivers";
import { SeedRequestSchema } from "../model/schemas";
import { seedAll } from "../services/seed";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    users: { type: "string" },
    "avg-follows": { type: "string" },
    posts: { type: "string" },
    seed: { type: "string" },
  },
});

const request = SeedRequestSchema.parse({
  users: values.users,
  avgFollows: values["avg-follows"],
  postsPerUser: values.posts,
  seed: values.seed,
});

const stores = createStores(config);
try {
  await initStores(stores);
  console.log("Seeding with", request);
  const result = await seedAll(stores, request);
  console.log("Loaded", result.counts);
  console.table(result.timings);
} finally {
  await closeStores(stores);
}
