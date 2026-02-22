import type { DashboardDoc } from "../config/dashboard.types";
import type { SemanticRegistry } from "../config/semantic.types";

type DrilldownPresetsOverride = Record<
  string,
  {
    defaultPreset?: string;
    columnsPresets?: Record<string, any[]>;
  }
>;

function cloneJson<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

export function getDrilldownPresetsOverrideFromDashboard(dashboard: DashboardDoc): DrilldownPresetsOverride {
  const raw: any = (dashboard as any)?.dashboard?.drilldownPresets;
  if (!raw || typeof raw !== "object") return {};
  return raw as DrilldownPresetsOverride;
}

export function mergeSemanticWithDashboard(base: SemanticRegistry, dashboard: DashboardDoc): SemanticRegistry {
  const override = getDrilldownPresetsOverrideFromDashboard(dashboard);
  const hasOverride = override && Object.keys(override).length > 0;
  if (!hasOverride) return base;

  const next = { ...base, drilldownPresets: { ...(base as any).drilldownPresets } } as any;
  for (const [target, o] of Object.entries(override)) {
    const baseTarget = (next.drilldownPresets as any)?.[target] ?? {};
    const baseCols = { ...(baseTarget.columnsPresets ?? {}) };

    const rawO: any = o && typeof o === "object" ? cloneJson(o as any) : {};
    const oCols = rawO?.columnsPresets && typeof rawO.columnsPresets === "object" ? rawO.columnsPresets : {};
    const mergedCols = { ...baseCols, ...cloneJson(oCols) };

    // Prefer other fields (e.g. entity) from dashboard template if present.
    try {
      delete rawO.columnsPresets;
    } catch {
      // ignore
    }

    (next.drilldownPresets as any)[target] = {
      ...baseTarget,
      ...rawO,
      columnsPresets: mergedCols
    };
  }
  return next as SemanticRegistry;
}
