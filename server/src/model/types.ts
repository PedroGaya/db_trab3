import type { z } from "zod";
import type {
  BenchmarkRequestSchema,
  DbNameSchema,
  FollowSchema,
  ListUsersOptsSchema,
  NewPostSchema,
  NewUserSchema,
  OperationIdSchema,
  PostSchema,
  SeedRequestSchema,
  UpdateUserSchema,
  UserSchema,
} from "./schemas";

// entities
export type User = z.infer<typeof UserSchema>;
export type Post = z.infer<typeof PostSchema>;
export type Follow = z.infer<typeof FollowSchema>;

// inputs
export type NewUser = z.infer<typeof NewUserSchema>;
export type UpdateUser = z.infer<typeof UpdateUserSchema>;
export type NewPost = z.infer<typeof NewPostSchema>;
export type ListUsersOpts = z.infer<typeof ListUsersOptsSchema>;
export type SeedRequest = z.infer<typeof SeedRequestSchema>;

export type DbName = z.infer<typeof DbNameSchema>;

// query results
export interface PathResult {
  path: string[];
  length: number;
}

export interface Recommendation {
  user: User;
  mutualCount: number;
}

export interface Stats {
  users: number;
  posts: number;
  follows: number;
}

export interface CityCount {
  city: string;
  count: number;
}

export interface FollowedUser {
  user: User;
  followers: number;
}

// benchmark
export type OperationId = z.infer<typeof OperationIdSchema>;
export type BenchmarkRequest = z.infer<typeof BenchmarkRequestSchema>;
export type OperationCategory = "point" | "traversal" | "aggregate";
export type OperationParam = "user" | "other" | "depth" | "maxDepth" | "limit";

export interface OperationInfo {
  id: OperationId;
  label: string;
  category: OperationCategory;
  description: string;
  uses: OperationParam[];
}

export interface TimingStats {
  count: number;
  min: number;
  median: number;
  mean: number;
  p95: number;
  max: number;
}

export interface DbBenchmark {
  timings: TimingStats;
  runsMs: number[];
  errors: number;
  firstError: string | null;
  sample: {
    result: unknown;
    resultCount: number;
    truncated: boolean;
    queries: string[];
  } | null;
}

export interface BenchmarkResult {
  operation: OperationInfo;
  request: BenchmarkRequest;
  dataset: Stats;
  input: Record<string, unknown>;
  runsCompleted: number;
  budgetExceeded: boolean;
  equivalence: {
    equal: boolean;
    mismatchedRuns: number;
    first: { run: number; reason: string } | null;
  };
  results: Record<DbName, DbBenchmark>;
  comparison: { fasterDb: DbName | "tie"; speedup: number };
}
