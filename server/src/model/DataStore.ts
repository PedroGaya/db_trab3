import type {
  CityCount,
  Follow,
  FollowedUser,
  ListUsersOpts,
  NewPost,
  NewUser,
  PathResult,
  Post,
  Recommendation,
  Stats,
  UpdateUser,
  User,
} from "./types";

export interface DataStore {
  readonly name: "sqlite" | "neo4j";

  init(): Promise<void>;
  close(): Promise<void>;
  reset(): Promise<void>;
  stats(): Promise<Stats>;

  takeQueryLog(): string[];

  createUser(input: NewUser): Promise<User>;
  getUser(id: string): Promise<User>;
  listUsers(opts: ListUsersOpts): Promise<User[]>;
  updateUser(id: string, patch: UpdateUser): Promise<User>;
  deleteUser(id: string): Promise<void>;

  createPost(input: NewPost): Promise<Post>;
  listPostsByUser(userId: string, limit: number): Promise<Post[]>;
  timeline(userId: string, limit: number): Promise<Post[]>;

  follow(followerId: string, followeeId: string): Promise<void>;
  unfollow(followerId: string, followeeId: string): Promise<void>;
  followers(userId: string): Promise<User[]>;
  following(userId: string): Promise<User[]>;

  reachableWithin(userId: string, depth: number): Promise<User[]>;
  shortestPath(
    fromId: string,
    toId: string,
    maxDepth: number,
  ): Promise<PathResult | null>;
  recommend(userId: string, limit: number): Promise<Recommendation[]>;
  mutualFollows(a: string, b: string): Promise<User[]>;

  usersPerCity(): Promise<CityCount[]>;
  topFollowed(limit: number): Promise<FollowedUser[]>;

  bulkInsertUsers(users: User[]): Promise<void>;
  bulkInsertPosts(posts: Post[]): Promise<void>;
  bulkInsertFollows(follows: Follow[]): Promise<void>;
}
