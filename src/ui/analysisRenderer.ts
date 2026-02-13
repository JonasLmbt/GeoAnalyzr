import type { SemanticRegistry } from "../config/semantic.types";
import type { DashboardDoc } from "../config/dashboard.types";
import { renderDashboard } from "./dashboardRenderer";
import { createGlobalFilterStore } from "./filterState";
import { renderGlobalFiltersBar } from "./globalFiltersBar";
import { getSelectOptionsForControl } from "../engine/selectOptions";
import { getGamePlayedAtBounds, getRounds, getGames } from "../engine/queryEngine";
import type { Grain } from "../config/semantic.types";

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

    const used = new Set<Grain>();
    for (const section of dashboard.dashboard.sections) {
      for (const placed of section.layout.cards) {
        for (const w of placed.card.children) {
          used.add(w.grain);

          // If a widget references measures/dimensions of other grains, ensure we load them too.
          const anySpec: any = w.spec as any;
          if (w.type === "chart") {
            const xDimId = anySpec?.x?.dimension;
            const xDim = xDimId ? semantic.dimensions[xDimId] : undefined;
            const xGrains = xDim ? (Array.isArray(xDim.grain) ? xDim.grain : [xDim.grain]) : [];
            for (const g of xGrains as Grain[]) used.add(g);

            const ids: string[] = [];
            if (typeof anySpec?.y?.measure === "string") ids.push(anySpec.y.measure);
            if (Array.isArray(anySpec?.y?.measures)) ids.push(...anySpec.y.measures);
            for (const mId of ids) {
              const m = semantic.measures[mId];
              if (m) used.add(m.grain);
            }
          }
          if (w.type === "breakdown") {
            const ids: string[] = [];
            if (typeof anySpec?.measure === "string") ids.push(anySpec.measure);
            if (Array.isArray(anySpec?.measures)) ids.push(...anySpec.measures);
            for (const mId of ids) {
              const m = semantic.measures[mId];
              if (m) used.add(m.grain);
            }
          }
          if (w.type === "stat_list") {
            const rows = Array.isArray(anySpec?.rows) ? anySpec.rows : [];
            for (const r of rows) {
              const m = semantic.measures[r?.measure];
              if (m) used.add(m.grain);
            }
          }
          if (w.type === "stat_value") {
            const m = semantic.measures[anySpec?.measure];
            if (m) used.add(m.grain);
          }
        }
      }
    }

    const datasets: Partial<Record<Grain, any[]>> = {};
    const filters = { global: { spec, state: store.getState() } };
    if (used.has("round")) datasets.round = await getRounds(filters);
    if (used.has("game")) datasets.game = await getGames(filters);
    if (used.has("session")) datasets.session = [];

    const dateVal = store.getState()["dateRange"] as any;
    const fromTs = dateVal && typeof dateVal === "object" ? (dateVal.fromTs ?? null) : null;
    const toTs = dateVal && typeof dateVal === "object" ? (dateVal.toTs ?? null) : null;
    await renderDashboard(dashboardHost, semantic, dashboard, { datasets, context: { dateRange: { fromTs, toTs } } });
  };

  store.subscribe(() => {
    void renderNow();
  });

  await renderNow();
}
