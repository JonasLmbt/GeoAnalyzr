import type { DashboardDoc } from "../config/dashboard.types";

export type ThemeMode = "dark" | "light" | "geoguessr";
export type DateFormatMode = "dd/mm/yyyy" | "mm/dd/yyyy" | "yyyy-mm-dd" | "locale";

export type SemanticDashboardSettings = {
  appearance: {
    theme: ThemeMode;
    graphColor: string;
    chartAnimations: boolean;
  };
  standards: {
    dateFormat: DateFormatMode;
    sessionGapMinutes: number;
  };
};

const SETTINGS_KEY = "geoanalyzr:semantic:settings:v1";
const THEME_KEY = "geoanalyzr.theme";
const DASHBOARD_TEMPLATE_KEY = "geoanalyzr:semantic:dashboard-template:v1";

export const DEFAULT_SETTINGS: SemanticDashboardSettings = {
  appearance: {
    theme: "geoguessr",
    graphColor: "#7eb6ff",
    chartAnimations: true
  },
  standards: {
    dateFormat: "dd/mm/yyyy",
    sessionGapMinutes: 45
  }
};

function cloneTemplate<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

export function normalizeColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  return fallback;
}

export function normalizeTheme(value: unknown): ThemeMode {
  if (value === "geoguessr") return value;
  if (value === "light" || value === "dark") return value;
  return "geoguessr";
}

function normalizeBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  return fallback;
}

export function normalizeDateFormat(value: unknown): DateFormatMode {
  return value === "mm/dd/yyyy" || value === "yyyy-mm-dd" || value === "locale" ? value : "dd/mm/yyyy";
}

function normalizeSettings(raw: unknown): SemanticDashboardSettings {
  const r = typeof raw === "object" && raw ? (raw as Record<string, unknown>) : {};
  const appearance = typeof r.appearance === "object" && r.appearance ? (r.appearance as Record<string, unknown>) : {};
  const standards = typeof r.standards === "object" && r.standards ? (r.standards as Record<string, unknown>) : {};
  const sessionGapRaw = Number(standards.sessionGapMinutes);
  return {
    appearance: {
      theme: normalizeTheme(appearance.theme),
      graphColor: normalizeColor(appearance.graphColor, DEFAULT_SETTINGS.appearance.graphColor),
      chartAnimations: normalizeBool(appearance.chartAnimations, DEFAULT_SETTINGS.appearance.chartAnimations)
    },
    standards: {
      dateFormat: normalizeDateFormat(standards.dateFormat),
      sessionGapMinutes: Number.isFinite(sessionGapRaw) ? Math.max(1, Math.min(360, Math.round(sessionGapRaw))) : DEFAULT_SETTINGS.standards.sessionGapMinutes
    }
  };
}

function getStorage(doc: Document): Storage | null {
  try {
    return doc.defaultView?.localStorage ?? null;
  } catch {
    return null;
  }
}

function getSystemPreferredTheme(doc: Document): ThemeMode {
  try {
    const w = doc.defaultView;
    if (!w || typeof w.matchMedia !== "function") return DEFAULT_SETTINGS.appearance.theme;
    if (w.matchMedia("(prefers-color-scheme: light)").matches) return "light";
    return "geoguessr";
  } catch {
    return DEFAULT_SETTINGS.appearance.theme;
  }
}

export function loadSettings(doc: Document): SemanticDashboardSettings {
  const storage = getStorage(doc);
  if (!storage) {
    const s = cloneTemplate(DEFAULT_SETTINGS);
    s.appearance.theme = getSystemPreferredTheme(doc);
    return s;
  }
  try {
    const themeOverrideRaw = storage.getItem(THEME_KEY);
    const raw = storage.getItem(SETTINGS_KEY);
    if (!raw) {
      const s = cloneTemplate(DEFAULT_SETTINGS);
      // If user never selected a theme, respect system preference.
      s.appearance.theme = themeOverrideRaw ? normalizeTheme(themeOverrideRaw) : getSystemPreferredTheme(doc);
      return s;
    }
    const s = normalizeSettings(JSON.parse(raw));
    // Always allow the theme key to override settings (single source of truth).
    if (themeOverrideRaw) s.appearance.theme = normalizeTheme(themeOverrideRaw);
    return s;
  } catch {
    const s = cloneTemplate(DEFAULT_SETTINGS);
    s.appearance.theme = getSystemPreferredTheme(doc);
    return s;
  }
}

export function saveSettings(doc: Document, settings: SemanticDashboardSettings): void {
  const storage = getStorage(doc);
  if (!storage) return;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    storage.setItem(THEME_KEY, settings.appearance.theme);
  } catch {
    // ignore storage issues
  }
}

export function loadDashboardTemplate(doc: Document, fallback: DashboardDoc): DashboardDoc {
  const storage = getStorage(doc);
  if (!storage) return cloneTemplate(fallback) as DashboardDoc;
  try {
    const raw = storage.getItem(DASHBOARD_TEMPLATE_KEY);
    if (!raw) return cloneTemplate(fallback) as DashboardDoc;
    const parsed = JSON.parse(raw) as DashboardDoc;
    // Forward-compatible merge: preserve user template but adopt newly added top-level features by default.
    const merged: DashboardDoc = {
      ...cloneTemplate(fallback),
      ...parsed,
      dashboard: {
        ...cloneTemplate(fallback).dashboard,
        ...(parsed as any).dashboard,
        globalFilters: (parsed as any).dashboard?.globalFilters ?? cloneTemplate(fallback).dashboard.globalFilters,
        sections: Array.isArray((parsed as any).dashboard?.sections) ? (parsed as any).dashboard.sections : cloneTemplate(fallback).dashboard.sections
      }
    };
    return merged;
  } catch {
    return cloneTemplate(fallback) as DashboardDoc;
  }
}

export function saveDashboardTemplate(doc: Document, dashboard: DashboardDoc): void {
  const storage = getStorage(doc);
  if (!storage) return;
  try {
    storage.setItem(DASHBOARD_TEMPLATE_KEY, JSON.stringify(dashboard, null, 2));
  } catch {
    // ignore storage issues
  }
}

export function applySettingsToRoot(root: HTMLDivElement, settings: SemanticDashboardSettings): void {
  root.dataset.gaTheme = settings.appearance.theme;
  root.dataset.gaChartAnimations = settings.appearance.chartAnimations ? "on" : "off";
  root.dataset.gaDateFormat = settings.standards.dateFormat;
  root.dataset.gaSessionGapMinutes = String(settings.standards.sessionGapMinutes);
  // GeoGuessr theme uses brand-tuned graph color regardless of the user's picker selection.
  root.style.setProperty("--ga-graph-color", settings.appearance.theme === "geoguessr" ? "#FECD19" : settings.appearance.graphColor);
}
