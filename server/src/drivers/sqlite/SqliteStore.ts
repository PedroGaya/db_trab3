import type { Knex } from "knex";
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
import { createKnex } from "./connection";
import { migrationSource } from "./migrations";

interface UserRow {
  id: string;
  name: string;
  email: string;
  city: string;
  created_at: string;
}
interface PostRow {
  id: string;
  author_id: string;
  body: string;
  created_at: string;
}

const toUser = (r: UserRow): User => ({
  id: r.id,
  name: r.name,
  email: r.email,
  city: r.city,
  createdAt: r.created_at,
});
const toPost = (r: PostRow): Post => ({
  id: r.id,
  authorId: r.author_id,
  body: r.body,
  createdAt: r.created_at,
});

const errorText = (e: unknown): string =>
  `${(e as { code?: string })?.code ?? ""} ${(e as Error)?.message ?? ""}`;
const isUniqueViolation = (e: unknown) =>
  /UNIQUE|PRIMARYKEY/i.test(errorText(e));
const isForeignKeyViolation = (e: unknown) =>
  /FOREIGN\s?KEY/i.test(errorText(e));

export class SqliteStore implements DataStore {
  readonly name = "sqlite" as const;
  private readonly log = new QueryLog();
  private readonly db: Knex;

  constructor(filename: string) {
    this.db = createKnex(filename, this.log);
  }

  async init(): Promise<void> {
    await this.db.migrate.latest({ migrationSource });
    this.log.take();
  }

  async close(): Promise<void> {
    await this.db.destroy();
  }

  async reset(): Promise<void> {
    await this.db.transaction(async (trx) => {
      await trx("follows").del();
      await trx("posts").del();
      await trx("users").del();
    });
  }

  async stats(): Promise<Stats> {
    const rows = await this.raw<Stats>(
      `SELECT (SELECT COUNT(*) FROM users)   AS users,
              (SELECT COUNT(*) FROM posts)   AS posts,
              (SELECT COUNT(*) FROM follows) AS follows`,
    );
    return rows[0]!;
  }

  takeQueryLog(): string[] {
    return this.log.take();
  }

  async createUser(input: NewUser): Promise<User> {
    const user = buildUser(input);
    try {
      await this.db("users").insert({
        id: user.id,
        name: user.name,
        email: user.email,
        city: user.city,
        created_at: user.createdAt,
      });
    } catch (e) {
      if (isUniqueViolation(e))
        throw new ConflictError(`Email '${user.email}' is already in use`);
      throw e;
    }
    return user;
  }

  async getUser(id: string): Promise<User> {
    const row = await this.db<UserRow>("users").where({ id }).first();
    if (!row) throw new NotFoundError("User", id);
    return toUser(row);
  }

  async listUsers(opts: ListUsersOpts): Promise<User[]> {
    const q = this.db<UserRow>("users")
      .select("*")
      .orderBy("id")
      .limit(opts.limit)
      .offset(opts.offset);
    if (opts.city) q.where("city", opts.city);
    return (await q).map(toUser);
  }

  async updateUser(id: string, patch: UpdateUser): Promise<User> {
    if (Object.keys(patch).length > 0) {
      let changed: number;
      try {
        changed = await this.db("users").where({ id }).update(patch);
      } catch (e) {
        if (isUniqueViolation(e))
          throw new ConflictError(`Email '${patch.email}' is already in use`);
        throw e;
      }
      if (changed === 0) throw new NotFoundError("User", id);
    }
    return this.getUser(id);
  }

  async deleteUser(id: string): Promise<void> {
    const deleted = await this.db("users").where({ id }).del();
    if (deleted === 0) throw new NotFoundError("User", id);
  }

  async createPost(input: NewPost): Promise<Post> {
    const post = buildPost(input);
    try {
      await this.db("posts").insert({
        id: post.id,
        author_id: post.authorId,
        body: post.body,
        created_at: post.createdAt,
      });
    } catch (e) {
      if (isForeignKeyViolation(e))
        throw new NotFoundError("User", input.authorId);
      throw e;
    }
    return post;
  }

