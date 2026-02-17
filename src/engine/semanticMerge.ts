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
    const oCols = o?.columnsPresets && typeof o.columnsPresets === "object" ? o.columnsPresets : {};
    const mergedCols = { ...baseCols, ...cloneJson(oCols) };
    (next.drilldownPresets as any)[target] = {
      ...baseTarget,
      ...(o?.defaultPreset ? { defaultPreset: o.defaultPreset } : {}),
      columnsPresets: mergedCols
    };
  }
  return next as SemanticRegistry;
}

