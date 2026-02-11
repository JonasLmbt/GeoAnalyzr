import type { GlobalFiltersSpec, SelectControlSpec } from "../config/dashboard.types";
import type { GlobalFilterState } from "./globalFilters";
import { ROUND_DIMENSION_EXTRACTORS } from "./dimensions";
import { getRounds } from "./queryEngine";

const cache = new Map<string, string[]>();

function stableKey(spec: GlobalFiltersSpec, state: GlobalFilterState, excludeId: string): string {
  const parts = spec.controls.map((c) => (c.id === excludeId ? `${c.id}=<excluded>` : `${c.id}=${JSON.stringify(state[c.id])}`));
  return `distinct:${excludeId}:${parts.join("|")}`;
}

export async function getDistinctValuesForSelectControl(opts: {
  spec: GlobalFiltersSpec;
  state: GlobalFilterState;
  control: SelectControlSpec;
}): Promise<string[]> {
  const { spec, state, control } = opts;
  const dimId = control.dimension;
  const extractor = ROUND_DIMENSION_EXTRACTORS[dimId];
  if (!extractor) return [];

  const key = stableKey(spec, state, control.id);
  const cached = cache.get(key);
  if (cached) return cached;

  // Exclude this control when computing options to avoid self-filtering into a single value.
  const stateWithoutSelf: GlobalFilterState = { ...state };
  delete stateWithoutSelf[control.id];

  const rows = await getRounds({ global: { spec, state: stateWithoutSelf } });
  const seen = new Set<string>();
  for (const r of rows) {
    const v = extractor(r);
    if (typeof v === "string" && v.length) seen.add(v);
  }
  const values = Array.from(seen).sort((a, b) => a.localeCompare(b));
  cache.set(key, values);
  return values;
}
