import type { Stores } from "../drivers";
import type { DataStore } from "../model/DataStore";
import type { DbName, Follow, Post, SeedRequest, User } from "../model/types";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = [
  "Ana",
  "Bruno",
  "Carla",
  "Diego",
  "Elisa",
  "Felipe",
  "Gabriela",
  "Hugo",
  "Iara",
  "João",
  "Karina",
  "Lucas",
  "Marina",
  "Nuno",
  "Olivia",
  "Pedro",
  "Queila",
  "Rafael",
  "Sofia",
  "Tiago",
];
const LAST = [
  "Almeida",
  "Barros",
  "Cardoso",
  "Dias",
  "Esteves",
  "Ferreira",
  "Gomes",
  "Henriques",
  "Lima",
  "Machado",
  "Nunes",
  "Oliveira",
  "Pereira",
  "Queiroz",
  "Ribeiro",
  "Santos",
  "Teixeira",
  "Vieira",
];
const CITIES = [
  "Fortaleza",
  "São Paulo",
  "Rio de Janeiro",
  "Recife",
  "Salvador",
  "Belo Horizonte",
  "Curitiba",
  "Porto Alegre",
  "Brasília",
  "Manaus",
  "Belém",
  "Goiânia",
  "Natal",
  "Florianópolis",
  "Vitória",
  "João Pessoa",
  "Maceió",
  "Teresina",
  "São Luís",
  "Campinas",
];
const OPENERS = [
  "Just tried",
  "Thinking about",
  "Anyone else into",
  "Finally finished",
  "Hot take on",
  "Reading about",
  "Can’t stop thinking about",
  "Weekend plans:",
];
const TOPICS = [
  "graph databases",
  "the new coffee place",
  "a long run",
  "SQL joins",
  "open source",
  "board games",
  "a road trip",
  "sourdough",
  "distributed systems",
  "a good book",
];

const BASE_TIME = Date.UTC(2024, 0, 1);
const SPAN_MS = 365 * 24 * 3600 * 1000;

export interface Dataset {
  users: User[];
  posts: Post[];
  follows: Follow[];
}

export function generateDataset(req: SeedRequest): Dataset {
  const rand = mulberry32(req.seed);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join(
      "",
    );
  const id = () =>
    `${hex(8)}-${hex(4)}-4${hex(3)}-${"89ab"[Math.floor(rand() * 4)]}${hex(3)}-${hex(12)}`;
  const iso = (ms: number) => new Date(ms).toISOString();

  const n = req.users;

  const users: User[] = Array.from({ length: n }, (_, i) => {
    const first = pick(FIRST);
    const last = pick(LAST);
    const slug = `${first}.${last}`
      .toLowerCase()
      .normalize("NFD")
      .replace(/[^a-z.]/g, "");
    return {
      id: id(),
      name: `${first} ${last}`,
      email: `${slug}.${i}@example.com`, // index keeps emails unique
      city: pick(CITIES),
      createdAt: iso(BASE_TIME + i * 60_000),
    };
  });

  const posts: Post[] = [];
  for (const u of users) {
    for (let k = 0; k < req.postsPerUser; k++) {
      posts.push({
        id: id(),
        authorId: u.id,
        body: `${pick(OPENERS)} ${pick(TOPICS)}.`,
        createdAt: iso(BASE_TIME + Math.floor(rand() * SPAN_MS)),
      });
    }
  }

  // Each user follows 1..(2·avg−1) others (mean ≈ avg). Targets are skewed toward
  // low indices (r²), so a few "popular" users emerge, as in a real network.
  const follows: Follow[] = [];
  for (let i = 0; i < n; i++) {
    const count = Math.min(
      n - 1,
      1 + Math.floor(rand() * (2 * req.avgFollows - 1)),
    );
    const targets = new Set<number>();
    for (
      let attempts = 0;
      targets.size < count && attempts < count * 10;
      attempts++
    ) {
      const j = Math.floor(n * rand() ** 2);
      if (j !== i) targets.add(j);
    }
    for (const j of targets) {
      follows.push({
        followerId: users[i]!.id,
        followeeId: users[j]!.id,
        since: iso(BASE_TIME + Math.floor(rand() * SPAN_MS)),
      });
    }
  }

  return { users, posts, follows };
}

export interface LoadTimings {
  resetMs: number;
  usersMs: number;
  postsMs: number;
  followsMs: number;
  totalMs: number;
}

const round = (n: number) => Math.round(n * 10) / 10;

async function timed(fn: () => Promise<void>): Promise<number> {
  const start = performance.now();
  await fn();
  return round(performance.now() - start);
}

export async function loadDataset(
  store: DataStore,
  data: Dataset,
): Promise<LoadTimings> {
  const resetMs = await timed(() => store.reset());
  const usersMs = await timed(() => store.bulkInsertUsers(data.users));
  const postsMs = await timed(() => store.bulkInsertPosts(data.posts));
  const followsMs = await timed(() => store.bulkInsertFollows(data.follows));
  store.takeQueryLog();
  return {
    resetMs,
    usersMs,
    postsMs,
    followsMs,
    totalMs: round(usersMs + postsMs + followsMs),
  };
}

export interface SeedResult {
  request: SeedRequest;
  counts: { users: number; posts: number; follows: number };
  timings: Record<DbName, LoadTimings>;
}

export async function seedAll(
  stores: Stores,
  request: SeedRequest,
): Promise<SeedResult> {
  const data = generateDataset(request);
  const timings = {} as Record<DbName, LoadTimings>;
  for (const [name, store] of Object.entries(stores) as [DbName, DataStore][]) {
    timings[name] = await loadDataset(store, data);
  }
  return {
    request,
    counts: {
      users: data.users.length,
      posts: data.posts.length,
      follows: data.follows.length,
    },
    timings,
  };
}
