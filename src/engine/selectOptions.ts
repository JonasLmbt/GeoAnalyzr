import type { GlobalFiltersSpec, SelectControlSpec } from "../config/dashboard.types";
import type { GlobalFilterState } from "./globalFilters";
import { ROUND_DIMENSION_EXTRACTORS } from "./dimensions";
import { getRounds } from "./queryEngine";

export type SelectOption = { value: string; label: string };

const cache = new Map<string, SelectOption[]>();

function stableKey(spec: GlobalFiltersSpec, state: GlobalFilterState, excludeId: string): string {
  const parts = spec.controls.map((c) => (c.id === excludeId ? `${c.id}=<excluded>` : `${c.id}=${JSON.stringify(state[c.id])}`));
  return `selectopts:${excludeId}:${parts.join("|")}`;
}

function movementLabel(v: string): string {
  const k = v.trim().toLowerCase();
  if (k === "moving") return "Moving";
  if (k === "no_move") return "No move";
  if (k === "nmpz") return "NMPZ";
  if (k === "unknown") return "Unknown";
  return v;
}

const durationOrder = ["<20 sec", "20-30 sec", "30-45 sec", "45-60 sec", "60-90 sec", "90-180 sec", ">180 sec"];
const durationRank = new Map(durationOrder.map((k, i) => [k, i]));

export async function getSelectOptionsForControl(opts: {
  spec: GlobalFiltersSpec;
  state: GlobalFilterState;
  control: SelectControlSpec;
}): Promise<SelectOption[]> {
  const { spec, state, control } = opts;

  const key = stableKey(spec, state, control.id);
  const cached = cache.get(key);
  if (cached) return cached;

  // Exclude this control when computing options to avoid self-filtering into a single value.
  const stateWithoutSelf: GlobalFilterState = { ...state };
  delete stateWithoutSelf[control.id];

  const rows = await getRounds({ global: { spec, state: stateWithoutSelf } });

  if (control.options === "auto_teammates") {
    // Count unique games per teammate, based on the currently active global filters.
    const gamesByMate = new Map<string, Set<string>>();
    const roundsByMate = new Map<string, number>();
    for (const r of rows) {
      const mate = (r as any).teammateName;
      const name = typeof mate === "string" ? mate.trim() : "";
      const gameId = String((r as any).gameId ?? "");
      if (!gameId) continue;
      if (!name) continue;
      const set = gamesByMate.get(name) ?? new Set<string>();
      set.add(gameId);
      gamesByMate.set(name, set);
      roundsByMate.set(name, (roundsByMate.get(name) ?? 0) + 1);
    }
    const out = Array.from(gamesByMate.entries())
      .map(([name, games]) => ({
        value: name,
        label: `${name} (${games.size} games, ${roundsByMate.get(name) ?? 0} rounds)`,
        n: games.size
      }))
      .sort((a, b) => (b.n - a.n) || a.value.localeCompare(b.value))
      .map(({ value, label }) => ({ value, label }));
    cache.set(key, out);
    return out;
  }

  // auto_distinct
  const dimId = control.dimension;
  const extractor = ROUND_DIMENSION_EXTRACTORS[dimId];
  if (!extractor) return [];

  const seen = new Set<string>();
  for (const r of rows) {
    const v = extractor(r);
    if (typeof v === "string" && v.length) seen.add(v);
  }

  let values = Array.from(seen);
  if (dimId === "duration_bucket") {
    values.sort((a, b) => (durationRank.get(a) ?? 999) - (durationRank.get(b) ?? 999));
  } else {
    values.sort((a, b) => a.localeCompare(b));
  }

  const out = values.map<SelectOption>((v) => ({
    value: v,
    label: dimId === "movement_type" ? movementLabel(v) : v
  }));

  cache.set(key, out);
  return out;
}

