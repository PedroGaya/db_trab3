/**
 * Graph model:
 *   (:User {id, name, email, city, createdAt})
 *   (:Post {id, body, createdAt})
 *   (:User)-[:AUTHORED]->(:Post)
 *   (:User)-[:FOLLOWS {since}]->(:User)
 */

function assertDepth(n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > 20)
    throw new RangeError(`Invalid depth: ${n}`);
  return n;
}

export const Q = {
  stats: `
    MATCH (u:User) WITH count(u) AS users
    MATCH (p:Post) WITH users, count(p) AS posts
    MATCH ()-[f:FOLLOWS]->()
    RETURN users, posts, count(f) AS follows`,
  reset: `MATCH (n) CALL { WITH n DETACH DELETE n } IN TRANSACTIONS OF 10000 ROWS`,

  createUser: `
    CREATE (u:User {id: $id, name: $name, email: $email, city: $city, createdAt: $createdAt})`,
  getUser: `MATCH (u:User {id: $id}) RETURN u`,
  userExists: `MATCH (u:User {id: $id}) RETURN u.id AS id`,
  listUsers: `MATCH (u:User) RETURN u ORDER BY u.id SKIP $offset LIMIT $limit`,
  listUsersByCity: `MATCH (u:User {city: $city}) RETURN u ORDER BY u.id SKIP $offset LIMIT $limit`,
  updateUser: `MATCH (u:User {id: $id}) SET u += $patch RETURN u`,
  deleteUser: `
    MATCH (u:User {id: $id})
    OPTIONAL MATCH (u)-[:AUTHORED]->(p:Post)
    DETACH DELETE p, u`,

  createPost: `
    MATCH (u:User {id: $authorId})
    CREATE (u)-[:AUTHORED]->(p:Post {id: $id, body: $body, createdAt: $createdAt})
    RETURN p, u.id AS authorId`,
  postsByUser: `
    MATCH (u:User {id: $id})-[:AUTHORED]->(p:Post)
    RETURN p, u.id AS authorId
    ORDER BY p.createdAt DESC, p.id
    LIMIT $limit`,
  timeline: `
    MATCH (:User {id: $id})-[:FOLLOWS]->(a:User)-[:AUTHORED]->(p:Post)
    RETURN p, a.id AS authorId
    ORDER BY p.createdAt DESC, p.id
    LIMIT $limit`,

  follow: `
    MATCH (a:User {id: $followerId}), (b:User {id: $followeeId})
    MERGE (a)-[r:FOLLOWS]->(b)
    ON CREATE SET r.since = $since
    RETURN a.id AS id`,
  unfollow: `MATCH (:User {id: $followerId})-[r:FOLLOWS]->(:User {id: $followeeId}) DELETE r`,
  followers: `MATCH (u:User)-[:FOLLOWS]->(:User {id: $id}) RETURN u ORDER BY u.id`,
  following: `MATCH (:User {id: $id})-[:FOLLOWS]->(u:User) RETURN u ORDER BY u.id`,

  reachableWithin: (depth: number) => `
    MATCH (me:User {id: $id})-[:FOLLOWS*1..${assertDepth(depth)}]->(u:User)
    WHERE u <> me
    RETURN DISTINCT u
    ORDER BY u.id`,
  shortestPath: (maxDepth: number) => `
    MATCH (a:User {id: $from}), (b:User {id: $to})
    MATCH p = shortestPath((a)-[:FOLLOWS*1..${assertDepth(maxDepth)}]->(b))
    RETURN [n IN nodes(p) | n.id] AS path, length(p) AS hops`,
  recommend: `
    MATCH (me:User {id: $id})-[:FOLLOWS]->(:User)-[:FOLLOWS]->(u:User)
    WHERE u <> me AND NOT (me)-[:FOLLOWS]->(u)
    RETURN u, count(*) AS mutualCount
    ORDER BY mutualCount DESC, u.id
    LIMIT $limit`,
  mutualFollows: `
    MATCH (:User {id: $a})-[:FOLLOWS]->(u:User)<-[:FOLLOWS]-(:User {id: $b})
    RETURN u
    ORDER BY u.id`,

  usersPerCity: `MATCH (u:User) RETURN u.city AS city, count(*) AS cnt ORDER BY cnt DESC, city`,
  topFollowed: `
    MATCH (f:User)-[:FOLLOWS]->(u:User)
    RETURN u, count(f) AS followers
    ORDER BY followers DESC, u.id
    LIMIT $limit`,

  bulkUsers: `UNWIND $rows AS row CREATE (u:User) SET u = row`,
  bulkPosts: `
    UNWIND $rows AS row
    MATCH (u:User {id: row.authorId})
    CREATE (u)-[:AUTHORED]->(:Post {id: row.id, body: row.body, createdAt: row.createdAt})`,
  bulkFollows: `
    UNWIND $rows AS row
    MATCH (a:User {id: row.followerId}), (b:User {id: row.followeeId})
    MERGE (a)-[r:FOLLOWS]->(b)
    ON CREATE SET r.since = row.since`,
} as const;
