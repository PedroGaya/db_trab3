import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { config } from "../config";
import { closeStores, createStores, type Stores } from "../drivers";
import { Neo4jStore } from "../drivers/neo4j/Neo4jStore";
import { SqliteStore } from "../drivers/sqlite/SqliteStore";
import { OPERATION_IDS } from "../model/schemas";
import type {
  BenchmarkResult,
  DbName,
  OperationId,
  Stats,
  TimingStats,
  User,
} from "../model/types";
import { summarize } from "../services/benchmark";
import type { LoadTimings } from "../services/seed";
import { initWithRetry, runSuite, sleep } from "./benchmark";

const DBS: DbName[] = ["sqlite", "neo4j"];
const ROOT = path.resolve(import.meta.dir, "../../..");

// ───────────────────────── measurement types ─────────────────────────

export interface StorageMeasurement {
  sqliteMb: number | null;
  neo4jMb: number | null; // store files
  neo4jTxLogMb: number | null; // transaction logs (kept separately)
}

export interface WriteTimings {
  createUser: TimingStats;
  follow: TimingStats;
  createPost: TimingStats;
  deleteUser: TimingStats; // cascades to the user's post and follow edge
  /** True if the row counts after cleanup match those before. */
  restored: boolean;
}

export interface SizeMeasurement {
  users: number;
  counts: Stats;
  load: Record<DbName, LoadTimings>;
  benchmarks: BenchmarkResult[];
  storage: StorageMeasurement;
  writes: Record<DbName, WriteTimings>;
}

export interface Measurements {
  generatedAt: string;
  options: CollectOptions;
  /** Milliseconds until the database is usable; null if it could not be measured. */
  startup: Record<DbName, number | null>;
  sizes: SizeMeasurement[]; // ascending by users
  /** `reachable` at several depths on the largest dataset. */
  depthSweep: { depth: number; result: BenchmarkResult }[];
}

export interface CollectOptions {
  sizes: number[];
  runs: number;
  warmup: number;
  depths: number[];
  depthRuns: number;
  writeRuns: number;
  avgFollows: number;
  seed: number;
  budgetMs: number;
  outDir: string;
}

/** Things that need the OS / Docker, injected so the rest stays testable. */
export interface Hooks {
  startup(): Promise<Record<DbName, number | null>>;
  storage(): Promise<StorageMeasurement>;
}

// ───────────────────────── write benchmark ─────────────────────────

async function measureWrites(
  stores: Stores,
  n: number,
): Promise<Record<DbName, WriteTimings>> {
  const out = {} as Record<DbName, WriteTimings>;
  for (const db of DBS) {
    const store = stores[db];
    const before = await store.stats();
    const targets = await store.listUsers({
      limit: Math.max(1, Math.min(n, before.users)),
      offset: 0,
    });
    const created: User[] = [];
    const ms: Record<
      "createUser" | "follow" | "createPost" | "deleteUser",
      number[]
    > = {
      createUser: [],
      follow: [],
      createPost: [],
      deleteUser: [],
    };
    const time = async (key: keyof typeof ms, fn: () => Promise<unknown>) => {
      const start = performance.now();
      await fn();
      ms[key].push(performance.now() - start);
    };
    const tag = Date.now().toString(36);

    for (let i = 0; i < n; i++) {
      await time("createUser", async () => {
        created.push(
          await store.createUser({
            name: `Bench ${i}`,
            email: `bench.${tag}.${i}@example.com`,
            city: "Benchland",
          }),
        );
      });
    }
    for (let i = 0; i < n; i++)
      await time("follow", () =>
        store.follow(created[i]!.id, targets[i % targets.length]!.id),
      );
    for (let i = 0; i < n; i++)
      await time("createPost", () =>
        store.createPost({ authorId: created[i]!.id, body: `bench post ${i}` }),
      );
    for (let i = 0; i < n; i++)
      await time("deleteUser", () => store.deleteUser(created[i]!.id));

    const after = await store.stats();
    store.takeQueryLog();
    out[db] = {
      createUser: summarize(ms.createUser),
      follow: summarize(ms.follow),
      createPost: summarize(ms.createPost),
      deleteUser: summarize(ms.deleteUser),
      restored:
        before.users === after.users &&
        before.posts === after.posts &&
        before.follows === after.follows,
    };
    if (!out[db].restored)
      console.warn(
        `⚠ ${db}: row counts changed during the write test (${JSON.stringify(before)} → ${JSON.stringify(after)})`,
      );
  }
  return out;
}

