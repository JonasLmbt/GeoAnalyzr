export type FetchModeFamilyFilter = "all" | "duels" | "teamduels";

export type FetchGameFilter = {
  modeFamily: FetchModeFamilyFilter;
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

function normalizeModeFamily(value: unknown): FetchModeFamilyFilter {
  const s = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (s === "duels" || s === "teamduels") return s;
  return "all";
}

export function loadFetchGameFilter(): FetchGameFilter {
  const raw = readGmValue(`${GM_VALUE_PREFIX}mode_family`);
  return { modeFamily: normalizeModeFamily(raw) };
}

export function saveFetchGameFilter(next: Partial<FetchGameFilter>): void {
  if (next.modeFamily) writeGmValue(`${GM_VALUE_PREFIX}mode_family`, String(next.modeFamily));
}

