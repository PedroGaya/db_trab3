import type { DataStore } from "../model/DataStore";
import type {
  OperationCategory,
  OperationId,
  OperationInfo,
  OperationParam,
  PathResult,
} from "../model/types";

export interface OpContext {
  user: string;
  other: string;
  depth: number;
  maxDepth: number;
  limit: number;
}

interface Operation {
  label: string;
  category: OperationCategory;
  description: string;
  uses: OperationParam[];
  run(store: DataStore, ctx: OpContext): Promise<unknown>;
  comparable?(result: unknown): unknown;
}

export const OPERATIONS: Record<OperationId, Operation> = {
  getUser: {
    label: "Get user by id",
    category: "point",
    description: "Single-record lookup by unique id.",
    uses: ["user"],
    run: (s, c) => s.getUser(c.user),
  },
  following: {
    label: "Who a user follows (1 hop out)",
    category: "traversal",
    description: "Direct outgoing follows of one user.",
    uses: ["user"],
    run: (s, c) => s.following(c.user),
  },
  followers: {
    label: "A user’s followers (1 hop in)",
    category: "traversal",
    description: "Direct incoming follows of one user.",
    uses: ["user"],
    run: (s, c) => s.followers(c.user),
  },
  mutualFollows: {
    label: "Mutual follows",
    category: "traversal",
    description: "Users that two given users both follow.",
    uses: ["user", "other"],
    run: (s, c) => s.mutualFollows(c.user, c.other),
  },
  timeline: {
    label: "Timeline",
    category: "traversal",
    description:
      "Newest posts from the users a user follows (follow → authored join/traversal).",
    uses: ["user", "limit"],
    run: (s, c) => s.timeline(c.user, c.limit),
  },
  reachable: {
    label: "Reachable within N hops",
    category: "traversal",
    description: "Everyone reachable by following up to `depth` hops out.",
    uses: ["user", "depth"],
    run: (s, c) => s.reachableWithin(c.user, c.depth),
  },
  shortestPath: {
    label: "Shortest path",
    category: "traversal",
    description: "Fewest-hops follow path between two users.",
    uses: ["user", "other", "maxDepth"],
    run: (s, c) => s.shortestPath(c.user, c.other, c.maxDepth),
    comparable: (r) => (r === null ? null : (r as PathResult).length),
  },
  recommend: {
    label: "Recommendations",
    category: "traversal",
    description:
      "Friends-of-friends not yet followed, ranked by mutual connections.",
    uses: ["user", "limit"],
    run: (s, c) => s.recommend(c.user, c.limit),
  },
  usersPerCity: {
    label: "Users per city",
    category: "aggregate",
    description: "Full-scan GROUP BY / aggregation.",
    uses: [],
    run: (s) => s.usersPerCity(),
  },
  topFollowed: {
    label: "Most followed users",
    category: "aggregate",
    description: "Follower counts over every follow edge, top N.",
    uses: ["limit"],
    run: (s, c) => s.topFollowed(c.limit),
  },
};

export function operationInfo(id: OperationId): OperationInfo {
  const { label, category, description, uses } = OPERATIONS[id];
  return { id, label, category, description, uses };
}

export function listOperations(): OperationInfo[] {
  return (Object.keys(OPERATIONS) as OperationId[]).map(operationInfo);
}