// ───────────────────────── collection ─────────────────────────

export async function collect(
  stores: Stores,
  opts: CollectOptions,
  hooks: Hooks,
): Promise<Measurements> {
  console.log("Measuring startup ...");
  const startup = await hooks.startup();

  const sizes: SizeMeasurement[] = [];
  for (const users of opts.sizes) {
    console.log(`\n=== ${users} users ===`);
    const outcome = await runSuite(stores, {
      seed: {
        users,
        avgFollows: opts.avgFollows,
        postsPerUser: 3,
        seed: opts.seed,
      },
      runs: opts.runs,
      warmup: opts.warmup,
      depth: 3,
      limit: 10,
      ops: [...OPERATION_IDS],
      outDir: opts.outDir,
      tag: `users${users}`,
      budgetMs: opts.budgetMs,
    });
    console.log("Measuring storage ...");
    const storage = await hooks.storage();
    console.log(`Measuring writes (${opts.writeRuns} each) ...`);
    const writes = await measureWrites(stores, opts.writeRuns);
    sizes.push({
      users,
      counts: outcome.seeded!.counts,
      load: outcome.seeded!.timings,
      benchmarks: outcome.benchmarks,
      storage,
      writes,
    });
  }

  const depthSweep: Measurements["depthSweep"] = [];
  for (const depth of opts.depths) {
    console.log(
      `\n=== reachable, depth ${depth}, ${opts.sizes.at(-1)} users ===`,
    );
    const outcome = await runSuite(stores, {
      seed: null,
      runs: opts.depthRuns,
      warmup: 1,
      depth,
      limit: 10,
      ops: ["reachable"],
      outDir: opts.outDir,
      tag: `reachable-depth${depth}`,
      budgetMs: opts.budgetMs,
    });
    depthSweep.push({ depth, result: outcome.benchmarks[0]! });
  }

  return {
    generatedAt: new Date().toISOString(),
    options: opts,
    startup,
    sizes,
    depthSweep,
  };
}

// ───────────────────────── table building ─────────────────────────

type Cell = number | string | null;
interface Row {
  dimension: string;
  metric: string;
  dataset: string;
  sqlite: Cell;
  neo4j: Cell;
  unit: string;
  better: "lower" | "higher" | "none";
}
type FinalRow = Row & { winner: string; ratio: Cell };

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const find = (bs: BenchmarkResult[], op: OperationId) =>
  bs.find((b) => b.operation.id === op);
const num = (v: Cell): v is number => typeof v === "number";

function finalize(r: Row): FinalRow {
  let winner = "";
  let ratio: Cell = "";
  if (num(r.sqlite) && num(r.neo4j) && r.better !== "none") {
    const [a, b] = [r.sqlite, r.neo4j];
    if (a === b) winner = "tie";
    else {
      winner = (r.better === "lower" ? a < b : a > b) ? "sqlite" : "neo4j";
      const [hi, lo] = [Math.max(a, b), Math.min(a, b)];
      ratio = lo > 0 ? r2(hi / lo) : "";
    }
  }
  return { ...r, winner, ratio };
}

/** Statement count and size of what each driver actually executed for one run. */
function complexity(
  b: BenchmarkResult,
  db: DbName,
): { statements: number; tokens: number } | null {
  const queries = b.results[db].sample?.queries;
  if (!queries) return null;
  const statements = queries
    .filter((q) => !q.startsWith("… "))
    .map((q) => q.split("  -- params:")[0]!);
  return {
    statements: statements.length,
    tokens: statements.join(" ").split(/\s+/).filter(Boolean).length,
  };
}

