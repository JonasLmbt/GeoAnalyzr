import type { GlobalFiltersSpec, DateRangeValue } from "../config/dashboard.types";
import type { GlobalFilterState } from "../engine/globalFilters";

export type FilterStateListener = () => void;

function cloneJson<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildDefaults(spec: GlobalFiltersSpec | undefined): GlobalFilterState {
  const state: GlobalFilterState = {};
  if (!spec?.enabled) return state;
  for (const c of spec.controls) {
    state[c.id] = cloneJson((c as any).default);
  }
  return state;
}

function normalizeDateRangeValue(value: unknown, fallback: DateRangeValue): DateRangeValue {
  if (!value || typeof value !== "object") return fallback;
  const v = value as Record<string, unknown>;
  const fromTs = v.fromTs === null ? null : Number(v.fromTs);
  const toTs = v.toTs === null ? null : Number(v.toTs);
  return {
    fromTs: Number.isFinite(fromTs) ? fromTs : null,
    toTs: Number.isFinite(toTs) ? toTs : null
  };
}

export function createGlobalFilterStore(spec: GlobalFiltersSpec | undefined) {
  let defaults = buildDefaults(spec);
  let state: GlobalFilterState = cloneJson(defaults);
  const listeners = new Set<FilterStateListener>();

  const notify = () => {
    for (const l of listeners) l();
  };

  return {
    getSpec: () => spec,
    getState: () => state,
    patchDefaults: (partial: GlobalFilterState) => {
      defaults = { ...defaults, ...cloneJson(partial) };
    },
    setValue: (id: string, value: unknown) => {
      if (!id) return;
      // Validate basic shapes early to keep the store consistent.
      const control = spec?.enabled ? spec.controls.find((c) => c.id === id) : undefined;
      if (control?.type === "date_range") {
        const fb = (defaults[id] as DateRangeValue) ?? { fromTs: null, toTs: null };
        state = { ...state, [id]: normalizeDateRangeValue(value, fb) };
      } else {
        state = { ...state, [id]: value };
      }
      notify();
    },
    setAll: (next: GlobalFilterState) => {
      state = { ...cloneJson(defaults), ...cloneJson(next) };
      notify();
    },
    reset: () => {
      state = cloneJson(defaults);
      notify();
    },
    subscribe: (listener: FilterStateListener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
