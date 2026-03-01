import type { SemanticRegistry } from "../../config/semantic.types";
import type { WidgetDef } from "../../config/dashboard.types";
import type { Grain } from "../../config/semantic.types";
import { db } from "../../db";
import { analysisConsole } from "../consoleStore";
import { MEASURES_BY_GRAIN } from "../../engine/measures";
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

async function isAdminEnabled(iso2: string): Promise<{ enabled: boolean; doneAt?: number }> {
  const meta = await db.meta.get(metaKeyForCountry(iso2));
  const enabled = (meta?.value as any)?.enabled === true;
  const doneAt = (meta?.value as any)?.doneAt as number | undefined;
  return { enabled, doneAt };
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

  const actions = doc.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "10px";
  actions.style.flexWrap = "wrap";
  body.appendChild(actions);

  const btn = doc.createElement("button");
  btn.className = "ga-filter-btn";
  btn.textContent = "Start detailed analysis";
  actions.appendChild(btn);

  const clearBtn = doc.createElement("button");
  clearBtn.className = "ga-filter-btn";
  clearBtn.textContent = "Disable";
  actions.appendChild(clearBtn);

  const chartsHost = doc.createElement("div");
  chartsHost.style.display = "flex";
  chartsHost.style.flexDirection = "column";
  chartsHost.style.gap = "14px";
  body.appendChild(chartsHost);

  const setBusy = (pct: number, msg: string) => {
    progressFill.style.width = `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`;
    status.textContent = msg;
  };

  const refreshHeader = async (): Promise<{ enabled: boolean }> => {
    const { enabled, doneAt } = await isAdminEnabled(countryIso2);
    const doneTxt = typeof doneAt === "number" && Number.isFinite(doneAt) ? new Date(doneAt).toLocaleString() : "";
    status.textContent = enabled ? `Enabled. ${doneTxt ? `Last run: ${doneTxt}.` : ""}` : "Disabled.";
    btn.textContent = enabled ? "Re-run detailed analysis" : "Start detailed analysis";
    return { enabled };
  };

  const renderCharts = async (): Promise<void> => {
    chartsHost.innerHTML = "";
    const { enabled } = await isAdminEnabled(countryIso2);
    if (!enabled) return;

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

    for (const lvl of spec.levels) {
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

  btn.addEventListener("click", () => {
    void (async () => {
      btn.disabled = true;
      clearBtn.disabled = true;
      chartsHost.innerHTML = "";
      try {
        let pct = 0;
        let msg = "";
        const sync = () => setBusy(pct, msg);
        await runAdminEnrichment(countryIso2, {
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
        btn.disabled = false;
        clearBtn.disabled = false;
        await refreshHeader();
        await renderCharts();
      }
    })();
  });

  clearBtn.addEventListener("click", () => {
    void (async () => {
      clearBtn.disabled = true;
      btn.disabled = true;
      try {
        await db.meta.put({ key: metaKeyForCountry(countryIso2), value: { enabled: false, doneAt: Date.now() }, updatedAt: Date.now() });
        setBusy(0, "Disabled.");
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        analysisConsole.error(`Disable admin enrichment failed: ${message}`);
      } finally {
        clearBtn.disabled = false;
        btn.disabled = false;
        await refreshHeader();
        chartsHost.innerHTML = "";
      }
    })();
  });

  await refreshHeader();
  await renderCharts();
  return el;
}
