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

    const specFilters = spec;
    const state = store.getState();

    const resolveControlIdsForSection = (section: any): string[] | undefined => {
      if (!specFilters?.enabled) return undefined;
      const all = specFilters.controls.map((c) => c.id);
      const include = Array.isArray(section?.filterScope?.include) ? section.filterScope.include : null;
      const exclude = Array.isArray(section?.filterScope?.exclude) ? section.filterScope.exclude : null;
      let ids = include && include.length ? all.filter((id) => include.includes(id)) : [...all];
      if (exclude && exclude.length) ids = ids.filter((id) => !exclude.includes(id));
      return ids;
    };

    const datasetsBySection: Record<string, Partial<Record<Grain, any[]>>> = {};
    const contextBySection: Record<string, { dateRange?: { fromTs: number | null; toTs: number | null } }> = {};

    for (const section of dashboard.dashboard.sections) {
      const controlIds = resolveControlIdsForSection(section);

      const used = new Set<Grain>();
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
          if (w.type === "record_list") {
            const recs = Array.isArray(anySpec?.records) ? anySpec.records : [];
            for (const r of recs) {
              if (typeof r?.metric === "string") {
                const m = semantic.measures[r.metric];
                if (m) used.add(m.grain);
              }
              if (typeof r?.groupBy === "string") {
                const d = semantic.dimensions[r.groupBy];
                const grains = d ? (Array.isArray(d.grain) ? d.grain : [d.grain]) : [];
                for (const g of grains as Grain[]) used.add(g);
              }
            }
          }
        }
      }

      const filters = { global: { spec: specFilters, state, controlIds } };
      const datasets: Partial<Record<Grain, any[]>> = {};
      if (used.has("round")) datasets.round = await getRounds(filters);
      if (used.has("game")) datasets.game = await getGames(filters);
      if (used.has("session")) datasets.session = [];
      datasetsBySection[section.id] = datasets;

      // Context dateRange should only be set if the section includes the dateRange control.
      const hasDate = !controlIds || controlIds.includes("dateRange");
      const dateVal = state["dateRange"] as any;
      const fromTs = hasDate && dateVal && typeof dateVal === "object" ? (dateVal.fromTs ?? null) : null;
      const toTs = hasDate && dateVal && typeof dateVal === "object" ? (dateVal.toTs ?? null) : null;
      contextBySection[section.id] = { dateRange: { fromTs, toTs } };
    }

    // Default datasets/context use all controls (kept for backwards compat).
    const allControlIds = specFilters?.enabled ? specFilters.controls.map((c) => c.id) : undefined;
    const filtersAll = { global: { spec: specFilters, state, controlIds: allControlIds } };
    const datasetsAll: Partial<Record<Grain, any[]>> = {};
    // Only load what the dashboard needs.
    const usedAll = new Set<Grain>();
    for (const section of dashboard.dashboard.sections) {
      const d = datasetsBySection[section.id];
      if (d?.round) usedAll.add("round");
      if (d?.game) usedAll.add("game");
      if (d?.session) usedAll.add("session");
    }
    if (usedAll.has("round")) datasetsAll.round = await getRounds(filtersAll);
    if (usedAll.has("game")) datasetsAll.game = await getGames(filtersAll);
    if (usedAll.has("session")) datasetsAll.session = [];
    const dateValAll = state["dateRange"] as any;
    const fromTsAll = dateValAll && typeof dateValAll === "object" ? (dateValAll.fromTs ?? null) : null;
    const toTsAll = dateValAll && typeof dateValAll === "object" ? (dateValAll.toTs ?? null) : null;
    await renderDashboard(dashboardHost, semantic, dashboard, {
      datasets: datasetsAll,
      datasetsBySection,
      context: { dateRange: { fromTs: fromTsAll, toTs: toTsAll } },
      contextBySection
    });
  };

  store.subscribe(() => {
    void renderNow();
  });

  await renderNow();
}
