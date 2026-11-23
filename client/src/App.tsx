import { useEffect, useState } from "react";
// Types are imported straight from the server's model (erased at build time).
import type {
  BenchmarkResult,
  DbName,
  OperationInfo,
  Recommendation,
  Stats,
  User,
} from "../../server/src/model/types";

// ───────────── api ─────────────

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  return body as T;
}

const get = <T,>(path: string) => call<T>(path);

const post = <T,>(path: string, body: unknown = {}) =>
  call<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** Every `?db=` endpoint wraps its payload like this. */
interface Envelope<T> {
  data: T;
  meta: { db: DbName; durationMs: number; queries: string[] };
}

type Health = Record<
  DbName,
  { ok: true; stats: Stats } | { ok: false; error: string }
>;

interface SeedResponse {
  counts: Stats;
  timings: Record<DbName, { totalMs: number }>;
}

// ───────────── helpers ─────────────

const DBS: DbName[] = ["sqlite", "neo4j"];
const NAME: Record<DbName, string> = { sqlite: "SQLite", neo4j: "Neo4j" };
const fmt = (n: number) =>
  n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/** Runs an async action while tracking "busy" and the last error message. */
function useTask() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

const ErrorLine = ({ message }: { message: string }) =>
  message ? <p className="error">{message}</p> : null;

// ───────────── status + seed ─────────────

function Status({
  health,
  onChange,
}: {
  health?: Health;
  onChange: () => void;
}) {
  const [users, setUsers] = useState(1000);
  const [loaded, setLoaded] = useState<SeedResponse>();
  const { busy, error, run } = useTask();

  const seed = () =>
    run(async () => {
      setLoaded(await post<SeedResponse>("/admin/seed", { users }));
      onChange();
    });

  return (
    <section>
      <div className="row">
        {DBS.map((db) => {
          const h = health?.[db];
          return (
            <div key={db} className="card grow">
              <h3>
                {NAME[db]}{" "}
                <span className={h?.ok ? "ok" : "bad"}>
                  {h ? (h.ok ? "online" : "offline") : "..."}
                </span>
              </h3>
              {h?.ok ? (
                <p>
                  {fmt(h.stats.users)} usuários, {fmt(h.stats.posts)} posts,{" "}
                  {fmt(h.stats.follows)} follows
                </p>
              ) : (
                h && <p className="error">{h.error}</p>
              )}
            </div>
          );
        })}
      </div>
      <div className="row">
        <label>
          Usuários{" "}
          <input
            type="number"
            min={1}
            max={100000}
            value={users}
            onChange={(e) => setUsers(+e.target.value)}
          />
        </label>
        <button disabled={busy} onClick={seed}>
          {busy ? "Populando..." : "Popular os dois bancos"}
        </button>
      </div>
      {loaded && (
        <p className="muted">
          Tempo de carga:{" "}
          {DBS.map(
            (db) => `${NAME[db]} ${fmt(loaded.timings[db].totalMs)} ms`,
          ).join(", ")}
        </p>
      )}
      <ErrorLine message={error} />
    </section>
  );
}

// ───────────── comparison ─────────────

