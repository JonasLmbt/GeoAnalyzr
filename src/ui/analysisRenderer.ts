import type { SemanticRegistry } from "../config/semantic.types";
import type { DashboardDoc } from "../config/dashboard.types";
import { renderDashboard } from "./dashboardRenderer";
import { createGlobalFilterStore } from "./filterState";
import { renderGlobalFiltersBar } from "./globalFiltersBar";
import { getSelectOptionsForControl } from "../engine/selectOptions";
import { getGamePlayedAtBounds, getRounds } from "../engine/queryEngine";

export async function renderAnalysisApp(opts: {
  body: HTMLDivElement;
  semantic: SemanticRegistry;
  dashboard: DashboardDoc;
}): Promise<void> {
  const { body, semantic, dashboard } = opts;
  const doc = body.ownerDocument;

  body.innerHTML = "";

  const filtersHost = doc.createElement("div");
  filtersHost.className = "ga-filters-host";
  body.appendChild(filtersHost);

  const dashboardHost = doc.createElement("div");
  dashboardHost.className = "ga-dashboard-host";
  body.appendChild(dashboardHost);

  const spec = dashboard.dashboard.globalFilters;
  const store = createGlobalFilterStore(spec);

  // If date-range defaults are unspecified, initialize them to the full dataset span.
  if (spec?.enabled) {
    const bounds = await getGamePlayedAtBounds();
    if (bounds.minTs !== null && bounds.maxTs !== null) {
      for (const c of spec.controls) {
        if (c.type !== "date_range") continue;
        const current = store.getState()[c.id] as any;
        const isUnset =
          !current ||
          typeof current !== "object" ||
          ((current.fromTs === null || current.fromTs === undefined) && (current.toTs === null || current.toTs === undefined));
        if (!isUnset) continue;
        const next = { fromTs: bounds.minTs, toTs: bounds.maxTs };
        store.patchDefaults({ [c.id]: next });
        store.setValue(c.id, next);
      }
    }
  }

  const renderNow = async () => {
    await renderGlobalFiltersBar({
      container: filtersHost,
      semantic,
      spec,
      state: store.getState(),
      setValue: store.setValue,
      setAll: store.setAll,
      reset: store.reset,
      getDistinctOptions: async ({ control, spec: s, state }) => getSelectOptionsForControl({ control, spec: s, state })
    });
    const rows = await getRounds({ global: { spec, state: store.getState() } });
    await renderDashboard(dashboardHost, semantic, dashboard, { rows });
  };

  store.subscribe(() => {
    void renderNow();
  });

  await renderNow();
}
