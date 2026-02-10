// src/ui.ts
import type { SemanticRegistry } from "./config/semantic.types";
import type { DashboardDoc } from "./config/dashboard.types";
import { renderDashboard } from "./ui/dashboardRenderer";
import { validateDashboardAgainstSemantic } from "./engine/validate"; // from earlier message if you kept it
import { createUI as createLegacyUI } from "./ui.legacy";

// Keep main.ts stable during experiment phase.
// This adapter lets the existing app boot while new UI concept evolves in parallel.
export const createUI = createLegacyUI;

async function loadJson<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`Failed to load ${path}: ${r.status}`);
  return (await r.json()) as T;
}

export async function initAnalysisWindow(): Promise<void> {
  const root = document.createElement("div");
  root.id = "geoanalyzr-root";
  document.body.appendChild(root);

  const semantic = await loadJson<SemanticRegistry>("/semantic.json");
  const dashboard = await loadJson<DashboardDoc>("/dashboard.json");

  // Hard semantic validation (grain mismatch etc.)
  validateDashboardAgainstSemantic(semantic, dashboard);

  await renderDashboard(root, semantic, dashboard);
}
