export type ModeFamilyFilter = "all" | "duels" | "teamduels";
export type MovementFilter = "moving" | "no_move" | "nmpz" | "unknown";
export type RatedFilter = "all" | "rated" | "unrated" | "unknown";

export type FetchGameFilter = {
  modeFamily: ModeFamilyFilter;
  movementAnyOf: MovementFilter[]; // empty => all
  rated: RatedFilter;
  fromMs: number; // inclusive lower bound (playedAt)
  toMs: number; // inclusive upper bound (playedAt)
};

const GM_VALUE_PREFIX = "geoanalyzr_fetch_filter_v1_";

function readGmValue(key: string): unknown {
  const g: any = globalThis as any;
  try {
    if (typeof g?.GM_getValue === "function") return g.GM_getValue(key);
  } catch {
    // ignore
  }
  try {
    // eslint-disable-next-line no-undef
    if (typeof GM_getValue === "function") return GM_getValue(key);
  } catch {
    // ignore
  }
  try {
    return globalThis?.localStorage?.getItem(key);
  } catch {
    return null;
  }
}

function writeGmValue(key: string, value: string): void {
  const g: any = globalThis as any;
  try {
    if (typeof g?.GM_setValue === "function") return g.GM_setValue(key, value);
  } catch {
    // ignore
  }
  try {
    // eslint-disable-next-line no-undef
    if (typeof GM_setValue === "function") return GM_setValue(key, value);
  } catch {
    // ignore
  }
  try {
    globalThis?.localStorage?.setItem(key, value);
  } catch {
    // ignore
  }
}

function normalizeModeFamily(value: unknown): ModeFamilyFilter {
  const s = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (s === "duels" || s === "teamduels") return s;
  return "all";
}

function normalizeMovementAnyOf(value: unknown): MovementFilter[] {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || raw.toLowerCase() === "all") return [];
  const parts = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const out: MovementFilter[] = [];
  for (const p of parts) {
    if (p === "moving" || p === "no_move" || p === "nmpz" || p === "unknown") out.push(p);
  }
  return Array.from(new Set(out));
}

function normalizeRated(value: unknown): RatedFilter {
  const s = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (s === "rated" || s === "unrated" || s === "unknown") return s;
  return "all";
}

function normalizeMs(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

export function loadFetchGameFilter(): FetchGameFilter {
  const modeFamily = normalizeModeFamily(readGmValue(`${GM_VALUE_PREFIX}mode_family`));
  const movementAnyOf = normalizeMovementAnyOf(readGmValue(`${GM_VALUE_PREFIX}movement_anyof`));
  // Backwards compatibility: older builds stored single movement in `movement`
  const movementLegacy = readGmValue(`${GM_VALUE_PREFIX}movement`);
  const movementAnyOfMerged = (() => {
    const legacy = typeof movementLegacy === "string" ? movementLegacy.trim().toLowerCase() : "";
    if (movementAnyOf.length > 0) return movementAnyOf;
    if (legacy === "moving" || legacy === "no_move" || legacy === "nmpz" || legacy === "unknown") return [legacy];
    return movementAnyOf;
  })();
  const rated = normalizeRated(readGmValue(`${GM_VALUE_PREFIX}rated`));
  const fromMs = normalizeMs(readGmValue(`${GM_VALUE_PREFIX}from_ms`));
  const toMs = normalizeMs(readGmValue(`${GM_VALUE_PREFIX}to_ms`));
  return { modeFamily, movementAnyOf: movementAnyOfMerged, rated, fromMs, toMs };
}

export function saveFetchGameFilter(next: Partial<FetchGameFilter>): void {
  if (typeof next.modeFamily === "string") writeGmValue(`${GM_VALUE_PREFIX}mode_family`, String(next.modeFamily));
  if (Array.isArray(next.movementAnyOf)) {
    const items = next.movementAnyOf
      .map((s) => String(s || "").trim().toLowerCase())
      .filter((s) => s === "moving" || s === "no_move" || s === "nmpz" || s === "unknown");
    const uniq = Array.from(new Set(items));
    writeGmValue(`${GM_VALUE_PREFIX}movement_anyof`, uniq.length > 0 ? uniq.join(",") : "all");
  }
  if (typeof next.rated === "string") writeGmValue(`${GM_VALUE_PREFIX}rated`, String(next.rated));
  if (typeof next.fromMs === "number") writeGmValue(`${GM_VALUE_PREFIX}from_ms`, String(Math.max(0, Math.floor(next.fromMs))));
  if (typeof next.toMs === "number") writeGmValue(`${GM_VALUE_PREFIX}to_ms`, String(Math.max(0, Math.floor(next.toMs))));
}
