import type { SemanticRegistry } from "../config/semantic.types";
import type { DashboardDoc } from "../config/dashboard.types";
import { renderDashboard } from "./dashboardRenderer";
import { createGlobalFilterStore } from "./filterState";
import { renderGlobalFiltersBar } from "./globalFiltersBar";
import { getSelectOptionsForControl } from "../engine/selectOptions";
import { getGamePlayedAtBounds, getRounds, getGames, getSessions, hasAnyTeamDuels } from "../engine/queryEngine";
import type { Grain } from "../config/semantic.types";
import { analysisConsole, formatConsoleEntry } from "./consoleStore";
import { getLoadingProgress, setLoadingProgress } from "../progress";

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

  const sleep0 = async (): Promise<void> => {
    await new Promise<void>((r) => setTimeout(r, 0));
  };

  let loadingEl: HTMLDivElement | null = null;
  let loadingConsolePre: HTMLPreElement | null = null;
  let loadingProgressText: HTMLDivElement | null = null;
  let loadingProgressBar: HTMLDivElement | null = null;
  let loadingUnsub: (() => void) | null = null;
  let loadingPoll: number | null = null;
  let loadingStepTotal = 0;
  let loadingStepCurrent = 0;
  let didInitialRender = false;

  const renderAsciiBar = (current: number, total: number): string => {
    const w = 22;
    const t = total > 0 ? Math.max(0, Math.min(1, current / total)) : 0;
    const filled = Math.round(t * w);
    return `[${"#".repeat(filled)}${"-".repeat(Math.max(0, w - filled))}] ${current}/${total}`;
  };

  const updateLoadingConsole = (): void => {
    if (!loadingConsolePre) return;
    const slice = analysisConsole.entries.slice(Math.max(0, analysisConsole.entries.length - 12));
    loadingConsolePre.textContent = slice.map(formatConsoleEntry).join("\n");
    loadingConsolePre.scrollTop = loadingConsolePre.scrollHeight;
  };

  const updateLoadingProgress = (): void => {
    const p = getLoadingProgress();
    const phase = p?.phase ?? "";
    const cur = typeof p?.current === "number" ? p.current : undefined;
    const tot = typeof p?.total === "number" ? p.total : undefined;

    const pct = tot && cur !== undefined ? Math.max(0, Math.min(1, cur / tot)) : undefined;
    if (loadingProgressBar) {
      loadingProgressBar.style.width = pct !== undefined ? `${(pct * 100).toFixed(1)}%` : "25%";
      loadingProgressBar.style.opacity = pct !== undefined ? "1" : "0.55";
    }
    if (loadingProgressText) {
      const stepTxt = loadingStepTotal > 0 ? `Step ${Math.max(1, loadingStepCurrent)}/${loadingStepTotal}` : "";
      const barTxt = cur !== undefined && tot !== undefined ? renderAsciiBar(cur, tot) : "";
      const main = [stepTxt, phase].filter(Boolean).join(" • ");
      loadingProgressText.textContent = [main, barTxt].filter(Boolean).join("\n");
    }
  };

  const showLoading = async (subtitle: string, opts?: { stepCurrent?: number; stepTotal?: number }) => {
    if (!doc.body) return;
    if (!loadingEl) {
      loadingEl = doc.createElement("div");
      loadingEl.className = "ga-loading-screen";
      loadingEl.innerHTML =
        "<div class=\"ga-loading-screen-inner\">" +
        "  <div class=\"ga-loading-top\">" +
        "    <div class=\"ga-spinner\"></div>" +
        "    <div class=\"ga-loading-screen-text\">" +
        "      <div class=\"ga-loading-screen-title\">GeoAnalyzr</div>" +
        "      <div class=\"ga-loading-screen-subtitle\"></div>" +
        "    </div>" +
        "  </div>" +
        "  <div class=\"ga-loading-progress\">" +
        "    <div class=\"ga-loading-progress-track\"><div class=\"ga-loading-progress-bar\"></div></div>" +
        "    <div class=\"ga-loading-progress-text\"></div>" +
        "  </div>" +
        "  <pre class=\"ga-loading-console\"></pre>" +
        "</div>";
      loadingConsolePre = loadingEl.querySelector(".ga-loading-console") as HTMLPreElement | null;
      loadingProgressText = loadingEl.querySelector(".ga-loading-progress-text") as HTMLDivElement | null;
      loadingProgressBar = loadingEl.querySelector(".ga-loading-progress-bar") as HTMLDivElement | null;

      loadingUnsub = analysisConsole.subscribe(() => updateLoadingConsole());
      loadingPoll = doc.defaultView?.setInterval(() => updateLoadingProgress(), 120) ?? null;
    }
    const subtitleEl = loadingEl.querySelector(".ga-loading-screen-subtitle") as HTMLDivElement | null;
    if (subtitleEl) subtitleEl.textContent = subtitle;
    const host = root ?? doc.body;
    if (!loadingEl.isConnected) host.appendChild(loadingEl);
    if (typeof opts?.stepTotal === "number") loadingStepTotal = opts.stepTotal;
    if (typeof opts?.stepCurrent === "number") loadingStepCurrent = opts.stepCurrent;
    setLoadingProgress({ phase: subtitle });
    analysisConsole.info(subtitle);
    updateLoadingConsole();
    updateLoadingProgress();
    await sleep0(); // allow paint before heavy work
  };
  const hideLoading = () => {
    loadingEl?.remove();
    loadingUnsub?.();
    loadingUnsub = null;
    if (loadingPoll !== null && doc.defaultView) doc.defaultView.clearInterval(loadingPoll);
    loadingPoll = null;
    setLoadingProgress(null);
  };

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

  // Preserve active tab across global filter re-renders (renderDashboard() rebuilds the DOM).
  const targetWindow = doc.defaultView as any;
  if (typeof targetWindow.__gaActiveSectionId !== "string") targetWindow.__gaActiveSectionId = "";

  const updateStickyVars = () => {
    if (!root) return;
    const topbar = root.querySelector(".ga-topbar") as HTMLElement | null;
    root.style.setProperty("--ga-topbar-h", `${topbar?.offsetHeight ?? 0}px`);
    root.style.setProperty("--ga-filters-h", `${filtersHost.offsetHeight}px`);
  };

  // Keep sticky offsets in sync with dynamic content/wrapping.
  if (root && !(root as any).__gaStickyVarsSetup) {
    (root as any).__gaStickyVarsSetup = true;
    updateStickyVars();

    const win = doc.defaultView;
    if (win && typeof (win as any).ResizeObserver !== "undefined") {
      const ro = new (win as any).ResizeObserver(() => updateStickyVars());
      ro.observe(filtersHost);
      const topbar = root.querySelector(".ga-topbar") as HTMLElement | null;
      if (topbar) ro.observe(topbar);
    }
    win?.addEventListener("resize", () => updateStickyVars());
  }

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
    if (!didInitialRender) await showLoading("Rendering dashboard...");
    const specFilters = spec;
    let state = store.getState();

    try {
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

      // Height can change due to select options and wrapping.
      updateStickyVars();

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
    const sections = hasTeamDuels ? dashboard.dashboard.sections : dashboard.dashboard.sections.filter((s) => s.id !== "team");

    const datasetsBySection: Record<string, Partial<Record<Grain, any[]>>> = {};
    const contextBySection: Record<string, { dateRange?: { fromTs: number | null; toTs: number | null } }> = {};

    const computeDatasetsForSection = async (section: any): Promise<void> => {
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
      const isRatingSection = section.id === "rating";
      const steps: string[] = [];
      if (used.has("round") || used.has("session") || isOpponentsSection) steps.push("rounds");
      if (used.has("game") || isOpponentsSection) steps.push("games");
      if (used.has("session")) steps.push("sessions");
      const totalSteps = steps.length + 1; // + rendering
      let step = 0;

      const teammateSelected = (() => {
        const v = state?.["teammate"];
        if (v === "all") return false;
        if (typeof v !== "string") return false;
        return v.trim().length > 0;
      })();
      if (used.has("round") || used.has("session") || isOpponentsSection) {
        step++;
        datasets.round = await getRounds(filters);
      }
      if (used.has("game") || isOpponentsSection) {
        step++;
        datasets.game = await getGames(filters);
      }

      if (isRatingSection && Array.isArray(datasets.round)) {
        const want = teammateSelected ? "teamduels" : "duels";
        datasets.round = (datasets.round as any[]).filter((r) => String((r as any)?.modeFamily ?? "").toLowerCase() === want);
      }
      if (isRatingSection && Array.isArray(datasets.game)) {
        const want = teammateSelected ? "teamduels" : "duels";
        datasets.game = (datasets.game as any[]).filter((g) => String((g as any)?.modeFamily ?? "").toLowerCase() === want);
      }

      // If we have any round-grain filters active (e.g. country/teammate/movement), ensure they influence game-grain datasets.
      if (Array.isArray(datasets.round) && Array.isArray(datasets.game) && specFilters?.enabled) {
        const allowedSet = Array.isArray(controlIds) && controlIds.length > 0 ? new Set(controlIds) : null;
        const hasActiveRoundOnly = specFilters.controls.some((c) => {
          if (allowedSet && !allowedSet.has(c.id)) return false;
          const appliesRound = Array.isArray((c as any).appliesTo) && (c as any).appliesTo.includes("round");
          const appliesGame = Array.isArray((c as any).appliesTo) && (c as any).appliesTo.includes("game");
          if (!appliesRound || appliesGame) return false;
          const v = state[c.id];
          return typeof v === "string" ? v !== "all" && v.trim().length > 0 : false;
        });

        if (hasActiveRoundOnly) {
          const rr = datasets.round as any[];
          if (rr.length) {
            const allowedGames = new Set(rr.map((r) => (r as any)?.gameId).filter((x) => typeof x === "string" && x));
            datasets.game = (datasets.game as any[]).filter((g) => allowedGames.has((g as any)?.gameId));
          }
        }
      }
      if (used.has("session")) {
        step++;
        const gap = getSessionGapMinutes();
        datasets.session = await getSessions({ global: { spec: specFilters, state, controlIds, sessionGapMinutes: gap } }, { rounds: datasets.round as any });
      }

      if (isOpponentsSection && Array.isArray(datasets.game)) {
        datasets.game = explodeOpponentsFromGames(datasets.game as any[]);
      }
      datasetsBySection[section.id] = datasets;

      const hasDate = !controlIds || controlIds.includes("dateRange");
      const dateVal = state["dateRange"] as any;
      const fromTs = hasDate && dateVal && typeof dateVal === "object" ? (dateVal.fromTs ?? null) : null;
      const toTs = hasDate && dateVal && typeof dateVal === "object" ? (dateVal.toTs ?? null) : null;
      contextBySection[section.id] = { dateRange: { fromTs, toTs } };
    };

    const desired = typeof targetWindow.__gaActiveSectionId === "string" ? targetWindow.__gaActiveSectionId : "";
    const initialActive = (desired && sections.some((s: any) => s.id === desired) ? desired : sections[0]?.id) ?? "";

    if (initialActive) {
      const sec = sections.find((s: any) => s.id === initialActive);
      if (sec) await computeDatasetsForSection(sec);
    }

    const datasetsDefault = initialActive ? datasetsBySection[initialActive] ?? {} : {};
    const contextDefault = initialActive ? contextBySection[initialActive] : undefined;

    const effectiveDashboard: DashboardDoc = { ...dashboard, dashboard: { ...dashboard.dashboard, sections } };

    // Rendering always counted as last step (after data).
    const finalTotal = loadingStepTotal > 0 ? loadingStepTotal : 1;
    if (!didInitialRender) await showLoading("Rendering UI...", { stepCurrent: finalTotal, stepTotal: finalTotal });
    await renderDashboard(dashboardHost, semantic, effectiveDashboard, {
      datasets: datasetsDefault,
      datasetsBySection,
      context: contextDefault,
      contextBySection,
      initialActiveSectionId: initialActive,
      onActiveSectionChange: async (id) => {
        targetWindow.__gaActiveSectionId = id;
        if (!id) return;
        if (datasetsBySection[id]) return;
        const sec = sections.find((s: any) => s.id === id);
        if (!sec) return;
        await computeDatasetsForSection(sec);
      }
    });
    } finally {
      didInitialRender = true;
      hideLoading();
    }
  };

  store.subscribe(() => {
    void renderNow();
  });

  await renderNow();
}
