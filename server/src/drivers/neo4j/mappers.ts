import neo4j, { type Node, type Record as NeoRecord } from "neo4j-driver";
import type { Post, User } from "../../model/types";

export const toNumber = (v: unknown): number =>
  neo4j.isInt(v) ? v.toNumber() : Number(v);

export function toUser(node: Node): User {
  const p = node.properties as Record<string, string>;
  return {
    id: p.id!,
    name: p.name!,
    email: p.email!,
    city: p.city!,
    createdAt: p.createdAt!,
  };
}

export function toPost(record: NeoRecord): Post {
  const p = (record.get("p") as Node).properties as Record<string, string>;
  return {
    id: p.id!,
    authorId: record.get("authorId") as string,
    body: p.body!,
    createdAt: p.createdAt!,
  };
}
