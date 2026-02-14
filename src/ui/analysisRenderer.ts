import type { SemanticRegistry } from "../config/semantic.types";
import type { DashboardDoc } from "../config/dashboard.types";
import { renderDashboard } from "./dashboardRenderer";
import { createGlobalFilterStore } from "./filterState";
import { renderGlobalFiltersBar } from "./globalFiltersBar";
import { getSelectOptionsForControl } from "../engine/selectOptions";
import { getGamePlayedAtBounds, getRounds, getGames, getSessions, hasAnyTeamDuels } from "../engine/queryEngine";
import type { Grain } from "../config/semantic.types";

function explodeOpponentsFromGames(games: any[]): any[] {
  const out: any[] = [];
  for (const g of games as any[]) {
    const base: any = { ...g };
    const mf = String(base?.modeFamily ?? "").toLowerCase();
    const matchups = mf === "teamduels" ? 2 : 1;

    const pushOpp = (name: unknown, country: unknown) => {
      const n = typeof name === "string" ? name.trim() : "";
      if (!n) return;
      const c = typeof country === "string" ? country.trim() : "";
      out.push({ ...base, opponentName: n, opponentCountry: c || "Unknown", matchups });
    };

    pushOpp(base.player_opponent_name ?? base.playerOpponentName, base.player_opponent_country ?? base.playerOpponentCountry);
    pushOpp(base.player_opponent_mate_name ?? base.playerOpponentMateName, base.player_opponent_mate_country ?? base.playerOpponentMateCountry);
  }
  return out;
}

export async function renderAnalysisApp(opts: {
  body: HTMLDivElement;
  semantic: SemanticRegistry;
  dashboard: DashboardDoc;
}): Promise<void> {
  const { body, semantic, dashboard } = opts;
  const doc = body.ownerDocument;

  body.innerHTML = "";

  const root = body.closest(".ga-root") as HTMLDivElement | null;
  const getSessionGapMinutes = (): number => {
    const raw = Number(root?.dataset.gaSessionGapMinutes);
    if (Number.isFinite(raw)) return Math.max(1, Math.min(360, Math.round(raw)));
    return semantic.settings?.sessionGapMinutesDefault ?? 45;
  };

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
    const specFilters = spec;
    let state = store.getState();

    await renderGlobalFiltersBar({
      container: filtersHost,
      semantic,
      spec,
      state,
      setValue: store.setValue,
      setAll: store.setAll,
      reset: store.reset,
      getDistinctOptions: async ({ control, spec: s, state: st }) => getSelectOptionsForControl({ control, spec: s, state: st })
    });

    const resolveControlIdsForSection = (section: any): string[] | undefined => {
      if (!specFilters?.enabled) return undefined;
      const all = specFilters.controls.map((c) => c.id);
      const include = Array.isArray(section?.filterScope?.include) ? section.filterScope.include : null;
      const exclude = Array.isArray(section?.filterScope?.exclude) ? section.filterScope.exclude : null;
      let ids = include && include.length ? all.filter((id) => include.includes(id)) : [...all];
      if (exclude && exclude.length) ids = ids.filter((id) => !exclude.includes(id));
      return ids;
    };

    const hasTeamDuels = await hasAnyTeamDuels();
    const sections = hasTeamDuels
      ? dashboard.dashboard.sections
      : dashboard.dashboard.sections.filter((s) => s.id !== "team");

    const datasetsBySection: Record<string, Partial<Record<Grain, any[]>>> = {};
    const contextBySection: Record<string, { dateRange?: { fromTs: number | null; toTs: number | null } }> = {};

    for (const section of sections) {
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
              if (Array.isArray(r?.streakFilters) && r.streakFilters.length > 0) used.add("round");
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
      const isOpponentsSection = section.id === "opponents";
      if (used.has("round") || used.has("session") || isOpponentsSection) datasets.round = await getRounds(filters);
      if (used.has("game") || isOpponentsSection) datasets.game = await getGames(filters);
      if (used.has("session")) {
        const gap = getSessionGapMinutes();
        datasets.session = await getSessions({ global: { spec: specFilters, state, controlIds, sessionGapMinutes: gap } }, { rounds: datasets.round as any });
      }

      if (isOpponentsSection && Array.isArray(datasets.game)) {
        // Ensure round-grain filters like teammate/country influence opponent stats by filtering games to those present in rounds.
        const rr = Array.isArray(datasets.round) ? (datasets.round as any[]) : [];
        if (rr.length) {
          const allowed = new Set(rr.map((r) => (r as any)?.gameId).filter((x) => typeof x === "string" && x));
          datasets.game = (datasets.game as any[]).filter((g) => allowed.has((g as any)?.gameId));
        }
        // Explode each game into one row per opponent (opponent + opponent_mate).
        datasets.game = explodeOpponentsFromGames(datasets.game as any[]);
      }
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
    for (const section of sections) {
      const d = datasetsBySection[section.id];
      if (d?.round) usedAll.add("round");
      if (d?.game) usedAll.add("game");
      if (d?.session) usedAll.add("session");
    }
    if (usedAll.has("round") || usedAll.has("session")) datasetsAll.round = await getRounds(filtersAll);
    if (usedAll.has("game")) datasetsAll.game = await getGames(filtersAll);
    if (usedAll.has("session")) {
      const gap = getSessionGapMinutes();
      datasetsAll.session = await getSessions({ global: { spec: specFilters, state, controlIds: allControlIds, sessionGapMinutes: gap } }, { rounds: datasetsAll.round as any });
    }
    const dateValAll = state["dateRange"] as any;
    const fromTsAll = dateValAll && typeof dateValAll === "object" ? (dateValAll.fromTs ?? null) : null;
    const toTsAll = dateValAll && typeof dateValAll === "object" ? (dateValAll.toTs ?? null) : null;

    const effectiveDashboard: DashboardDoc = {
      ...dashboard,
      dashboard: {
        ...dashboard.dashboard,
        sections
      }
    };

    await renderDashboard(dashboardHost, semantic, effectiveDashboard, {
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
