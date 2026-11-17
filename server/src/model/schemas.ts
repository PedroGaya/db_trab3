import { z } from "zod";

export const DB_NAMES = ["sqlite", "neo4j"] as const;
export const DbNameSchema = z.enum(DB_NAMES);

export const MAX_DEPTH = 6;

const id = z.guid();
const timestamp = z.iso.datetime();
const text = (max: number) => z.string().trim().min(1).max(max);

export const UserSchema = z.object({
  id,
  name: text(100),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  city: text(100),
  createdAt: timestamp,
});

export const PostSchema = z.object({
  id,
  authorId: id,
  body: text(280),
  createdAt: timestamp,
});

export const FollowSchema = z.object({
  followerId: id,
  followeeId: id,
  since: timestamp,
});

export const NewUserSchema = UserSchema.pick({
  name: true,
  email: true,
  city: true,
});

export const UpdateUserSchema = NewUserSchema.partial().refine(
  (patch) => Object.keys(patch).length > 0,
  { message: "Provide at least one field to update" },
);

export const NewPostSchema = PostSchema.pick({ authorId: true, body: true });

export const PostBodySchema = PostSchema.pick({ body: true });

export const IdParamSchema = z.object({ id });
export const FollowParamsSchema = z.object({ id, otherId: id });

export const ListUsersOptsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  city: text(100).optional(),
});

export const LimitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export const ReachableQuerySchema = z.object({
  depth: z.coerce.number().int().min(1).max(MAX_DEPTH).default(2),
});

export const MutualQuerySchema = z.object({ a: id, b: id });

export const PathQuerySchema = z.object({
  from: id,
  to: id,
  max: z.coerce.number().int().min(1).max(MAX_DEPTH).default(MAX_DEPTH),
});

export const SeedRequestSchema = z
  .object({
    users: z.coerce.number().int().min(1).max(100_000).default(1_000),
    avgFollows: z.coerce.number().int().min(1).max(200).default(10),
    postsPerUser: z.coerce.number().int().min(0).max(50).default(3),
    seed: z.coerce.number().int().default(42),
  })
  .refine((r) => r.users * r.avgFollows <= 2_000_000, {
    message: "users × avgFollows must not exceed 2,000,000",
  });

export const OPERATION_IDS = [
  "getUser",
  "following",
  "followers",
  "mutualFollows",
  "timeline",
  "reachable",
  "shortestPath",
  "recommend",
  "usersPerCity",
  "topFollowed",
] as const;
export const OperationIdSchema = z.enum(OPERATION_IDS);

export const BenchmarkRequestSchema = z.object({
  operation: OperationIdSchema,
  runs: z.coerce.number().int().min(1).max(500).default(20),
  warmup: z.coerce.number().int().min(0).max(50).default(3),
  depth: z.coerce.number().int().min(1).max(MAX_DEPTH).default(3),
  maxDepth: z.coerce.number().int().min(1).max(MAX_DEPTH).default(MAX_DEPTH),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  userId: id.optional(),
  otherId: id.optional(),
  budgetMs: z.coerce.number().int().min(100).max(600_000).default(60_000),
});
