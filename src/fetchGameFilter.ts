export type ModeFamilyFilter = "all" | "duels" | "teamduels";
export type MovementFilter = "all" | "moving" | "no_move" | "nmpz" | "unknown";
export type RatedFilter = "all" | "rated" | "unrated" | "unknown";

export type FetchGameFilter = {
  modeFamily: ModeFamilyFilter;
  movement: MovementFilter;
  rated: RatedFilter;
  mode: string; // substring match (case-insensitive) against gameMode/mode
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

function normalizeMovement(value: unknown): MovementFilter {
  const s = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (s === "moving" || s === "no_move" || s === "nmpz" || s === "unknown") return s;
  return "all";
}

function normalizeRated(value: unknown): RatedFilter {
  const s = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (s === "rated" || s === "unrated" || s === "unknown") return s;
  return "all";
}

function normalizeMode(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 60) : "";
}

function normalizeMs(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

export function loadFetchGameFilter(): FetchGameFilter {
  const modeFamily = normalizeModeFamily(readGmValue(`${GM_VALUE_PREFIX}mode_family`));
  const movement = normalizeMovement(readGmValue(`${GM_VALUE_PREFIX}movement`));
  const rated = normalizeRated(readGmValue(`${GM_VALUE_PREFIX}rated`));
  const mode = normalizeMode(readGmValue(`${GM_VALUE_PREFIX}mode`));
  const fromMs = normalizeMs(readGmValue(`${GM_VALUE_PREFIX}from_ms`));
  const toMs = normalizeMs(readGmValue(`${GM_VALUE_PREFIX}to_ms`));
  return { modeFamily, movement, rated, mode, fromMs, toMs };
}

export function saveFetchGameFilter(next: Partial<FetchGameFilter>): void {
  if (typeof next.modeFamily === "string") writeGmValue(`${GM_VALUE_PREFIX}mode_family`, String(next.modeFamily));
  if (typeof next.movement === "string") writeGmValue(`${GM_VALUE_PREFIX}movement`, String(next.movement));
  if (typeof next.rated === "string") writeGmValue(`${GM_VALUE_PREFIX}rated`, String(next.rated));
  if (typeof next.mode === "string") writeGmValue(`${GM_VALUE_PREFIX}mode`, next.mode.trim().slice(0, 60));
  if (typeof next.fromMs === "number") writeGmValue(`${GM_VALUE_PREFIX}from_ms`, String(Math.max(0, Math.floor(next.fromMs))));
  if (typeof next.toMs === "number") writeGmValue(`${GM_VALUE_PREFIX}to_ms`, String(Math.max(0, Math.floor(next.toMs))));
}
