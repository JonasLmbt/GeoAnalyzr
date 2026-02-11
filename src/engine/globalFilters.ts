import type { FilterClause, GlobalFiltersSpec, DateRangeControlSpec, SelectControlSpec } from "../config/dashboard.types";

export type GlobalFilterState = Record<string, unknown>;

export type AppliedRoundFilters = {
  date?: { fromTs?: number | null; toTs?: number | null };
  clauses: FilterClause[];
};

function normalizeAllString(value: unknown): string | null {
  if (value === "all") return null;
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v.length ? v : null;
}

function normalizeDateRange(value: unknown): { fromTs: number | null; toTs: number | null } {
  if (!value || typeof value !== "object") return { fromTs: null, toTs: null };
  const v = value as Record<string, unknown>;
  const fromRaw = v.fromTs === null ? null : Number(v.fromTs);
  const toRaw = v.toTs === null ? null : Number(v.toTs);
  return {
    fromTs: Number.isFinite(fromRaw) ? fromRaw : null,
    toTs: Number.isFinite(toRaw) ? toRaw : null
  };
}

export function buildAppliedRoundFilters(spec: GlobalFiltersSpec | undefined, state: GlobalFilterState): AppliedRoundFilters {
  const out: AppliedRoundFilters = { clauses: [] };
  if (!spec?.enabled) return out;

  for (const control of spec.controls) {
    if (!control.appliesTo.includes("round")) continue;

    if (control.type === "date_range") {
      const c = control as DateRangeControlSpec;
      const val = normalizeDateRange(state[c.id] ?? c.default);
      out.date = val;
      continue;
    }

    if (control.type === "select") {
      const c = control as SelectControlSpec;
      const selected = normalizeAllString(state[c.id] ?? c.default);
      if (!selected) continue;
      out.clauses.push({ dimension: c.dimension, op: "eq", value: selected });
      continue;
    }
  }

  return out;
}

export function normalizeGlobalFilterKey(spec: GlobalFiltersSpec | undefined, state: GlobalFilterState): string {
  if (!spec?.enabled) return "gf:off";
  const parts: string[] = [];
  for (const c of spec.controls) {
    const v = state[c.id];
    parts.push(`${c.id}=${JSON.stringify(v)}`);
  }
  return `gf:${parts.join("|")}`;
}