  async listPostsByUser(userId: string, limit: number): Promise<Post[]> {
    const rows = await this.db<PostRow>("posts")
      .where({ author_id: userId })
      .orderBy([
        { column: "created_at", order: "desc" },
        { column: "id", order: "asc" },
      ])
      .limit(limit);
    if (rows.length === 0) await this.requireUser(userId);
    return rows.map(toPost);
  }

  async timeline(userId: string, limit: number): Promise<Post[]> {
    const rows = await this.raw<PostRow>(
      `SELECT p.*
         FROM follows f
         JOIN posts p ON p.author_id = f.followee_id
        WHERE f.follower_id = ?
        ORDER BY p.created_at DESC, p.id
        LIMIT ?`,
      [userId, limit],
    );
    if (rows.length === 0) await this.requireUser(userId);
    return rows.map(toPost);
  }

  async follow(followerId: string, followeeId: string): Promise<void> {
    if (followerId === followeeId)
      throw new ValidationError("A user cannot follow themselves");
    try {
      await this.db("follows")
        .insert({
          follower_id: followerId,
          followee_id: followeeId,
          since: now(),
        })
        .onConflict(["follower_id", "followee_id"])
        .ignore();
    } catch (e) {
      if (isForeignKeyViolation(e)) {
        await this.requireUser(followerId);
        await this.requireUser(followeeId);
      }
      throw e;
    }
  }

  async unfollow(followerId: string, followeeId: string): Promise<void> {
    await this.db("follows")
      .where({ follower_id: followerId, followee_id: followeeId })
      .del();
  }

  async followers(userId: string): Promise<User[]> {
    const rows = await this.raw<UserRow>(
      `SELECT u.* FROM follows f JOIN users u ON u.id = f.follower_id
        WHERE f.followee_id = ? ORDER BY u.id`,
      [userId],
    );
    if (rows.length === 0) await this.requireUser(userId);
    return rows.map(toUser);
  }

  async following(userId: string): Promise<User[]> {
    const rows = await this.raw<UserRow>(
      `SELECT u.* FROM follows f JOIN users u ON u.id = f.followee_id
        WHERE f.follower_id = ? ORDER BY u.id`,
      [userId],
    );
    if (rows.length === 0) await this.requireUser(userId);
    return rows.map(toUser);
  }

  async reachableWithin(userId: string, depth: number): Promise<User[]> {
    const rows = await this.raw<UserRow>(
      `WITH RECURSIVE walk(node, depth) AS (
         SELECT ?, 0
         UNION
         SELECT f.followee_id, w.depth + 1
           FROM walk w JOIN follows f ON f.follower_id = w.node
          WHERE w.depth < ?
       )
       SELECT u.* FROM users u
        WHERE u.id IN (SELECT node FROM walk WHERE depth > 0) AND u.id <> ?
        ORDER BY u.id`,
      [userId, depth, userId],
    );
    if (rows.length === 0) await this.requireUser(userId);
    return rows.map(toUser);
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
    const rows = await this.raw<{ path: string; depth: number }>(
      `WITH RECURSIVE walk(node, depth, path) AS (
         SELECT ?, 0, ?
         UNION ALL
         SELECT f.followee_id, w.depth + 1, w.path || ',' || f.followee_id
           FROM walk w JOIN follows f ON f.follower_id = w.node
          WHERE w.node <> ? AND w.depth < ? AND instr(w.path, f.followee_id) = 0
       )
       SELECT path, depth FROM walk WHERE node = ? LIMIT 1`,
      [fromId, fromId, toId, maxDepth, toId],
    );
    const hit = rows[0];
    if (!hit) {
      await this.requireUser(fromId);
      await this.requireUser(toId);
      return null;
    }
    return { path: hit.path.split(","), length: hit.depth };
  }

