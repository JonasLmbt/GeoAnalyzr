// src/ui/dashboardRenderer.ts
import type { SemanticRegistry } from "../config/semantic.types";
import type { DashboardDoc, WidgetDef } from "../config/dashboard.types";
import type { Grain } from "../config/semantic.types";
import type { RoundRow, GameFactRow } from "../db";
import { DrilldownOverlay } from "./drilldownOverlay";
import { renderStatListWidget } from "./widgets/statListWidget";
import { renderStatValueWidget } from "./widgets/statValueWidget";
import { renderChartWidget } from "./widgets/chartWidget";
import { renderBreakdownWidget } from "./widgets/breakdownWidget";
import { renderRecordListWidget } from "./widgets/recordListWidget";
import { renderLeaderListWidget } from "./widgets/leaderListWidget";
import { renderCountryMetricMapWidget } from "./widgets/countryMetricMapWidget";
import { renderRegionMetricMapWidget } from "./widgets/regionMetricMapWidget";
import { renderPointMapWidget } from "./widgets/pointMapWidget";
import { renderMultiViewWidget } from "./widgets/multiViewWidget";
import { renderCountryMapPicker } from "./countryMapPicker";
import type { LocalFilterControlSpec, LocalFiltersSpec } from "../config/dashboard.types";
import { ROUND_DIMENSION_EXTRACTORS } from "../engine/dimensions";
import { applyFilters } from "../engine/filters";
import { getSessions } from "../engine/queryEngine";