const label = (b: BenchmarkResult) =>
  b.operation.id === "reachable"
    ? `reachable (depth ${b.request.depth})`
    : b.operation.id === "shortestPath"
      ? `shortestPath (max ${b.request.maxDepth} hops)`
      : b.operation.id;

const medianRow = (
  dimension: string,
  b: BenchmarkResult,
  dataset: string,
): Row => ({
  dimension,
  metric: `${label(b)} median`,
  dataset,
  sqlite: b.results.sqlite.timings.median,
  neo4j: b.results.neo4j.timings.median,
  unit: "ms",
  better: "lower",
});
const p95Row = (
  dimension: string,
  b: BenchmarkResult,
  dataset: string,
): Row => ({
  dimension,
  metric: `${label(b)} p95`,
  dataset,
  sqlite: b.results.sqlite.timings.p95,
  neo4j: b.results.neo4j.timings.p95,
  unit: "ms",
  better: "lower",
});
const tailRow = (
  dimension: string,
  b: BenchmarkResult,
  dataset: string,
): Row => {
  const t = (db: DbName) =>
    b.results[db].timings.median > 0
      ? r2(b.results[db].timings.p95 / b.results[db].timings.median)
      : null;
  return {
    dimension,
    metric: `${label(b)} p95 / median`,
    dataset,
    sqlite: t("sqlite"),
    neo4j: t("neo4j"),
    unit: "×",
    better: "lower",
  };
};
const perSecond = (count: number, ms: number): number | null =>
  ms > 0 ? Math.round(count / (ms / 1000)) : null;