  async recommend(userId: string, limit: number): Promise<Recommendation[]> {
    const rows = await this.raw<UserRow & { mutual_count: number }>(
      `SELECT u.*, COUNT(*) AS mutual_count
         FROM follows f1
         JOIN follows f2 ON f2.follower_id = f1.followee_id
         JOIN users u    ON u.id = f2.followee_id
        WHERE f1.follower_id = ?
          AND f2.followee_id <> ?
          AND NOT EXISTS (SELECT 1 FROM follows f3
                           WHERE f3.follower_id = ? AND f3.followee_id = f2.followee_id)
        GROUP BY u.id
        ORDER BY mutual_count DESC, u.id
        LIMIT ?`,
      [userId, userId, userId, limit],
    );
    if (rows.length === 0) await this.requireUser(userId);
    return rows.map((r) => ({
      user: toUser(r),
      mutualCount: Number(r.mutual_count),
    }));
  }

  async mutualFollows(a: string, b: string): Promise<User[]> {
    const rows = await this.raw<UserRow>(
      `SELECT u.*
         FROM follows fa
         JOIN follows fb ON fb.followee_id = fa.followee_id
         JOIN users u    ON u.id = fa.followee_id
        WHERE fa.follower_id = ? AND fb.follower_id = ?
        ORDER BY u.id`,
      [a, b],
    );
    if (rows.length === 0) {
      await this.requireUser(a);
      await this.requireUser(b);
    }
    return rows.map(toUser);
  }

  async usersPerCity(): Promise<CityCount[]> {
    const rows = await this.raw<{ city: string; count: number }>(
      `SELECT city, COUNT(*) AS count FROM users GROUP BY city ORDER BY count DESC, city`,
    );
    return rows.map((r) => ({ city: r.city, count: Number(r.count) }));
  }

  async topFollowed(limit: number): Promise<FollowedUser[]> {
    const rows = await this.raw<UserRow & { followers: number }>(
      `SELECT u.*, COUNT(*) AS followers
         FROM follows f JOIN users u ON u.id = f.followee_id
        GROUP BY u.id
        ORDER BY followers DESC, u.id
        LIMIT ?`,
      [limit],
    );
    return rows.map((r) => ({
      user: toUser(r),
      followers: Number(r.followers),
    }));
  }

  async bulkInsertUsers(users: User[]): Promise<void> {
    try {
      await this.db.transaction(async (trx) => {
        for (const rows of chunk(users, BULK_CHUNK)) {
          await trx("users").insert(
            rows.map((u) => ({
              id: u.id,
              name: u.name,
              email: u.email,
              city: u.city,
              created_at: u.createdAt,
            })),
          );
        }
      });
    } catch (e) {
      if (isUniqueViolation(e))
        throw new ConflictError("Bulk insert contains a duplicate id or email");
      throw e;
    }
  }

  async bulkInsertPosts(posts: Post[]): Promise<void> {
    await this.db.transaction(async (trx) => {
      for (const rows of chunk(posts, BULK_CHUNK)) {
        await trx("posts").insert(
          rows.map((p) => ({
            id: p.id,
            author_id: p.authorId,
            body: p.body,
            created_at: p.createdAt,
          })),
        );
      }
    });
  }

  async bulkInsertFollows(follows: Follow[]): Promise<void> {
    await this.db.transaction(async (trx) => {
      for (const rows of chunk(follows, BULK_CHUNK)) {
        await trx("follows")
          .insert(
            rows.map((f) => ({
              follower_id: f.followerId,
              followee_id: f.followeeId,
              since: f.since,
            })),
          )
          .onConflict(["follower_id", "followee_id"])
          .ignore();
      }
    });
  }

  private async raw<T>(
    sql: string,
    bindings: Knex.RawBinding[] = [],
  ): Promise<T[]> {
    return (await this.db.raw(sql, bindings)) as T[];
  }

  private async requireUser(id: string): Promise<void> {
    const row = await this.db("users").where({ id }).first("id");
    if (!row) throw new NotFoundError("User", id);
  }
}
