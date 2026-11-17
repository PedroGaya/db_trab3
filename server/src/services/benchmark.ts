import type { Stores } from "../drivers";
import type { DataStore } from "../model/DataStore";
import { ConflictError } from "../model/errors";
import type {
  BenchmarkRequest,
  BenchmarkResult,
  DbBenchmark,
  DbName,
  TimingStats,
} from "../model/types";
import { firstDifference } from "./equivalence";
import { OPERATIONS, operationInfo, type OpContext } from "./operations";

const DB_ORDER: DbName[] = ["sqlite", "neo4j"];
const MAX_SAMPLES = 100; // distinct input users to cycle through
const PREVIEW_ITEMS = 25; // how many items of a large result are returned for display

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function summarize(values: number[]): TimingStats {
  if (values.length === 0)
    return { count: 0, min: 0, median: 0, mean: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]!;
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const median =
    sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]!
      : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
  return {
    count: sorted.length,
    min: round3(sorted[0]!),
    median: round3(median),
    mean: round3(mean),
    p95: round3(at(0.95)),
    max: round3(sorted[sorted.length - 1]!),
  };
}

interface Attempt {
  ms: number;
  result?: unknown;
  error?: string;
  queries: string[];
}

async function attempt(
  store: DataStore,
  run: () => Promise<unknown>,
): Promise<Attempt> {
  store.takeQueryLog();
  const start = performance.now();
  try {
    const result = await run();
    return {
      ms: performance.now() - start,
      result,
      queries: store.takeQueryLog(),
    };
  } catch (e) {
    return {
      ms: performance.now() - start,
      error: (e as Error).message,
      queries: store.takeQueryLog(),
    };
  }
}

async function sampleUserIds(
  store: DataStore,
  totalUsers: number,
): Promise<string[]> {
  const count = Math.min(totalUsers, MAX_SAMPLES);
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const [user] = await store.listUsers({
      limit: 1,
      offset: Math.floor((i * totalUsers) / count),
    });
    if (user) ids.push(user.id);
  }
  return ids;
}

function preview(result: unknown): {
  result: unknown;
  resultCount: number;
  truncated: boolean;
} {
  if (Array.isArray(result)) {
    const truncated = result.length > PREVIEW_ITEMS;
    return {
      result: truncated ? result.slice(0, PREVIEW_ITEMS) : result,
      resultCount: result.length,
      truncated,
    };
  }
  return {
    result,
    resultCount: result === null || result === undefined ? 0 : 1,
    truncated: false,
  };
}

let busy = false;

export async function runBenchmark(
  stores: Stores,
  req: BenchmarkRequest,
): Promise<BenchmarkResult> {
  if (busy) throw new ConflictError("A benchmark is already running");
  busy = true;
  try {
    return await execute(stores, req);
  } finally {
    busy = false;
  }
}

async function execute(
  stores: Stores,
  req: BenchmarkRequest,
): Promise<BenchmarkResult> {
  const op = OPERATIONS[req.operation];
  const dataset = await stores.sqlite.stats();
  if (dataset.users === 0)
    throw new ConflictError(
      "The databases are empty. Seed them first (POST /api/admin/seed).",
    );

  const samples = await sampleUserIds(stores.sqlite, dataset.users);
  const contextFor = (i: number): OpContext => {
    const idx = i % samples.length;
    return {
      user: req.userId ?? samples[idx]!,
      other:
        req.otherId ??
        samples[(idx + 1 + Math.floor(samples.length / 3)) % samples.length]!,
      depth: req.depth,
      maxDepth: req.maxDepth,
      limit: req.limit,
    };
  };
  const compare = op.comparable ?? ((r: unknown) => r);

  const runsMs: Record<DbName, number[]> = { sqlite: [], neo4j: [] };
  const errors: Record<DbName, { count: number; first: string | null }> = {
    sqlite: { count: 0, first: null },
    neo4j: { count: 0, first: null },
  };
  const samplesOut: Record<DbName, DbBenchmark["sample"]> = {
    sqlite: null,
    neo4j: null,
  };
  let firstInput: Record<string, unknown> = {};
  let mismatchedRuns = 0;
  let firstMismatch: { run: number; reason: string } | null = null;
  let completed = 0;
  let budgetExceeded = false;
  const startedAt = performance.now();

  for (let i = 0; i < req.warmup + req.runs; i++) {
    const timed = i >= req.warmup;
    if (
      timed &&
      completed > 0 &&
      performance.now() - startedAt > req.budgetMs
    ) {
      budgetExceeded = true;
      break;
    }

    const ctx = contextFor(i);
    // flip which database goes first on every run
    const order = i % 2 === 0 ? DB_ORDER : [...DB_ORDER].reverse();
    const attempts = {} as Record<DbName, Attempt>;
    for (const name of order)
      attempts[name] = await attempt(stores[name], () =>
        op.run(stores[name], ctx),
      );

    if (!timed) continue;

    if (completed === 0) {
      firstInput = Object.fromEntries(
        op.uses.map((p) => [
          p,
          p === "user" ? ctx.user : p === "other" ? ctx.other : ctx[p],
        ]),
      );
    }
    for (const name of DB_ORDER) {
      const a = attempts[name];
      runsMs[name].push(a.ms);
      if (a.error !== undefined) {
        errors[name].count++;
        errors[name].first ??= a.error;
      }
      if (completed === 0 && a.error === undefined) {
        samplesOut[name] = { ...preview(a.result), queries: a.queries };
      }
    }

    // A run matches when both succeed with equivalent results, or both fail.
    const [a, b] = [attempts.sqlite, attempts.neo4j];
    let reason: string | null = null;
    if ((a.error !== undefined) !== (b.error !== undefined)) {
      reason = `only ${a.error !== undefined ? "sqlite" : "neo4j"} failed: ${a.error ?? b.error}`;
    } else if (a.error === undefined) {
      reason = firstDifference(compare(a.result), compare(b.result));
    }
    if (reason !== null) {
      mismatchedRuns++;
      firstMismatch ??= { run: completed, reason };
    }
    completed++;
  }

  const results = Object.fromEntries(
    DB_ORDER.map((name) => [
      name,
      {
        timings: summarize(runsMs[name]),
        runsMs: runsMs[name].map(round3),
        errors: errors[name].count,
        firstError: errors[name].first,
        sample: samplesOut[name],
      } satisfies DbBenchmark,
    ]),
  ) as Record<DbName, DbBenchmark>;

  const [ms, mn] = [
    results.sqlite.timings.median,
    results.neo4j.timings.median,
  ];
  const fasterDb: DbName | "tie" =
    ms === mn ? "tie" : ms < mn ? "sqlite" : "neo4j";
  const speedup =
    fasterDb === "tie" || Math.min(ms, mn) === 0
      ? 1
      : round3(Math.max(ms, mn) / Math.min(ms, mn));

  return {
    operation: operationInfo(req.operation),
    request: req,
    dataset,
    input: firstInput,
    runsCompleted: completed,
    budgetExceeded,
    equivalence: {
      equal: mismatchedRuns === 0,
      mismatchedRuns,
      first: firstMismatch,
    },
    results,
    comparison: { fasterDb, speedup },
  };
}
