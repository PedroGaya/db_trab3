export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : v,
  );
}

export function firstDifference(a: unknown, b: unknown): string | null {
  if (canonical(a) === canonical(b)) return null;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length)
      return `result sizes differ (${a.length} vs ${b.length})`;
    const i = a.findIndex((item, idx) => canonical(item) !== canonical(b[idx]));
    return `results differ, first at index ${i}`;
  }
  return "results differ";
}
