import type { DashboardDoc } from "../config/dashboard.types";

export type ThemeMode = "dark" | "light";
export type DateFormatMode = "dd/mm/yyyy" | "mm/dd/yyyy" | "yyyy-mm-dd" | "locale";

export type SemanticDashboardSettings = {
  appearance: {
    theme: ThemeMode;
    graphColor: string;
  };
  standards: {
    dateFormat: DateFormatMode;
    sessionGapMinutes: number;
  };
};

const SETTINGS_KEY = "geoanalyzr:semantic:settings:v1";
const DASHBOARD_TEMPLATE_KEY = "geoanalyzr:semantic:dashboard-template:v1";

export const DEFAULT_SETTINGS: SemanticDashboardSettings = {
  appearance: {
    theme: "dark",
    graphColor: "#7eb6ff"
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
  return value === "light" ? "light" : "dark";
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
      graphColor: normalizeColor(appearance.graphColor, DEFAULT_SETTINGS.appearance.graphColor)
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

export function loadSettings(doc: Document): SemanticDashboardSettings {
  const storage = getStorage(doc);
  if (!storage) return cloneTemplate(DEFAULT_SETTINGS);
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    if (!raw) return cloneTemplate(DEFAULT_SETTINGS);
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return cloneTemplate(DEFAULT_SETTINGS);
  }
}

export function saveSettings(doc: Document, settings: SemanticDashboardSettings): void {
  const storage = getStorage(doc);
  if (!storage) return;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
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
    return JSON.parse(raw) as DashboardDoc;
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
  root.dataset.gaDateFormat = settings.standards.dateFormat;
  root.dataset.gaSessionGapMinutes = String(settings.standards.sessionGapMinutes);
  root.style.setProperty("--ga-graph-color", settings.appearance.graphColor);
}