export function buildTables(m: Measurements): {
  summary: FinalRow[];
  detail: FinalRow[];
} {
  const L = m.sizes.at(-1)!;
  const S = m.sizes[0]!;
  const ds = `${L.users} users`;
  const summary: Row[] = [];
  const detail: Row[] = [];

  // — query speed by category (largest dataset)
  const groups: [string, OperationId[]][] = [
    ["Point lookups & 1-hop", ["getUser", "following", "followers"]],
    ["Aggregates", ["usersPerCity", "topFollowed"]],
    ["Bounded multi-hop", ["recommend", "mutualFollows", "timeline"]],
    ["Deep traversal", ["reachable", "shortestPath"]],
  ];
  for (const [dimension, ops] of groups) {
    for (const op of ops) {
      const b = find(L.benchmarks, op);
      if (b) summary.push(medianRow(dimension, b, ds));
    }
  }
  const deepest = m.depthSweep.at(-1);
  const addUnique = (row: Row) => {
    if (
      !summary.some(
        (r) => r.dimension === row.dimension && r.metric === row.metric,
      )
    )
      summary.push(row);
  };
  if (deepest) addUnique(medianRow("Deep traversal", deepest.result, ds));

  // — tail latency
  for (const op of ["shortestPath", "recommend"] as OperationId[]) {
    const b = find(L.benchmarks, op);
    if (b) summary.push(tailRow("Tail latency", b, ds));
  }
  if (deepest) addUnique(tailRow("Tail latency", deepest.result, ds));

  // — bulk load
  const loadRows = (size: SizeMeasurement, into: Row[]) => {
    const phases: [string, number, keyof LoadTimings][] = [
      ["users", size.counts.users, "usersMs"],
      ["posts", size.counts.posts, "postsMs"],
      ["follows", size.counts.follows, "followsMs"],
    ];
    for (const [name, count, key] of phases) {
      into.push({
        dimension: "Bulk load",
        metric: `load ${name}`,
        dataset: `${size.users} users`,
        sqlite: perSecond(count, size.load.sqlite[key]),
        neo4j: perSecond(count, size.load.neo4j[key]),
        unit: "rows/s",
        better: "higher",
      });
    }
    into.push({
      dimension: "Bulk load",
      metric: "load total time",
      dataset: `${size.users} users`,
      sqlite: size.load.sqlite.totalMs,
      neo4j: size.load.neo4j.totalMs,
      unit: "ms",
      better: "lower",
    });
  };
  loadRows(L, summary);

  // — writes
  const writeRows = (size: SizeMeasurement, into: Row[]) => {
    for (const op of [
      "createUser",
      "follow",
      "createPost",
      "deleteUser",
    ] as const) {
      into.push({
        dimension: "Writes",
        metric: `${op}${op === "deleteUser" ? " (cascade)" : ""} median`,
        dataset: `${size.users} users`,
        sqlite: size.writes.sqlite[op].median,
        neo4j: size.writes.neo4j[op].median,
        unit: "ms",
        better: "lower",
      });
    }
  };
  writeRows(L, summary);

  // — storage and startup
  const storageRow = (size: SizeMeasurement): Row => ({
    dimension: "Storage footprint",
    metric: "on-disk size (store files)",
    dataset: `${size.users} users`,
    sqlite: size.storage.sqliteMb,
    neo4j: size.storage.neo4jMb,
    unit: "MB",
    better: "lower",
  });
  summary.push(storageRow(L));
  summary.push({
    dimension: "Startup",
    metric: "time until ready",
    dataset: "-",
    sqlite: m.startup.sqlite === null ? null : r3(m.startup.sqlite),
    neo4j: m.startup.neo4j === null ? null : r3(m.startup.neo4j),
    unit: "ms",
    better: "lower",
  });

  // — query complexity (what was actually executed)
  const complexityRows = (bs: BenchmarkResult[], into: Row[]) => {
    for (const op of OPERATION_IDS) {
      const b = find(bs, op);
      if (!b) continue;
      const [a, n] = [complexity(b, "sqlite"), complexity(b, "neo4j")];
      into.push({
        dimension: "Query complexity",
        metric: `${op} statements`,
        dataset: "-",
        sqlite: a?.statements ?? null,
        neo4j: n?.statements ?? null,
        unit: "count",
        better: "lower",
      });
      into.push({
        dimension: "Query complexity",
        metric: `${op} size`,
        dataset: "-",
        sqlite: a?.tokens ?? null,
        neo4j: n?.tokens ?? null,
        unit: "tokens",
        better: "lower",
      });
    }
  };
  for (const op of [
    "shortestPath",
    "recommend",
    "reachable",
  ] as OperationId[]) {
    const b = find(L.benchmarks, op);
    if (!b) continue;
    const [a, n] = [complexity(b, "sqlite"), complexity(b, "neo4j")];
    summary.push({
      dimension: "Query complexity",
      metric: `${op} size`,
      dataset: "-",
      sqlite: a?.tokens ?? null,
      neo4j: n?.tokens ?? null,
      unit: "tokens",
      better: "lower",
    });
  }

  // — scaling with data size
  if (m.sizes.length > 1) {
    for (const op of [
      "getUser",
      "recommend",
      "usersPerCity",
      "reachable",
      "shortestPath",
    ] as OperationId[]) {
      const [bs, bl] = [find(S.benchmarks, op), find(L.benchmarks, op)];
      if (!bs || !bl) continue;
      const g = (db: DbName) =>
        bs.results[db].timings.median > 0
          ? r2(bl.results[db].timings.median / bs.results[db].timings.median)
          : null;
      summary.push({
        dimension: "Scaling with data size",
        metric: `${op} median growth`,
        dataset: `${S.users} → ${L.users} users`,
        sqlite: g("sqlite"),
        neo4j: g("neo4j"),
        unit: "×",
        better: "lower",
      });
    }
  }

  // ———— detail: everything, at every size
  for (const size of m.sizes) {
    const d = `${size.users} users`;
    for (const b of size.benchmarks) {
      const dim = `Query speed (${b.operation.category})`;
      detail.push(medianRow(dim, b, d), p95Row(dim, b, d), tailRow(dim, b, d));
      detail.push({
        dimension: dim,
        metric: `${label(b)} result rows`,
        dataset: d,
        sqlite: b.results.sqlite.sample?.resultCount ?? null,
        neo4j: b.results.neo4j.sample?.resultCount ?? null,
        unit: "rows",
        better: "none",
      });
    }
    loadRows(size, detail);
    writeRows(size, detail);
    detail.push(storageRow(size));
    detail.push({
      dimension: "Storage footprint",
      metric: "neo4j transaction logs",
      dataset: d,
      sqlite: null,
      neo4j: size.storage.neo4jTxLogMb,
      unit: "MB",
      better: "none",
    });
  }
  for (const { depth, result } of m.depthSweep) {
    const dim = "Deep traversal by depth";
    detail.push(medianRow(dim, result, ds), p95Row(dim, result, ds));
    detail.push({
      dimension: dim,
      metric: `reachable (depth ${depth}) result rows`,
      dataset: ds,
      sqlite: result.results.sqlite.sample?.resultCount ?? null,
      neo4j: result.results.neo4j.sample?.resultCount ?? null,
      unit: "rows",
      better: "none",
    });
  }
  complexityRows(L.benchmarks, detail);
  // rows that only exist in the summary
  detail.push(
    ...summary.filter(
      (r) =>
        r.dimension === "Startup" || r.dimension === "Scaling with data size",
    ),
  );

  return { summary: summary.map(finalize), detail: detail.map(finalize) };
}

