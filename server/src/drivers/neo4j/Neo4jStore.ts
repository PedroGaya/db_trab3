import type { Driver, ManagedTransaction, QueryResult } from "neo4j-driver";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../model/errors";
import { buildPost, buildUser, now } from "../../model/factory";
import type { DataStore } from "../../model/DataStore";
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
} from "../../model/types";
import { BULK_CHUNK, QueryLog, chunk } from "../shared";
import {
  createNeo4jDriver,
  int,
  type Neo4jConnectionConfig,
} from "./connection";
import { Q } from "./cypher";
import { toNumber, toPost, toUser } from "./mappers";
import { SCHEMA_STATEMENTS } from "./schema";

type Params = Record<string, unknown>;

const NEO4J_BULK_CHUNK = BULK_CHUNK * 4;

const CONSTRAINT_VIOLATION =
  "Neo.ClientError.Schema.ConstraintValidationFailed";

export class Neo4jStore implements DataStore {
  readonly name = "neo4j" as const;
  private readonly log = new QueryLog();
  private readonly driver: Driver;
  private readonly database: string;

  constructor(config: Neo4jConnectionConfig) {
    this.driver = createNeo4jDriver(config);
    this.database = config.database;
  }

  async init(): Promise<void> {
    await this.driver.verifyConnectivity({ database: this.database });
    for (const statement of SCHEMA_STATEMENTS) await this.runAuto(statement);
    this.log.take();
  }

  async close(): Promise<void> {
    await this.driver.close();
  }

  async reset(): Promise<void> {
    await this.runAuto(Q.reset);
  }

  async stats(): Promise<Stats> {
    const { records } = await this.read(Q.stats);
    const r = records[0]!;
    return {
      users: toNumber(r.get("users")),
      posts: toNumber(r.get("posts")),
      follows: toNumber(r.get("follows")),
    };
  }

  takeQueryLog(): string[] {
    return this.log.take();
  }

  async createUser(input: NewUser): Promise<User> {
    const user = buildUser(input);
    await this.write(Q.createUser, { ...user });
    return user;
  }

  async getUser(id: string): Promise<User> {
    const { records } = await this.read(Q.getUser, { id });
    if (records.length === 0) throw new NotFoundError("User", id);
    return toUser(records[0]!.get("u"));
  }

  async listUsers(opts: ListUsersOpts): Promise<User[]> {
    const params: Params = { limit: int(opts.limit), offset: int(opts.offset) };
    if (opts.city) params.city = opts.city;
    const { records } = await this.read(
      opts.city ? Q.listUsersByCity : Q.listUsers,
      params,
    );
    return records.map((r) => toUser(r.get("u")));
  }

  async updateUser(id: string, patch: UpdateUser): Promise<User> {
    if (Object.keys(patch).length === 0) return this.getUser(id);
    const { records } = await this.write(Q.updateUser, { id, patch });
    if (records.length === 0) throw new NotFoundError("User", id);
    return toUser(records[0]!.get("u"));
  }

  async deleteUser(id: string): Promise<void> {
    const { summary } = await this.write(Q.deleteUser, { id });
    if (summary.counters.updates().nodesDeleted === 0)
      throw new NotFoundError("User", id);
  }

  async createPost(input: NewPost): Promise<Post> {
    const post = buildPost(input);
    const { records } = await this.write(Q.createPost, { ...post });
    if (records.length === 0) throw new NotFoundError("User", input.authorId);
    return post;
  }

  async listPostsByUser(userId: string, limit: number): Promise<Post[]> {
    const { records } = await this.read(Q.postsByUser, {
      id: userId,
      limit: int(limit),
    });
    if (records.length === 0) await this.requireUser(userId);
    return records.map(toPost);
  }

  async timeline(userId: string, limit: number): Promise<Post[]> {
    const { records } = await this.read(Q.timeline, {
      id: userId,
      limit: int(limit),
    });
    if (records.length === 0) await this.requireUser(userId);
    return records.map(toPost);
  }

  async follow(followerId: string, followeeId: string): Promise<void> {
    if (followerId === followeeId)
      throw new ValidationError("A user cannot follow themselves");
    const { records } = await this.write(Q.follow, {
      followerId,
      followeeId,
      since: now(),
    });
    if (records.length === 0) {
      await this.requireUser(followerId);
      await this.requireUser(followeeId);
    }
  }

  async unfollow(followerId: string, followeeId: string): Promise<void> {
    await this.write(Q.unfollow, { followerId, followeeId });
  }

