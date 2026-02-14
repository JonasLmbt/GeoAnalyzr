import type { FilterClause, GlobalFiltersSpec, DateRangeControlSpec, SelectControlSpec } from "../config/dashboard.types";
import type { Grain } from "../config/semantic.types";

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
  return buildAppliedFilters(spec, state, "round");
}

export function buildAppliedFilters(
  spec: GlobalFiltersSpec | undefined,
  state: GlobalFilterState,
  grain: Grain,
  controlIds?: string[]
): AppliedRoundFilters {
  const out: AppliedRoundFilters = { clauses: [] };
  if (!spec?.enabled) return out;

  const allowed = Array.isArray(controlIds) && controlIds.length > 0 ? new Set(controlIds) : null;
  let teammateSelected: string | null = null;

  for (const control of spec.controls) {
    if (allowed && !allowed.has(control.id)) continue;
    if (!control.appliesTo.includes(grain)) continue;

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
      if (c.dimension === "teammate_name") teammateSelected = selected;
      continue;
    }
  }

  // If a teammate is selected, enforce Team Duel mode (so teammate + Duel can't happen).
  if (teammateSelected) {
    const forced = "Team Duel";
    const hasModeClause = out.clauses.some((cl) => cl.dimension === "mode_family");
    const isAlreadyForced = hasModeClause && out.clauses.some((cl) => cl.dimension === "mode_family" && cl.op === "eq" && cl.value === forced);
    if (!isAlreadyForced) {
      out.clauses = out.clauses.filter((cl) => cl.dimension !== "mode_family");
      out.clauses.push({ dimension: "mode_family", op: "eq", value: forced });
    }
  }

  return out;
}

export function normalizeGlobalFilterKey(
  spec: GlobalFiltersSpec | undefined,
  state: GlobalFilterState,
  grain: Grain = "round",
  controlIds?: string[]
): string {
  if (!spec?.enabled) return `gf:${grain}:off`;
  const parts: string[] = [];
  const allowed = Array.isArray(controlIds) && controlIds.length > 0 ? new Set(controlIds) : null;
  for (const c of spec.controls) {
    if (allowed && !allowed.has(c.id)) continue;
    const v = state[c.id];
    parts.push(`${c.id}=${JSON.stringify(v)}`);
  }
  return `gf:${grain}:${parts.join("|")}`;
}