export async function renderDashboard(
  root: HTMLElement,
  semantic: SemanticRegistry,
  dashboard: DashboardDoc,
  opts?: {
    datasets?: Partial<Record<Grain, any[]>>;
    datasetsBySection?: Record<string, Partial<Record<Grain, any[]>>>;
    context?: { dateRange?: { fromTs: number | null; toTs: number | null } };
    contextBySection?: Record<string, { dateRange?: { fromTs: number | null; toTs: number | null } }>;
    initialActiveSectionId?: string;
    onActiveSectionChange?: (sectionId: string) => void | Promise<void>;
  }
): Promise<void> {
  root.innerHTML = "";
  const doc = root.ownerDocument;

  const overlay = new DrilldownOverlay(root);
  const datasetsDefault = opts?.datasets ?? {};
  const datasetsBySection = opts?.datasetsBySection ?? {};
  const contextDefault = opts?.context;
  const contextBySection = opts?.contextBySection ?? {};
  let activeDatasets: Partial<Record<Grain, any[]>> = datasetsDefault;
  let activeContext: { dateRange?: { fromTs: number | null; toTs: number | null } } | undefined = contextDefault;

  const tabBar = doc.createElement("div");
  tabBar.className = "ga-tabs";

  const content = doc.createElement("div");
  content.className = "ga-content";

  root.appendChild(tabBar);
  root.appendChild(content);

  const sections = dashboard.dashboard.sections;
  const desired = typeof opts?.initialActiveSectionId === "string" ? opts.initialActiveSectionId : "";
  let active = (desired && sections.some((s) => s.id === desired) ? desired : sections[0]?.id) ?? "";
  const localStateBySection = new Map<string, Record<string, string>>();

  function makeTab(secId: string, label: string) {
    const btn = doc.createElement("button");
    btn.className = "ga-tab";
    btn.textContent = label;
    btn.addEventListener("click", async () => {
      active = secId;
      await renderActive();
      highlight();
    });
    tabBar.appendChild(btn);
  }

  function highlight() {
    const btns = Array.from(tabBar.querySelectorAll("button.ga-tab"));
    btns.forEach((b, i) => {
      b.classList.toggle("active", sections[i]?.id === active);
    });
  }

  async function renderWidget(widget: WidgetDef): Promise<HTMLElement> {
    const baseRows = activeDatasets[widget.grain];
    if (widget.type === "stat_list") return await renderStatListWidget(semantic, widget, overlay, activeDatasets, baseRows as any);
    if (widget.type === "stat_value") return await renderStatValueWidget(semantic, widget, overlay, baseRows as any);
    if (widget.type === "chart") return await renderChartWidget(semantic, widget, overlay, activeDatasets, activeContext);
    if (widget.type === "breakdown") return await renderBreakdownWidget(semantic, widget, overlay, baseRows as any);
    if (widget.type === "country_map") return await renderCountryMetricMapWidget(semantic, widget, overlay, baseRows as any);
    if (widget.type === "region_map") return await renderRegionMetricMapWidget(semantic, widget, overlay, baseRows as any);
    if (widget.type === "point_map") return await renderPointMapWidget(semantic, widget, overlay, baseRows as any);
    if (widget.type === "multi_view") {
      return await renderMultiViewWidget({
        semantic,
        widget,
        overlay,
        datasets: activeDatasets,
        context: activeContext,
        renderChild: async (child) => {
          // Ensure child widgets inherit the parent widgetId prefix for stable drilldown titles.
          return await renderWidget(child);
        }
      });
    }
    if (widget.type === "record_list") return await renderRecordListWidget(semantic, widget, overlay, baseRows as any);
    if (widget.type === "leader_list") return await renderLeaderListWidget(semantic, widget, overlay, baseRows as any);

    // placeholders for the next iterations
    const ph = doc.createElement("div");
    ph.className = "ga-widget ga-placeholder";
    ph.textContent = `Widget type '${widget.type}' not implemented yet`;
    return ph;
  }

  const describeWidgetError = (e: any): string => {
    if (e instanceof Error) return `${e.name}: ${e.message}`;
    const msg = typeof e?.message === "string" ? e.message : "";
    if (msg) return msg;
    try {
      const seen = new WeakSet<object>();
      const json = JSON.stringify(
        e,
        (_k, v) => {
          if (typeof v === "bigint") return String(v);
          if (v && typeof v === "object") {
            if (seen.has(v as object)) return "[Circular]";
            seen.add(v as object);
          }
          return v;
        },
        2
      );
      if (typeof json === "string" && json && json !== "{}") return json;
    } catch {
      // ignore
    }
    try {
      const ctor = e?.constructor?.name;
      const tag = Object.prototype.toString.call(e);
      const keys = e && typeof e === "object" ? Object.getOwnPropertyNames(e).slice(0, 24).join(", ") : "";
      return `${ctor ? `${ctor} ` : ""}${tag}${keys ? ` keys=[${keys}]` : ""}`.trim();
    } catch {
      return String(e);
    }
  };

  const readCountryFormatMode = (): "iso2" | "english" => {
    const rootEl = (root.closest?.(".ga-root") as HTMLElement | null) ?? null;
    return rootEl?.dataset?.gaCountryFormat === "english" ? "english" : "iso2";
  };

  const formatCountry = (isoOrName: string): string => {
    if (readCountryFormatMode() === "iso2") return isoOrName;
    const iso2 = isoOrName.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(iso2)) return isoOrName;
    if (typeof Intl === "undefined" || !(Intl as any).DisplayNames) return isoOrName;
    try {
      const dn = new (Intl as any).DisplayNames(["en"], { type: "region" });
      return dn.of(iso2) ?? isoOrName;
    } catch {
      return isoOrName;
    }
  };

  const interpolate = (text: string, localState: Record<string, string>, dimById?: Record<string, string>): string => {
    return String(text).replace(/\{\{\s*local\.([A-Za-z0-9_\-]{3,64})\s*\}\}/g, (_, id: string) => {
      const v = localState[id];
      const raw = typeof v === "string" && v !== "all" ? v : "";
      const dim = dimById?.[id];
      if (!raw) return "";
      if (dim === "true_country" || dim === "guess_country" || dim === "opponent_country") return formatCountry(raw);
      return raw;
    });
  };

  const renderLocalFiltersBar = async (args: {
    host: HTMLElement;
    spec: LocalFiltersSpec;
    sectionId: string;
    datasets: Partial<Record<Grain, any[]>>;
    onChange: () => void;
  }): Promise<Record<string, string>> => {
    const { host, spec, sectionId, datasets, onChange } = args;
    host.innerHTML = "";
    if (spec.enabled === false) return {};

    const base = localStateBySection.get(sectionId) ?? {};
    const nextState: Record<string, string> = { ...base };

    const bar = doc.createElement("div");
    bar.className = "ga-filters";
    host.appendChild(bar);

    const left = doc.createElement("div");
    left.className = "ga-filters-left";
    bar.appendChild(left);

    const right = doc.createElement("div");
    right.className = "ga-filters-right";
    bar.appendChild(right);

    const renderControlLabel = (label: string): HTMLElement => {
      const el = doc.createElement("div");
      el.className = "ga-filter-label";
      el.textContent = label;
      return el;
    };

    const durationOrder = ["<20 sec", "20-30 sec", "30-45 sec", "45-60 sec", "60-90 sec", "90-180 sec", ">180 sec"];
    const durationRank = new Map(durationOrder.map((k, i) => [k, i]));

    const movementLabel = (v: string): string => {
      const k = v.trim().toLowerCase();
      if (k === "moving") return "Moving";
      if (k === "no_move") return "No move";
      if (k === "nmpz") return "NMPZ";
      if (k === "unknown") return "Unknown";
      return v;
    };

    const computeOptions = (control: LocalFilterControlSpec, stateWithoutSelf: Record<string, string>): { value: string; label: string; n: number }[] => {
      const grains = control.appliesTo;
      const g = grains.includes("round") ? "round" : grains[0];
      const rowsBase = datasets[g as Grain];
      const rowsAll = Array.isArray(rowsBase) ? rowsBase : [];

      const clauses = (spec.controls as LocalFilterControlSpec[])
        .filter((c) => c.id !== control.id)
        .map((c) => ({ control: c, value: stateWithoutSelf[c.id] }))
        .filter((x) => typeof x.value === "string" && x.value && x.value !== "all")
        .map((x) => ({ dimension: x.control.dimension, op: "eq" as const, value: x.value }));

      const filtered = clauses.length ? applyFilters(rowsAll, clauses as any, g as Grain) : rowsAll;

      if (control.options === "auto_teammates") {
        const gamesByMate = new Map<string, Set<string>>();
        const roundsByMate = new Map<string, number>();
        for (const r of filtered) {
          const mate = (r as any).teammateName;
          const name = typeof mate === "string" ? mate.trim() : "";
          if (!name) continue;
          const gameId = String((r as any).gameId ?? "");
          if (!gameId) continue;
          const set = gamesByMate.get(name) ?? new Set<string>();
          set.add(gameId);
          gamesByMate.set(name, set);
          roundsByMate.set(name, (roundsByMate.get(name) ?? 0) + 1);
        }
        return Array.from(gamesByMate.entries())
          .map(([name, games]) => ({
            value: name,
            label: `${name} (${games.size} games, ${roundsByMate.get(name) ?? 0} rounds)`,
            n: games.size
          }))
          .sort((a, b) => (b.n - a.n) || a.value.localeCompare(b.value));
      }

      const dimId = control.dimension;
      const extractor = ROUND_DIMENSION_EXTRACTORS[dimId];
      if (!extractor) return [];

      const counts = new Map<string, number>();
      for (const r of filtered) {
        const v = extractor(r);
        if (typeof v === "string" && v.length) counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      let values = Array.from(counts.entries())
        .map(([value, n]) => ({ value, n }))
        .sort((a, b) => (b.n - a.n) || a.value.localeCompare(b.value));
      if (dimId === "duration_bucket") values = values.sort((a, b) => (durationRank.get(a.value) ?? 999) - (durationRank.get(b.value) ?? 999));

      return values.map((v) => {
        const baseLabel =
          dimId === "movement_type"
            ? movementLabel(v.value)
            : dimId === "true_country" || dimId === "guess_country" || dimId === "opponent_country"
              ? formatCountry(v.value)
              : v.value;
        return {
          value: v.value,
          label: `${baseLabel} (${v.n} rounds)`,
          n: v.n
        };
      });
    };

    for (const control of spec.controls as LocalFilterControlSpec[]) {
      const wrap = doc.createElement("div");
      wrap.className = "ga-filter";
      wrap.appendChild(renderControlLabel(control.label));

      const stateWithoutSelf: Record<string, string> = { ...nextState };
      delete stateWithoutSelf[control.id];
      const options = computeOptions(control, stateWithoutSelf);
 
      const isRequired = control.required === true;

      const current = typeof nextState[control.id] === "string" ? nextState[control.id] : "";
      const hasCurrent = options.some((o) => o.value === current);
      const desiredDefault = control.default === "auto_top" ? "" : control.default;
      const next =
        hasCurrent
          ? current
          : desiredDefault && options.some((o) => o.value === desiredDefault)
            ? desiredDefault
            : isRequired
              ? (options[0]?.value ?? "")
              : "all";

      if (next && next !== current) nextState[control.id] = next;

      const isCountryDim = control.dimension === "true_country" || control.dimension === "guess_country" || control.dimension === "opponent_country";
      const presentation = (control as any).presentation;
      const useMap = presentation === "map" && isCountryDim;

      if (useMap) {
        wrap.classList.add("ga-filter-map");
        const mapSpec: any = (control as any).map;
        if (mapSpec?.variant === "wide") wrap.classList.add("ga-filter-map-wide");
        const selected = doc.createElement("div");
        selected.className = "ga-filter-map-selected";
        const txt = next && next !== "all" ? formatCountry(next) : "";
        selected.textContent = txt ? `Selected: ${txt}` : "Click a country on the map";
        wrap.appendChild(selected);

        const mapHost = doc.createElement("div");
        mapHost.className = "ga-filter-map-host";
        const mapHeight = typeof mapSpec?.height === "number" && Number.isFinite(mapSpec.height) ? Math.round(mapSpec.height) : null;
        if (mapHeight && mapHeight >= 160 && mapHeight <= 520) {
          mapHost.style.setProperty("--ga-country-map-h", `${mapHeight}px`);
        }
        wrap.appendChild(mapHost);

        try {
          const restrictToOptions = mapSpec?.restrictToOptions === true;
          const selectableValues = restrictToOptions ? options.map((o) => o.value) : undefined;
          await renderCountryMapPicker({
            container: mapHost,
            value: next,
            selectableValues,
            tintSelectable: mapSpec?.tintSelectable !== false,
            onChange: (iso2) => {
              nextState[control.id] = iso2;
              localStateBySection.set(sectionId, { ...nextState });
              onChange();
            }
          });
        } catch {
          // Never let a map load failure break the whole section. Fall back to dropdown.
          wrap.innerHTML = "";
          wrap.appendChild(renderControlLabel(control.label));
          const sel = doc.createElement("select");
          sel.className = "ga-filter-select";
          if (!isRequired) sel.appendChild(new Option("All", "all"));
          for (const opt of options) sel.appendChild(new Option(opt.label, opt.value));
          if (next) sel.value = next;
          sel.addEventListener("change", () => {
            nextState[control.id] = sel.value;
            localStateBySection.set(sectionId, { ...nextState });
            onChange();
          });
          wrap.appendChild(sel);
        }
      } else {
        const sel = doc.createElement("select");
        sel.className = "ga-filter-select";

        if (!isRequired) sel.appendChild(new Option("All", "all"));
        for (const opt of options) sel.appendChild(new Option(opt.label, opt.value));

        if (next) sel.value = next;

        sel.addEventListener("change", () => {
          nextState[control.id] = sel.value;
          localStateBySection.set(sectionId, { ...nextState });
          onChange();
        });

        wrap.appendChild(sel);
      }
      left.appendChild(wrap);
    }

    const showReset = spec.buttons?.reset !== false;
    if (showReset) {
      const resetBtn = doc.createElement("button");
      resetBtn.className = "ga-filter-btn";
      resetBtn.textContent = "Reset";
      resetBtn.addEventListener("click", () => {
        localStateBySection.delete(sectionId);
        onChange();
      });
      right.appendChild(resetBtn);
    }

    localStateBySection.set(sectionId, { ...nextState });
    return nextState;
  };

  async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
    const n = Math.max(1, Math.min(8, Math.floor(concurrency)));
    let idx = 0;
    const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const i = idx++;
        if (i >= items.length) return;
        await fn(items[i]);
      }
    });
    await Promise.all(workers);
  }

  async function renderActive(): Promise<void> {
    const renderId = ((root as any).__gaRenderActiveId ?? 0) + 1;
    (root as any).__gaRenderActiveId = renderId;

    content.innerHTML = "";
    const section = sections.find((s) => s.id === active);
    if (!section) return;

    const baseDatasets = datasetsBySection[section.id] ?? datasetsDefault;
    activeContext = contextBySection[section.id] ?? contextDefault;
    await opts?.onActiveSectionChange?.(section.id);

    const localHost = doc.createElement("div");
    content.appendChild(localHost);

    const localSpec = (section as any).localFilters as LocalFiltersSpec | undefined;
    const dimByLocalId: Record<string, string> = {};
    if (localSpec && Array.isArray((localSpec as any).controls)) {
      for (const c of localSpec.controls as any[]) {
        if (c && typeof c.id === "string" && typeof c.dimension === "string") dimByLocalId[c.id] = c.dimension;
      }
    }
    const localState =
      localSpec && Array.isArray((localSpec as any).controls) && (localSpec as any).controls.length
        ? await renderLocalFiltersBar({
            host: localHost,
            spec: localSpec,
            sectionId: section.id,
            datasets: baseDatasets,
            onChange: () => void renderActive()
          })
        : (localStateBySection.get(section.id) ?? {});

    const localClauses = localSpec
      ? (localSpec.controls as LocalFilterControlSpec[])
          .map((c) => ({ c, v: localState[c.id] }))
          .filter((x) => typeof x.v === "string" && x.v && x.v !== "all")
          .map((x) => ({ dimension: x.c.dimension, op: "eq" as const, value: x.v, appliesTo: x.c.appliesTo }))
      : [];

    const localDatasets: Partial<Record<Grain, any[]>> = { ...baseDatasets };
    for (const [grainKey, rows] of Object.entries(baseDatasets) as any) {
      if (!Array.isArray(rows)) continue;
      const clauses = localClauses.filter((c) => Array.isArray(c.appliesTo) && c.appliesTo.includes(grainKey as any));
      if (clauses.length) {
        localDatasets[grainKey as Grain] = applyFilters(rows, clauses.map((c) => ({ dimension: c.dimension, op: c.op, value: c.value })) as any, grainKey as Grain);
      }
    }

    // If the section uses session-grain widgets, rebuild sessions from locally filtered rounds.
    const usesSession = section.layout.cards.some((c) => c.card.children.some((w) => w.grain === "session"));
    const localRounds = localDatasets.round;
    if (usesSession && Array.isArray(localRounds)) {
      const rootEl = content.closest(".ga-root") as HTMLElement | null;
      const raw = Number((rootEl as any)?.dataset?.gaSessionGapMinutes);
      const gap = Number.isFinite(raw) ? Math.max(1, Math.min(360, Math.round(raw))) : 45;
      // Rebuild sessions from locally filtered rounds *and* attach rating/outcome context from games.
      localDatasets.session = await getSessions({ global: { spec: undefined, state: {}, sessionGapMinutes: gap } }, { rounds: localRounds as any[] });
    }

    activeDatasets = localDatasets;

    const grid = doc.createElement("div");
    grid.className = "ga-grid";
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = `repeat(${section.layout.columns}, minmax(0, 1fr))`;
    grid.style.gap = "12px";

    const tasks: { container: HTMLDivElement; widget: WidgetDef }[] = [];
    for (const placed of section.layout.cards) {
      const card = doc.createElement("div");
      card.className = "ga-card";
      card.style.gridColumn = `${placed.x + 1} / span ${placed.w}`;
      card.style.gridRow = `${placed.y + 1} / span ${placed.h}`;

      const header = doc.createElement("div");
      header.className = "ga-card-header";
      header.textContent = interpolate(placed.title, localState, dimByLocalId);

      const body = doc.createElement("div");
      body.className = "ga-card-body";

      const inner = doc.createElement("div");
      inner.className = "ga-card-inner";
      inner.style.display = "grid";
      inner.style.gridTemplateColumns = `repeat(${section.layout.columns}, minmax(0, 1fr))`;
      inner.style.gap = "10px";

      for (const w of placed.card.children) {
        const showIf = (w as any)?.showIfLocal;
        if (showIf && typeof showIf === "object") {
          const id = typeof (showIf as any).id === "string" ? String((showIf as any).id) : "";
          const allowed = Array.isArray((showIf as any).in) ? ((showIf as any).in as any[]).map(String) : [];
          const cur = typeof (localState as any)?.[id] === "string" ? String((localState as any)[id]) : "";
          const ok =
            id &&
            allowed.length > 0 &&
            cur &&
            allowed.some((x) => x.trim().toLowerCase() === cur.trim().toLowerCase());
          if (!ok) continue;
        }

        const container = doc.createElement("div");
        container.className = "ga-child";

        const p = w.placement ?? { x: 0, y: 0, w: 12, h: 3 };
        container.style.gridColumn = `${p.x + 1} / span ${p.w}`;
        container.style.gridRow = `${p.y + 1} / span ${p.h}`;

        const placeholder = doc.createElement("div");
        placeholder.className = "ga-widget ga-loading";
        placeholder.innerHTML = "<div class=\"ga-spinner\"></div><div class=\"ga-loading-text\">Loading...</div>";
        container.appendChild(placeholder);

        const wInterp = { ...w, title: interpolate(w.title, localState, dimByLocalId) } as WidgetDef;
        tasks.push({ container, widget: wInterp });
        inner.appendChild(container);
      }

      body.appendChild(inner);
      card.appendChild(header);
      card.appendChild(body);
      grid.appendChild(card);
    }

    content.appendChild(grid);

    void runPool(tasks, 3, async (t) => {
      try {
        if ((root as any).__gaRenderActiveId !== renderId) return;
        const el = await renderWidget(t.widget);
        if ((root as any).__gaRenderActiveId !== renderId) return;
        if (!t.container.isConnected) return;
        t.container.innerHTML = "";
        t.container.appendChild(el);
        } catch (e: any) {
          if ((root as any).__gaRenderActiveId !== renderId) return;
          if (!t.container.isConnected) return;
          t.container.innerHTML = "";
          const pre = doc.createElement("pre");
          pre.className = "ga-widget ga-error";
          pre.style.whiteSpace = "pre-wrap";
          pre.style.padding = "10px";
          pre.textContent = describeWidgetError(e);
          t.container.appendChild(pre);
        }
      });
    }

  for (const s of sections) makeTab(s.id, s.title);

  await renderActive();
  highlight();
}