  async followers(userId: string): Promise<User[]> {
    const { records } = await this.read(Q.followers, { id: userId });
    if (records.length === 0) await this.requireUser(userId);
    return records.map((r) => toUser(r.get("u")));
  }

  async following(userId: string): Promise<User[]> {
    const { records } = await this.read(Q.following, { id: userId });
    if (records.length === 0) await this.requireUser(userId);
    return records.map((r) => toUser(r.get("u")));
  }

  async reachableWithin(userId: string, depth: number): Promise<User[]> {
    const { records } = await this.read(Q.reachableWithin(depth), {
      id: userId,
    });
    if (records.length === 0) await this.requireUser(userId);
    return records.map((r) => toUser(r.get("u")));
  }

  async shortestPath(
    fromId: string,
    toId: string,
    maxDepth: number,
  ): Promise<PathResult | null> {
    if (fromId === toId) {
      await this.requireUser(fromId);
      return { path: [fromId], length: 0 };
    }
    const { records } = await this.read(Q.shortestPath(maxDepth), {
      from: fromId,
      to: toId,
    });
    const hit = records[0];
    if (!hit) {
      await this.requireUser(fromId);
      await this.requireUser(toId);
      return null;
    }
    return {
      path: hit.get("path") as string[],
      length: toNumber(hit.get("hops")),
    };
  }

  async recommend(userId: string, limit: number): Promise<Recommendation[]> {
    const { records } = await this.read(Q.recommend, {
      id: userId,
      limit: int(limit),
    });
    if (records.length === 0) await this.requireUser(userId);
    return records.map((r) => ({
      user: toUser(r.get("u")),
      mutualCount: toNumber(r.get("mutualCount")),
    }));
  }

  async mutualFollows(a: string, b: string): Promise<User[]> {
    const { records } = await this.read(Q.mutualFollows, { a, b });
    if (records.length === 0) {
      await this.requireUser(a);
      await this.requireUser(b);
    }
    return records.map((r) => toUser(r.get("u")));
  }

  async usersPerCity(): Promise<CityCount[]> {
    const { records } = await this.read(Q.usersPerCity);
    return records.map((r) => ({
      city: r.get("city") as string,
      count: toNumber(r.get("cnt")),
    }));
  }

  async topFollowed(limit: number): Promise<FollowedUser[]> {
    const { records } = await this.read(Q.topFollowed, { limit: int(limit) });
    return records.map((r) => ({
      user: toUser(r.get("u")),
      followers: toNumber(r.get("followers")),
    }));
  }

  async bulkInsertUsers(users: User[]): Promise<void> {
    for (const rows of chunk(users, NEO4J_BULK_CHUNK))
      await this.write(Q.bulkUsers, { rows });
  }

  async bulkInsertPosts(posts: Post[]): Promise<void> {
    for (const rows of chunk(posts, NEO4J_BULK_CHUNK))
      await this.write(Q.bulkPosts, { rows });
  }

  async bulkInsertFollows(follows: Follow[]): Promise<void> {
    for (const rows of chunk(follows, NEO4J_BULK_CHUNK))
      await this.write(Q.bulkFollows, { rows });
  }

  private read(cypher: string, params: Params = {}): Promise<QueryResult> {
    return this.exec("read", cypher, params);
  }

  private write(cypher: string, params: Params = {}): Promise<QueryResult> {
    return this.exec("write", cypher, params);
  }

  private async exec(
    mode: "read" | "write",
    cypher: string,
    params: Params,
  ): Promise<QueryResult> {
    this.log.record(cypher, params);
    const session = this.driver.session({ database: this.database });
    try {
      const work = (tx: ManagedTransaction) =>
        tx.run(cypher, params).then((r) => r);
      return mode === "read"
        ? await session.executeRead(work)
        : await session.executeWrite(work);
    } catch (e) {
      throw this.translate(e);
    } finally {
      await session.close();
    }
  }

  private async runAuto(cypher: string): Promise<void> {
    this.log.record(cypher);
    const session = this.driver.session({ database: this.database });
    try {
      await session.run(cypher);
    } finally {
      await session.close();
    }
  }

  private translate(e: unknown): unknown {
    if ((e as { code?: string })?.code === CONSTRAINT_VIOLATION) {
      const message = (e as Error).message;
      return new ConflictError(
        /email/i.test(message)
          ? "Email is already in use"
          : "A record with this id already exists",
      );
    }
    return e;
  }

  private async requireUser(id: string): Promise<void> {
    const { records } = await this.read(Q.userExists, { id });
    if (records.length === 0) throw new NotFoundError("User", id);
  }
}
