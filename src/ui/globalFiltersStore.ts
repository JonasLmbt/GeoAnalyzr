import type { FilterClause } from "../config/dashboard.types";

const GLOBAL_FILTERS_KEY = "geoanalyzr:semantic:global-filters:v1";

function getStorage(doc: Document): Storage | null {
  try {
    return doc.defaultView?.localStorage ?? null;
  } catch {
    return null;
  }
}

function normalizeClause(raw: unknown): FilterClause | null {
  if (typeof raw !== "object" || !raw) return null;
  const r = raw as Record<string, unknown>;
  const dimension = typeof r.dimension === "string" ? r.dimension.trim() : "";
  const op = r.op;
  if (!dimension) return null;
  if (op !== "eq" && op !== "neq" && op !== "in" && op !== "nin") return null;

  const clause: FilterClause = { dimension, op };
  if ("value" in r) clause.value = r.value;
  if ("values" in r && Array.isArray(r.values)) clause.values = r.values;
  return clause;
}

function normalizeClauses(raw: unknown): FilterClause[] {
  if (!Array.isArray(raw)) return [];
  const out: FilterClause[] = [];
  for (const item of raw) {
    const c = normalizeClause(item);
    if (c) out.push(c);
  }
  return out;
}

export function loadGlobalFilters(doc: Document): FilterClause[] {
  const storage = getStorage(doc);
  if (!storage) return [];
  try {
    const raw = storage.getItem(GLOBAL_FILTERS_KEY);
    if (!raw) return [];
    return normalizeClauses(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveGlobalFilters(doc: Document, clauses: FilterClause[]): void {
  const storage = getStorage(doc);
  if (!storage) return;
  try {
    storage.setItem(GLOBAL_FILTERS_KEY, JSON.stringify(clauses, null, 2));
  } catch {
    // ignore storage issues
  }
}

