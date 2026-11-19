import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { config } from "../config";
import { closeStores, createStores, initStores, type Stores } from "../drivers";
import {
  BenchmarkRequestSchema,
  OPERATION_IDS,
  SeedRequestSchema,
} from "../model/schemas";
import type { BenchmarkResult, OperationId, SeedRequest } from "../model/types";
import { runBenchmark } from "../services/benchmark";
import { seedAll, type SeedResult } from "../services/seed";

export interface SuiteOptions {
  seed: SeedRequest | null;
  runs: number;
  warmup: number;
  depth: number;
  limit: number;
  ops: OperationId[];
  outDir: string;
  tag?: string;
  // Per-operation time budget.
  budgetMs?: number;
}

export interface SuiteOutcome {
  benchmarks: BenchmarkResult[];
  seeded: SeedResult | null;
  rows: Record<string, string | number>[];
  mismatches: number;
  files: { json: string; csv: string };
}

export async function runSuite(
  stores: Stores,
  opts: SuiteOptions,
): Promise<SuiteOutcome> {
  let seeded: SeedResult | null = null;
  if (opts.seed) {
    console.log("Seeding both databases with", opts.seed);
    seeded = await seedAll(stores, opts.seed);
    console.log("Loaded", seeded.counts);
    console.table(seeded.timings);
  }

  const benchmarks: BenchmarkResult[] = [];
  for (const operation of opts.ops) {
    process.stdout.write(`  ${operation} ... `);
    const result = await runBenchmark(
      stores,
      BenchmarkRequestSchema.parse({
        operation,
        runs: opts.runs,
        warmup: opts.warmup,
        depth: opts.depth,
        limit: opts.limit,
        budgetMs: opts.budgetMs,
      }),
    );
    console.log(
      result.equivalence.equal
        ? "ok"
        : `MISMATCH (${result.equivalence.mismatchedRuns} runs)`,
    );
    benchmarks.push(result);
  }

  const rows: Record<string, string | number>[] = benchmarks.map((b) => ({
    operation: b.operation.id,
    category: b.operation.category,
    "sqlite median ms": b.results.sqlite.timings.median,
    "neo4j median ms": b.results.neo4j.timings.median,
    "sqlite p95 ms": b.results.sqlite.timings.p95,
    "neo4j p95 ms": b.results.neo4j.timings.p95,
    faster: b.comparison.fasterDb,
    speedup: b.comparison.speedup,
    equal: b.equivalence.equal ? "yes" : "NO",
    errors: b.results.sqlite.errors + b.results.neo4j.errors,
  }));

  console.log();
  console.table(rows);

  const mismatches = benchmarks.filter(
    (b) =>
      !b.equivalence.equal ||
      b.results.sqlite.errors + b.results.neo4j.errors > 0,
  );
  for (const b of mismatches) {
    console.warn(
      `⚠ ${b.operation.id}: ${b.equivalence.first?.reason ?? "errors during runs"}`,
    );
    for (const db of ["sqlite", "neo4j"] as const) {
      if (b.results[db].firstError)
        console.warn(`    ${db} error: ${b.results[db].firstError}`);
    }
  }

  mkdirSync(opts.outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `benchmark-${opts.tag ? `${opts.tag}-` : ""}${stamp}`;
  const json = path.join(opts.outDir, `${base}.json`);
  const csv = path.join(opts.outDir, `${base}.csv`);
  writeFileSync(
    json,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        seed: seeded,
        options: { ...opts, ops: opts.ops },
        benchmarks,
      },
      null,
      2,
    ),
  );
  const header = Object.keys(rows[0] ?? {});
  writeFileSync(
    csv,
    [
      header.join(","),
      ...rows.map((r) => header.map((h) => r[h]).join(",")),
    ].join("\n") + "\n",
  );

  return {
    benchmarks,
    seeded,
    rows,
    mismatches: mismatches.length,
    files: { json, csv },
  };
}

const USAGE = `Usage: bun run benchmark [options]

  --users N         users to seed (default 1000)
  --avg-follows N   average follows per user (default 10)
  --posts N         posts per user (default 3)
  --seed N          PRNG seed, same seed = same data (default 42)
  --no-seed         keep the data already in the databases
  --runs N          timed runs per operation (default 20)
  --warmup N        untimed warm-up runs (default 3)
  --depth N         hops for 'reachable' (default 3)
  --limit N         result limit for timeline/recommend/topFollowed (default 10)
  --ops a,b,c       only these operations (default: all)
  --budget N        seconds per operation before it stops starting new runs (default 60)
  --wait N          seconds to wait for Neo4j to come up (default 90)
  --help
`;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function initWithRetry(
  stores: Stores,
  waitSeconds: number,
): Promise<void> {
  const deadline = Date.now() + waitSeconds * 1000;
  for (;;) {
    try {
      await initStores(stores);
      return;
    } catch (e) {
      if (Date.now() >= deadline) throw e;
      console.log(
        `Waiting for the databases (${(e as Error).message.split("\n")[0]}) ...`,
      );
      await sleep(3000);
    }
  }
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== "--"),
    options: {
      users: { type: "string" },
      "avg-follows": { type: "string" },
      posts: { type: "string" },
      seed: { type: "string" },
      "no-seed": { type: "boolean" },
      runs: { type: "string" },
      warmup: { type: "string" },
      depth: { type: "string" },
      limit: { type: "string" },
      ops: { type: "string" },
      wait: { type: "string" },
      budget: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }

  const ops = values.ops
    ? (values.ops.split(",").map((s) => s.trim()) as OperationId[])
    : [...OPERATION_IDS];
  const unknown = ops.filter(
    (o) => !(OPERATION_IDS as readonly string[]).includes(o),
  );
  if (unknown.length)
    throw new Error(
      `Unknown operation(s): ${unknown.join(", ")}. Valid: ${OPERATION_IDS.join(", ")}`,
    );

  const bench = BenchmarkRequestSchema.parse({
    operation: "getUser",
    runs: values.runs,
    warmup: values.warmup,
    depth: values.depth,
    limit: values.limit,
  });

  const stores = createStores(config);
  try {
    await initWithRetry(stores, Number(values.wait ?? 90));
    const outcome = await runSuite(stores, {
      seed: values["no-seed"]
        ? null
        : SeedRequestSchema.parse({
            users: values.users,
            avgFollows: values["avg-follows"],
            postsPerUser: values.posts,
            seed: values.seed,
          }),
      runs: bench.runs,
      warmup: bench.warmup,
      depth: bench.depth,
      limit: bench.limit,
      ops,
      budgetMs: values.budget ? Number(values.budget) * 1000 : undefined,
      outDir: path.resolve(import.meta.dir, "../../../results"),
    });
    console.log(`\nSaved: ${outcome.files.json}\n       ${outcome.files.csv}`);
    if (outcome.mismatches > 0) process.exitCode = 1;
  } finally {
    await closeStores(stores);
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(`\n${(e as Error).message}`);
    process.exitCode = 1;
  });
}