function Result({ r }: { r: BenchmarkResult }) {
  const max = Math.max(...DBS.map((db) => r.results[db].timings.median)) || 1;
  const { equal, mismatchedRuns, first } = r.equivalence;
  const { fasterDb, speedup } = r.comparison;

  return (
    <>
      <p>
        <strong>
          {fasterDb === "tie"
            ? "Empate"
            : `${NAME[fasterDb]} foi ${fmt(speedup)}x mais rápido`}
        </strong>{" "}
        (mediana) -{" "}
        <span className={equal ? "ok" : "bad"}>
          {equal
            ? "resultados idênticos"
            : `${mismatchedRuns} execução(ões) divergentes: ${first?.reason}`}
        </span>
      </p>
      {r.budgetExceeded && (
        <p className="muted">
          Limite de tempo atingido: {r.runsCompleted} execuções concluídas.
        </p>
      )}
      <p className="muted">
        {fmt(r.dataset.users)} usuários. Entrada: {JSON.stringify(r.input)}
      </p>
      <div className="row">
        {DBS.map((db) => {
          const d = r.results[db];
          const t = d.timings;
          return (
            <div key={db} className="card grow">
              <h3>{NAME[db]}</h3>
              <div className="bar">
                <div
                  className={fasterDb === db ? "win" : ""}
                  style={{ width: `${(t.median / max) * 100}%` }}
                />
              </div>
              <p>
                mediana <b>{fmt(t.median)} ms</b>, p95 {fmt(t.p95)}, mín{" "}
                {fmt(t.min)}, máx {fmt(t.max)}
              </p>
              {d.errors > 0 && (
                <p className="error">
                  {d.errors} erros: {d.firstError}
                </p>
              )}
              <details>
                <summary>Consultas executadas</summary>
                <pre>{d.sample?.queries.join("\n\n")}</pre>
              </details>
              <details>
                <summary>
                  Resultado ({d.sample?.resultCount ?? 0} itens)
                </summary>
                <pre>
                  {JSON.stringify(d.sample?.result, null, 1)?.slice(0, 2000)}
                </pre>
              </details>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Compare() {
  const [ops, setOps] = useState<OperationInfo[]>([]);
  const [op, setOp] = useState("");
  const [runs, setRuns] = useState(20);
  const [depth, setDepth] = useState(3);
  const [result, setResult] = useState<BenchmarkResult>();
  const { busy, error, run } = useTask();

  useEffect(() => {
    run(async () => {
      const list = await get<OperationInfo[]>("/benchmark/operations");
      setOps(list);
      setOp(list[0]?.id ?? "");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = ops.find((o) => o.id === op);
  const start = () =>
    run(async () => {
      setResult(undefined);
      setResult(
        await post<BenchmarkResult>("/benchmark/run", {
          operation: op,
          runs,
          depth,
        }),
      );
    });

  return (
    <section>
      <div className="row">
        <label>
          Operação{" "}
          <select value={op} onChange={(e) => setOp(e.target.value)}>
            {ops.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Execuções{" "}
          <input
            type="number"
            min={1}
            max={500}
            value={runs}
            onChange={(e) => setRuns(+e.target.value)}
          />
        </label>
        {current?.uses.includes("depth") && (
          <label>
            Profundidade{" "}
            <input
              type="number"
              min={1}
              max={6}
              value={depth}
              onChange={(e) => setDepth(+e.target.value)}
            />
          </label>
        )}
        <button disabled={busy || !op} onClick={start}>
          {busy ? "Executando..." : "Executar"}
        </button>
      </div>
      {current && <p className="muted">{current.description}</p>}
      <ErrorLine message={error} />
      {result && <Result r={result} />}
    </section>
  );
}

// ───────────── explorer ─────────────

interface Detail {
  following: User[];
  recs: Recommendation[];
  ms: number;
  queries: string[];
}

function Explore() {
  const [db, setDb] = useState<DbName>("sqlite");
  const [users, setUsers] = useState<User[]>([]);
  const [sel, setSel] = useState<User>();
  const [detail, setDetail] = useState<Detail>();
  const { busy, error, run } = useTask();

  useEffect(() => {
    setSel(undefined);
    setDetail(undefined);
    run(async () =>
      setUsers((await get<Envelope<User[]>>(`/users?db=${db}&limit=20`)).data),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);

  const pick = (u: User) =>
    run(async () => {
      setSel(u);
      // sequential on purpose: the server keeps one query log per database
      const f = await get<Envelope<User[]>>(
        `/users/${u.id}/following?db=${db}`,
      );
      const r = await get<Envelope<Recommendation[]>>(
        `/graph/recommend/${u.id}?db=${db}&limit=5`,
      );
      setDetail({
        following: f.data,
        recs: r.data,
        ms: f.meta.durationMs + r.meta.durationMs,
        queries: [...f.meta.queries, ...r.meta.queries],
      });
    });

  return (
    <section>
      <div className="row">
        {DBS.map((d) => (
          <button
            key={d}
            className={d === db ? "active" : ""}
            onClick={() => setDb(d)}
          >
            {NAME[d]}
          </button>
        ))}
        {busy && <span className="muted">carregando...</span>}
      </div>
      <ErrorLine message={error} />
      <div className="row top">
        <ul className="card list">
          {users.map((u) => (
            <li key={u.id}>
              <button
                className={u.id === sel?.id ? "link active" : "link"}
                onClick={() => pick(u)}
              >
                {u.name} <span className="muted">({u.city})</span>
              </button>
            </li>
          ))}
          {users.length === 0 && (
            <li className="muted">
              Nenhum usuário. Popule os bancos primeiro.
            </li>
          )}
        </ul>
        {sel && detail && (
          <div className="card grow">
            <h3>{sel.name}</h3>
            <p className="muted">
              {sel.email}, resposta em {fmt(detail.ms)} ms ({NAME[db]})
            </p>
            <b>Segue ({detail.following.length})</b>
            <p>{detail.following.map((u) => u.name).join(", ") || "-"}</p>
            <b>Recomendados</b>
            <p>
              {detail.recs
                .map((r) => `${r.user.name} (${r.mutualCount} em comum)`)
                .join(", ") || "-"}
            </p>
            <details>
              <summary>Consultas executadas</summary>
              <pre>{detail.queries.join("\n\n")}</pre>
            </details>
          </div>
        )}
      </div>
    </section>
  );
}

// ───────────── app ─────────────

export default function App() {
  const [tab, setTab] = useState<"compare" | "explore">("compare");
  const [health, setHealth] = useState<Health>();
  const refresh = () =>
    get<Health>("/health")
      .then(setHealth)
      .catch(() => setHealth(undefined));

  useEffect(() => {
    refresh();
  }, []);

  return (
    <main>
      <h1>Neo4j vs SQLite</h1>
      <Status health={health} onChange={refresh} />
      <nav className="row">
        <button
          className={tab === "compare" ? "active" : ""}
          onClick={() => setTab("compare")}
        >
          Comparar
        </button>
        <button
          className={tab === "explore" ? "active" : ""}
          onClick={() => setTab("explore")}
        >
          Explorar
        </button>
      </nav>
      {tab === "compare" ? <Compare /> : <Explore />}
    </main>
  );
}