const COLUMNS = [
  "dimension",
  "metric",
  "dataset",
  "sqlite",
  "neo4j",
  "unit",
  "winner",
  "ratio",
] as const;
const csvCell = (v: Cell) => {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows: FinalRow[]) =>
  [
    COLUMNS.join(","),
    ...rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(",")),
  ].join("\n") + "\n";

// ───────────────────────── real hooks (Docker + filesystem) ─────────────────────────

function sh(cmd: string[]): { ok: boolean; out: string } {
  try {
    const p = Bun.spawnSync(cmd, { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    return { ok: p.success, out: p.stdout.toString() };
  } catch {
    return { ok: false, out: "" };
  }
}

const duMb = (dir: string): number | null => {
  const r = sh(["docker", "compose", "exec", "-T", "neo4j", "du", "-sk", dir]);
  const kb = Number(r.out.split(/\s+/)[0]);
  return r.ok && Number.isFinite(kb) ? r2(kb / 1024) : null;
};

const realHooks: Hooks = {
  async startup() {
    const t0 = performance.now();
    const sqlite = new SqliteStore(config.sqlitePath);
    await sqlite.init();
    await sqlite.close();
    const sqliteMs = performance.now() - t0;

    // Neo4j: time from "container started" until it accepts queries.
    if (!sh(["docker", "compose", "restart", "neo4j"]).ok) {
      console.warn(
        "⚠ Could not restart the Neo4j container; startup time not measured.",
      );
      return { sqlite: sqliteMs, neo4j: null };
    }
    const t1 = performance.now();
    const neo = new Neo4jStore(config.neo4j);
    try {
      while (performance.now() - t1 < 180_000) {
        try {
          await neo.init();
          return { sqlite: sqliteMs, neo4j: performance.now() - t1 };
        } catch {
          await sleep(500);
        }
      }
      return { sqlite: sqliteMs, neo4j: null };
    } finally {
      await neo.close();
    }
  },

  async storage() {
    let sqliteMb: number | null = null;
    if (config.sqlitePath !== ":memory:" && existsSync(config.sqlitePath)) {
      try {
        const db = new Database(config.sqlitePath);
        db.run("PRAGMA wal_checkpoint(TRUNCATE)"); // fold the WAL into the main file
        db.close();
      } catch {
        /* measure what is on disk anyway */
      }
      const bytes = [config.sqlitePath, `${config.sqlitePath}-wal`]
        .filter(existsSync)
        .reduce((sum, f) => sum + statSync(f).size, 0);
      sqliteMb = r2(bytes / 1048576);
    }
    // Ask Neo4j to flush to its store files first; harmless if the procedure is unavailable.
    sh([
      "docker",
      "compose",
      "exec",
      "-T",
      "neo4j",
      "cypher-shell",
      "-u",
      config.neo4j.user,
      "-p",
      config.neo4j.password,
      "-d",
      config.neo4j.database,
      "CALL db.checkpoint()",
    ]);
    return {
      sqliteMb,
      neo4jMb: duMb(`/data/databases/${config.neo4j.database}`),
      neo4jTxLogMb: duMb(`/data/transactions/${config.neo4j.database}`),
    };
  },
};

// ───────────────────────── CLI ─────────────────────────

const USAGE = `Usage: bun run gen-table [options]

  --sizes a,b,c     dataset sizes in users (default 1000,10000,100000)
  --runs N          timed runs per operation (default 30)
  --warmup N        untimed warm-up runs (default 3)
  --depths a,b,c    'reachable' depths to sweep on the largest size (default 1,2,3,4,5,6)
  --depth-runs N    runs per depth (default 10)
  --write-runs N    operations per write test (default 200)
  --avg-follows N   average follows per user (default 10)
  --seed N          PRNG seed (default 42)
  --budget N        seconds per operation before it stops starting runs (default 180)
  --skip-startup    don't restart the Neo4j container to time its startup
  --wait N          seconds to wait for Neo4j to come up (default 90)
  --help

Reseeds (wipes) both databases for every size.
`;

const list = (s: string) => s.split(",").map((x) => Number(x.trim()));
const positive = (name: string, xs: number[]) => {
  if (xs.length === 0 || xs.some((x) => !Number.isInteger(x) || x < 1))
    throw new Error(`--${name} must be positive integers`);
  return xs;
};

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== "--"),
    options: {
      sizes: { type: "string" },
      runs: { type: "string" },
      warmup: { type: "string" },
      depths: { type: "string" },
      "depth-runs": { type: "string" },
      "write-runs": { type: "string" },
      "avg-follows": { type: "string" },
      seed: { type: "string" },
      budget: { type: "string" },
      "skip-startup": { type: "boolean" },
      wait: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(ROOT, "results", `table-${stamp}`);
  mkdirSync(outDir, { recursive: true });

  const opts: CollectOptions = {
    sizes: positive("sizes", list(values.sizes ?? "1000,10000,100000")).sort(
      (a, b) => a - b,
    ),
    runs: Number(values.runs ?? 30),
    warmup: Number(values.warmup ?? 3),
    depths: positive("depths", list(values.depths ?? "1,2,3,4,5,6")).sort(
      (a, b) => a - b,
    ),
    depthRuns: Number(values["depth-runs"] ?? 10),
    writeRuns: Number(values["write-runs"] ?? 200),
    avgFollows: Number(values["avg-follows"] ?? 10),
    seed: Number(values.seed ?? 42),
    budgetMs: Number(values.budget ?? 180) * 1000,
    outDir,
  };

  const stores = createStores(config);
  try {
    await initWithRetry(stores, Number(values.wait ?? 90));
    const hooks: Hooks = values["skip-startup"]
      ? { ...realHooks, startup: async () => ({ sqlite: null, neo4j: null }) }
      : realHooks;
    const m = await collect(stores, opts, hooks);

    const { summary, detail } = buildTables(m);
    writeFileSync(path.join(outDir, "table_summary.csv"), toCsv(summary));
    writeFileSync(path.join(outDir, "table_detail.csv"), toCsv(detail));
    writeFileSync(
      path.join(outDir, "measurements.json"),
      JSON.stringify(m, null, 2),
    );

    console.log("\n=== Summary ===");
    console.table(
      summary.map(
        ({ dimension, metric, sqlite, neo4j, unit, winner, ratio }) => ({
          dimension,
          metric,
          sqlite,
          neo4j,
          unit,
          winner,
          ratio,
        }),
      ),
    );
    console.log(
      `\nSaved to ${outDir}\n  table_summary.csv\n  table_detail.csv\n  measurements.json`,
    );
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
