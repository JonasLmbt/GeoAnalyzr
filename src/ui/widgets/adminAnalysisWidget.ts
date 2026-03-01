import type { SemanticRegistry } from "../../config/semantic.types";
import type { WidgetDef } from "../../config/dashboard.types";
import type { Grain } from "../../config/semantic.types";
import { db } from "../../db";
import { analysisConsole } from "../consoleStore";
import { MEASURES_BY_GRAIN } from "../../engine/measures";
import { invalidateAdminEnrichmentEnabledCache } from "../../engine/regionEnrichment";
import { renderMultiViewWidget } from "./multiViewWidget";
import { renderBreakdownWidget } from "./breakdownWidget";
import { renderRegionMetricMapWidget } from "./regionMetricMapWidget";
import { DrilldownOverlay } from "../drilldownOverlay";
import { getAdminEnrichmentPlan, runAdminEnrichment } from "./adminEnrichmentWidget";

function asIso2(v: unknown): string {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return /^[a-z]{2}$/.test(s) ? s : "";
}

function metaKeyForCountry(iso2: string): string {
  return `admin_enrichment_enabled_${iso2.toLowerCase()}`;
}

function formatValue(doc: Document, semantic: SemanticRegistry, measureId: string, value: number): string {
  const m = semantic.measures[measureId];
  const unit = m ? semantic.units[m.unit] : undefined;
  if (!unit) return String(value);

  if (unit.format === "percent") {
    const decimals = unit.decimals ?? 1;
    const clamped = Math.max(0, Math.min(1, value));
    return `${(clamped * 100).toFixed(decimals)}%`;
  }
  if (unit.format === "duration") {
    const s = Math.max(0, Math.round(value));
    const days = Math.floor(s / 86400);
    const hours = Math.floor((s % 86400) / 3600);
    const mins = Math.floor((s % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    if (mins > 0) return `${mins}m ${s % 60}s`;
    return `${(Math.max(0, value)).toFixed(1)}s`;
  }
  if (unit.format === "int") {
    const v = Math.round(value);
    return unit.showSign && v > 0 ? `+${v}` : String(v);
  }
  if (unit.format === "datetime") {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toLocaleString() : String(value);
  }

  const decimals = unit.decimals ?? 1;
  const txt = Number.isFinite(value) ? value.toFixed(decimals) : String(value);
  return unit.showSign && value > 0 ? `+${txt}` : txt;
}

type AdminLevelSpec = {
  id: string;
  label: string;
  trueDim: string;
  hitMeasureId: string;
  map?: { geojsonUrl: string; featureKey: string };
};

const GEOBOUNDARIES_SHA = "9469f09592ced973a3448cf66b6100b741b64c0d";
const geoBoundariesMedia = (iso3: string, adm: string): string =>
  `https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/${GEOBOUNDARIES_SHA}/releaseData/gbOpen/${iso3}/${adm}/geoBoundaries-${iso3}-${adm}_simplified.geojson`;

const DEFAULT_MEASURES: string[] = [
  "rounds_count",
  "hit_rate",
  "avg_score",
  "avg_distance_km",
  "avg_guess_duration",
  "fivek_rate",
  "throw_rate",
  "damage_dealt_avg",
  "damage_taken_avg",
  "damage_net_avg"
];

const ADMIN_SPECS_BY_COUNTRY: Record<string, { label: string; levels: AdminLevelSpec[] }> = {
    de: {
      label: "Germany",
      levels: [
        {
          id: "adm1",
          label: "States (Bundesländer) (ADM1)",
          trueDim: "true_state",
          hitMeasureId: "admin_hit_rate_de_state",
          map: {
            geojsonUrl: "https://raw.githubusercontent.com/isellsoap/deutschlandGeoJSON/main/2_bundeslaender/1_sehr_hoch.geo.json",
            featureKey: "name"
          }
        },
        {
          id: "adm2",
          label: "Districts (Landkreise) (ADM2)",
          trueDim: "true_district",
          hitMeasureId: "admin_hit_rate_de_district"
        }
      ]
    },
    us: {
      label: "United States",
      levels: [
        {
          id: "adm1",
          label: "States (ADM1)",
          trueDim: "true_us_state",
          hitMeasureId: "admin_hit_rate_us_state",
          map: {
            geojsonUrl: "https://raw.githubusercontent.com/datasets/geo-admin1-us/master/data/admin1-us.geojson",
            featureKey: "name"
          }
        }
      ]
    },
    ca: {
      label: "Canada",
      levels: [
        {
          id: "adm1",
          label: "Provinces & Territories (ADM1)",
          trueDim: "true_ca_province",
          hitMeasureId: "admin_hit_rate_ca_province",
          map: {
            geojsonUrl: "https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/canada.geojson",
            featureKey: "name"
          }
        }
      ]
    },
    id: {
      label: "Indonesia",
      levels: [
        {
          id: "adm1",
          label: "Provinces (ADM1)",
          trueDim: "true_id_province",
          hitMeasureId: "admin_hit_rate_id_province",
          map: {
            geojsonUrl: geoBoundariesMedia("IDN", "ADM1"),
            featureKey: "shapeName"
          }
        },
        {
          id: "adm2",
          label: "Kabupaten / Regencies (ADM2)",
          trueDim: "true_id_kabupaten",
          hitMeasureId: "admin_hit_rate_id_kabupaten",
          map: {
            geojsonUrl: geoBoundariesMedia("IDN", "ADM2"),
            featureKey: "shapeName"
          }
        }
      ]
    },
    ph: {
      label: "Philippines",
      levels: [
        {
          id: "adm1",
          label: "Provinces (ADM1)",
          trueDim: "true_ph_province",
          hitMeasureId: "admin_hit_rate_ph_province",
          map: {
            geojsonUrl: geoBoundariesMedia("PHL", "ADM1"),
            featureKey: "shapeName"
          }
        }
      ]
    },
    vn: {
      label: "Vietnam",
      levels: [
        {
          id: "adm1",
          label: "Provinces (ADM1)",
          trueDim: "true_vn_province",
          hitMeasureId: "admin_hit_rate_vn_province",
          map: {
            geojsonUrl: geoBoundariesMedia("VNM", "ADM1"),
            featureKey: "shapeName"
          }
        }
      ]
    }
  };

type AdminMetaValue = {
  enabled?: boolean;
  doneAt?: number;
  rounds?: number;
  dimIdsDone?: string[];
  levels?: Record<
    string,
    {
      enabled?: boolean;
      inProgress?: boolean;
      startedAt?: number;
      doneAt?: number;
      dimIds?: string[];
    }
  >;
};

async function getAdminMeta(iso2: string): Promise<AdminMetaValue> {
  const meta = await db.meta.get(metaKeyForCountry(iso2));
  const v = (meta?.value as any) ?? {};
  return v as AdminMetaValue;
}

async function putAdminMeta(iso2: string, value: AdminMetaValue): Promise<void> {
  await db.meta.put({ key: metaKeyForCountry(iso2), value, updatedAt: Date.now() });
  invalidateAdminEnrichmentEnabledCache(iso2);
}

export async function renderAdminAnalysisWidget(
  semantic: SemanticRegistry,
  widget: WidgetDef,
  overlay: DrilldownOverlay,
  baseRows: any[]
): Promise<HTMLElement> {
  const doc = overlay.getDocument();
  const el = doc.createElement("div");
  el.className = "ga-widget ga-admin-analysis";

  const title = doc.createElement("div");
  title.className = "ga-widget-title";
  title.textContent = widget.title || "Detailed admin analysis";
  el.appendChild(title);

  const body = doc.createElement("div");
  body.style.display = "flex";
  body.style.flexDirection = "column";
  body.style.gap = "10px";
  el.appendChild(body);

  const countryIso2 = (() => {
    const first = Array.isArray(baseRows) ? baseRows.find((r) => r && typeof r === "object") : null;
    return asIso2(first?.trueCountry ?? first?.true_country);
  })();

  if (!countryIso2) {
    const msg = doc.createElement("div");
    msg.textContent = "Pick a country using the Admin section's country filter.";
    body.appendChild(msg);
    return el;
  }

  const plan = getAdminEnrichmentPlan(countryIso2);
  const spec = ADMIN_SPECS_BY_COUNTRY[countryIso2];
  if (!plan || !spec) {
    const msg = doc.createElement("div");
    msg.textContent = `No detailed admin-level dataset configured for '${countryIso2.toUpperCase()}' yet.`;
    body.appendChild(msg);
    return el;
  }

  const summary = doc.createElement("div");
  summary.style.fontSize = "12px";
  summary.style.opacity = "0.9";
  summary.textContent = "Available admin levels:";
  body.appendChild(summary);

  const list = doc.createElement("ul");
  list.style.margin = "0";
  list.style.paddingLeft = "16px";
  list.style.fontSize = "12px";
  list.style.opacity = "0.9";
  for (const lvl of spec.levels) {
    const li = doc.createElement("li");
    li.textContent = `${lvl.label}${lvl.map ? " (map)" : ""}`;
    list.appendChild(li);
  }
  body.appendChild(list);

  const status = doc.createElement("div");
  status.style.fontSize = "12px";
  status.style.opacity = "0.9";
  body.appendChild(status);

  const progress = doc.createElement("div");
  progress.style.height = "8px";
  progress.style.borderRadius = "999px";
  progress.style.background = "rgba(255,255,255,0.10)";
  progress.style.overflow = "hidden";
  const progressFill = doc.createElement("div");
  progressFill.style.height = "100%";
  progressFill.style.width = "0%";
  progressFill.style.background = "linear-gradient(90deg, rgba(0,190,255,0.85), rgba(170,255,120,0.85))";
  progress.appendChild(progressFill);
  body.appendChild(progress);

  const controls = doc.createElement("div");
  controls.style.display = "flex";
  controls.style.flexDirection = "column";
  controls.style.gap = "10px";
  body.appendChild(controls);

  const disableHint = doc.createElement("div");
  disableHint.className = "ga-muted";
  disableHint.style.fontSize = "12px";
  disableHint.textContent = "Disable hides a level in this section and prevents admin dimensions from rendering. Computed fields stay in your database.";
  body.appendChild(disableHint);

  const chartsHost = doc.createElement("div");
  chartsHost.style.display = "flex";
  chartsHost.style.flexDirection = "column";
  chartsHost.style.gap = "14px";
  body.appendChild(chartsHost);

  const setBusy = (pct: number, msg: string) => {
    progressFill.style.width = `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`;
    status.textContent = msg;
  };

  const isAnyLevelEnabled = (meta: AdminMetaValue): boolean => {
    if (meta.enabled === true) return true;
    const levels = meta.levels ?? {};
    return Object.values(levels).some((x) => x && x.enabled === true);
  };

  const setMetaLevelEnabled = async (levelId: string, enabled: boolean): Promise<void> => {
    const meta = await getAdminMeta(countryIso2);
    const next: AdminMetaValue = { ...meta, levels: { ...(meta.levels ?? {}) } };
    // If we're upgrading from legacy {enabled:true} without per-level state, assume all plan levels were enabled.
    if (meta.enabled === true && (!meta.levels || Object.keys(meta.levels).length === 0)) {
      for (const lvl of plan.levels) next.levels![lvl.id] = { enabled: true, dimIds: lvl.dimIds, doneAt: meta.doneAt };
    }
    next.levels![levelId] = { ...(next.levels![levelId] ?? {}), enabled, inProgress: false };
    next.enabled = enabled || isAnyLevelEnabled(next);
    await putAdminMeta(countryIso2, next);
    (globalThis as any).__gaRequestRerender?.();
  };

  const refreshHeader = async (): Promise<void> => {
    const meta = await getAdminMeta(countryIso2);
    const any = isAnyLevelEnabled(meta);
    const doneTxt = typeof meta.doneAt === "number" && Number.isFinite(meta.doneAt) ? new Date(meta.doneAt).toLocaleString() : "";
    status.textContent = any ? `Enabled. ${doneTxt ? `Last run: ${doneTxt}.` : ""}` : "Disabled.";
  };

  const renderCharts = async (): Promise<void> => {
    chartsHost.innerHTML = "";
    const meta = await getAdminMeta(countryIso2);
    if (!isAnyLevelEnabled(meta)) return;

    const rows = Array.isArray(baseRows) ? baseRows : [];
    const countryRows = rows.filter((r: any) => asIso2(r?.trueCountry ?? r?.true_country) === countryIso2);
    if (!countryRows.length) {
      const msg = doc.createElement("div");
      msg.style.opacity = "0.85";
      msg.style.fontSize = "12px";
      msg.textContent = "No rounds found for this country within the current filter selection.";
      chartsHost.appendChild(msg);
      return;
    }

    const accuracyTitle = doc.createElement("div");
    accuracyTitle.style.fontWeight = "600";
    accuracyTitle.textContent = "Administrative unit accuracy (selected country)";
    chartsHost.appendChild(accuracyTitle);

    const accuracyBox = doc.createElement("div");
    accuracyBox.className = "ga-statlist-box";
    chartsHost.appendChild(accuracyBox);

    const enabledIds = (() => {
      const levels = meta.levels ?? {};
      const enabled = Object.entries(levels)
        .filter(([, v]) => v && v.enabled === true)
        .map(([k]) => k);
      if (enabled.length) return enabled;
      // Legacy: country-wide toggle enabled => treat all known levels as enabled.
      if (meta.enabled === true) return spec.levels.map((l) => l.id);
      return [];
    })();
    const enabledLevelIds = new Set<string>(enabledIds);

    for (const lvl of spec.levels) {
      if (!enabledLevelIds.has(lvl.id)) continue;
      const m = semantic.measures[lvl.hitMeasureId];
      const fn = m ? MEASURES_BY_GRAIN.round?.[m.formulaId] : undefined;
      const v = fn ? fn(countryRows as any[]) : NaN;
      const line = doc.createElement("div");
      line.className = "ga-statrow";

      const left = doc.createElement("div");
      left.className = "ga-statrow-label";
      left.textContent = `Admin hit rate: ${lvl.label}`;

      const right = doc.createElement("div");
      right.className = "ga-statrow-value";
      right.textContent = Number.isFinite(v) ? formatValue(doc, semantic, lvl.hitMeasureId, v) : "-";

      line.appendChild(left);
      line.appendChild(right);
      accuracyBox.appendChild(line);
    }

    for (const lvl of spec.levels) {
      if (!enabledLevelIds.has(lvl.id)) continue;
      const mvViews: any[] = [];
      mvViews.push({
        id: "bar",
        label: "Bar",
        type: "breakdown",
        grain: "round",
        spec: {
          dimension: lvl.trueDim,
          measures: DEFAULT_MEASURES,
          activeMeasure: "rounds_count",
          sorts: [{ mode: "desc" }, { mode: "asc" }],
          activeSort: { mode: "desc" },
          limit: 15,
          extendable: true,
          actions: {
            click: { type: "drilldown", target: "rounds", columnsPreset: "roundMode", filterFromPoint: true }
          }
        }
      });

      if (lvl.map) {
        mvViews.push({
          id: "map",
          label: "Map",
          type: "region_map",
          grain: "round",
          spec: {
            dimension: lvl.trueDim,
            geojsonUrl: lvl.map.geojsonUrl,
            featureKey: lvl.map.featureKey,
            measures: DEFAULT_MEASURES,
            activeMeasure: "avg_score",
            mapHeight: 380,
            actions: {
              click: { type: "drilldown", target: "rounds", columnsPreset: "roundMode", filterFromPoint: true }
            }
          }
        });
      }

      const mvWidget: WidgetDef = {
        widgetId: `${widget.widgetId}__${countryIso2}__${lvl.id}`,
        type: "multi_view",
        title: `${spec.label} - ${lvl.label}`,
        grain: "round",
        spec: { activeView: lvl.map ? "map" : "bar", views: mvViews }
      };

      const mvEl = await renderMultiViewWidget({
        semantic,
        widget: mvWidget,
        overlay,
        datasets: { round: countryRows as any[] },
        renderChild: async (child) => {
          const rows = countryRows as any[];
          if (child.type === "breakdown") return await renderBreakdownWidget(semantic, child, overlay, rows);
          if (child.type === "region_map") return await renderRegionMetricMapWidget(semantic, child, overlay, rows);
          const ph = doc.createElement("div");
          ph.className = "ga-widget ga-placeholder";
          ph.textContent = `Widget type '${child.type}' not implemented here`;
          return ph;
        }
      });
      chartsHost.appendChild(mvEl);
    }
  };

  const renderControls = async (): Promise<void> => {
    controls.innerHTML = "";
    const meta = await getAdminMeta(countryIso2);

    for (const lvlPlan of plan.levels) {
      const row = doc.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "10px";
      row.style.flexWrap = "wrap";

      const left = doc.createElement("div");
      left.style.minWidth = "240px";

      const label = doc.createElement("div");
      label.style.fontWeight = "600";
      label.textContent = lvlPlan.label;

      const legacyEnabled = meta.enabled === true && (!meta.levels || Object.keys(meta.levels).length === 0);
      const lvlMeta = legacyEnabled ? { enabled: true, doneAt: meta.doneAt } : (meta.levels?.[lvlPlan.id] ?? {});
      const enabled = lvlMeta.enabled === true;
      const inProgress = lvlMeta.inProgress === true;
      const doneAt = typeof lvlMeta.doneAt === "number" && Number.isFinite(lvlMeta.doneAt) ? new Date(lvlMeta.doneAt).toLocaleString() : "";

      const sub = doc.createElement("div");
      sub.className = "ga-muted";
      sub.style.fontSize = "12px";
      sub.textContent = inProgress
        ? "Loading…"
        : enabled
          ? `Loaded${doneAt ? ` (last run: ${doneAt})` : ""}`
          : "Not loaded";

      left.appendChild(label);
      left.appendChild(sub);

      const loadBtn = doc.createElement("button");
      loadBtn.className = "ga-filter-btn";
      loadBtn.textContent = enabled ? "Re-run" : "Load";
      loadBtn.disabled = inProgress;

      const disableBtn = doc.createElement("button");
      disableBtn.className = "ga-filter-btn";
      disableBtn.textContent = "Disable";
      disableBtn.disabled = inProgress || !enabled;

      loadBtn.addEventListener("click", () => {
        void (async () => {
          loadBtn.disabled = true;
          disableBtn.disabled = true;
          chartsHost.innerHTML = "";
          try {
            let pct = 0;
            let msg = "";
            const sync = () => setBusy(pct, msg);
            await runAdminEnrichment(countryIso2, {
              levelId: lvlPlan.id,
              onPct: (p) => {
                pct = p;
                sync();
              },
              onStatus: (m) => {
                msg = m;
                sync();
              }
            });
            setBusy(100, "Done. Refreshing view...");
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            analysisConsole.error(`Admin enrichment failed: ${message}`);
            setBusy(0, `Error: ${message}`);
          } finally {
            await refreshHeader();
            await renderControls();
            await renderCharts();
          }
        })();
      });

      disableBtn.addEventListener("click", () => {
        void (async () => {
          disableBtn.disabled = true;
          loadBtn.disabled = true;
          try {
            await setMetaLevelEnabled(lvlPlan.id, false);
            setBusy(0, "Disabled.");
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            analysisConsole.error(`Disable admin enrichment failed: ${message}`);
          } finally {
            await refreshHeader();
            await renderControls();
            await renderCharts();
          }
        })();
      });

      row.appendChild(left);
      row.appendChild(loadBtn);
      row.appendChild(disableBtn);
      controls.appendChild(row);
    }

    const disableAll = doc.createElement("button");
    disableAll.className = "ga-filter-btn";
    disableAll.textContent = "Disable all levels";
    disableAll.disabled = !isAnyLevelEnabled(meta);
    disableAll.addEventListener("click", () => {
      void (async () => {
        disableAll.disabled = true;
        const current = await getAdminMeta(countryIso2);
        const next: AdminMetaValue = { ...current, enabled: false, levels: { ...(current.levels ?? {}) }, doneAt: Date.now() };
        if (current.enabled === true && (!current.levels || Object.keys(current.levels).length === 0)) {
          for (const lvl of plan.levels) next.levels![lvl.id] = { enabled: false, dimIds: lvl.dimIds, doneAt: current.doneAt };
        }
        for (const k of Object.keys(next.levels ?? {})) next.levels![k] = { ...(next.levels![k] ?? {}), enabled: false, inProgress: false };
        await putAdminMeta(countryIso2, next);
        (globalThis as any).__gaRequestRerender?.();
        setBusy(0, "Disabled.");
        await refreshHeader();
        await renderControls();
        await renderCharts();
      })();
    });
    controls.appendChild(disableAll);
  };

  await refreshHeader();
  await renderControls();
  await renderCharts();
  return el;
}
