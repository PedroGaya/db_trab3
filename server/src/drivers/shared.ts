export const BULK_CHUNK = 500;

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

const MAX_ENTRIES = 50;
const MAX_STATEMENT_CHARS = 1500;

function summarize(params: unknown): string {
  if (params === undefined) return "";
  if (Array.isArray(params)) {
    const head = params.slice(0, 8);
    return (
      JSON.stringify(head) +
      (params.length > 8 ? ` (+${params.length - 8} more)` : "")
    );
  }
  if (params && typeof params === "object") {
    const shallow = Object.fromEntries(
      Object.entries(params).map(([k, v]) => [
        k,
        Array.isArray(v) ? `[${v.length} items]` : v,
      ]),
    );
    return JSON.stringify(shallow);
  }
  return JSON.stringify(params);
}

export class QueryLog {
  private entries: string[] = [];
  private dropped = 0;

  record(statement: string, params?: unknown): void {
    if (this.entries.length >= MAX_ENTRIES) {
      this.dropped++;
      return;
    }
    const text = statement
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_STATEMENT_CHARS);
    const p = summarize(params);
    this.entries.push(p && p !== "[]" ? `${text}  -- params: ${p}` : text);
  }

  take(): string[] {
    const out = this.entries;
    if (this.dropped > 0)
      out.push(`… ${this.dropped} more statements not shown`);
    this.entries = [];
    this.dropped = 0;
    return out;
  }
}
