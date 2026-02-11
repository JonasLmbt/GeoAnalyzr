import type { SemanticRegistry } from "../config/semantic.types";
import type { DashboardDoc } from "../config/dashboard.types";
import { renderDashboard } from "./dashboardRenderer";
import { createGlobalFilterStore } from "./filterState";
import { renderGlobalFiltersBar } from "./globalFiltersBar";
import { getDistinctValuesForSelectControl } from "../engine/distinctOptions";
import { getRounds } from "../engine/queryEngine";

export async function renderAnalysisApp(opts: {
  root: HTMLDivElement;
  body: HTMLDivElement;
  semantic: SemanticRegistry;
  dashboard: DashboardDoc;
}): Promise<void> {
  const { root, body, semantic, dashboard } = opts;
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

  const renderNow = async () => {
    await renderGlobalFiltersBar({
      container: filtersHost,
      semantic,
      spec,
      state: store.getState(),
      setValue: store.setValue,
      setAll: store.setAll,
      reset: store.reset,
      getDistinctOptions: async ({ control, spec: s, state }) => getDistinctValuesForSelectControl({ control, spec: s, state })
    });
    const rows = await getRounds({ global: { spec, state: store.getState() } });
    await renderDashboard(dashboardHost, semantic, dashboard, { rows });
  };

  store.subscribe(() => {
    void renderNow();
  });

  await renderNow();
}
