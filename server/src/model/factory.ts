import type { NewPost, NewUser, Post, User } from "./types";

export const newId = (): string => crypto.randomUUID();
export const now = (): string => new Date().toISOString();

export function buildUser(input: NewUser): User {
  return { id: newId(), ...input, createdAt: now() };
}

export function buildPost(input: NewPost): Post {
  return { id: newId(), ...input, createdAt: now() };
}
