import type { SemanticRegistry } from "../../config/semantic.types";
import type { WidgetDef } from "../../config/dashboard.types";
import type { Grain } from "../../config/semantic.types";
import { analysisConsole } from "../consoleStore";
import { renderMultiViewWidget } from "./multiViewWidget";
import { renderBreakdownWidget } from "./breakdownWidget";
import { renderRegionMetricMapWidget } from "./regionMetricMapWidget";
import { DrilldownOverlay } from "../drilldownOverlay";

type AdminLevel = {
  id: string; // e.g. "ADM1"
  label: string; // e.g. "Provinces (ADM1)"
  iso2: string;
  iso3: string;
  geojsonUrl: string;
  featureKey: string;
};

type LoadedLevel = {
  level: AdminLevel;
  geojson: any;
  // per-feature bbox to speed up point-in-polygon lookups
  features: { name: string; bbox: [number, number, number, number]; geometry: any }[];
  // cache computed labels for row objects (not persisted; survives only until page refresh)
  computed: WeakMap<any, { t: string | null; g: string | null }>;
};

const LEVEL_CACHE = new Map<string, LoadedLevel>(); // key: `${iso3}:${ADM}`
const ISO3_CACHE = new Map<string, string>(); // iso2 -> iso3
const ISO_NAME_CACHE = new Map<string, string>(); // iso2 -> country name
const ISO_LOOKUP_URL = "https://raw.githubusercontent.com/lukes/ISO-3166-Countries-with-Regional-Codes/master/all/all.json";
let ISO_LOOKUP_PROMISE: Promise<void> | null = null;

function asIso2(v: unknown): string {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return /^[a-z]{2}$/.test(s) ? s : "";
}

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

async function ensureIsoLookupLoaded(): Promise<void> {
  if (ISO_LOOKUP_PROMISE) return ISO_LOOKUP_PROMISE;
  ISO_LOOKUP_PROMISE = (async () => {
    try {
      const res = await fetch(ISO_LOOKUP_URL, { credentials: "omit" as any });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arr = (await res.json()) as any[];
      if (!Array.isArray(arr)) return;
      for (const item of arr) {
        const a2 = typeof item?.["alpha-2"] === "string" ? item["alpha-2"].trim().toLowerCase() : "";
        const a3 = typeof item?.["alpha-3"] === "string" ? item["alpha-3"].trim().toUpperCase() : "";
        const name = typeof item?.name === "string" ? item.name.trim() : "";
        if (a2 && a3 && /^[a-z]{2}$/.test(a2) && /^[A-Z]{3}$/.test(a3)) {
          ISO3_CACHE.set(a2, a3);
          if (name) ISO_NAME_CACHE.set(a2, name);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      analysisConsole.warn(`ISO mapping fetch failed (${msg}). Only a small built-in mapping will work.`);
    }
  })();
  return ISO_LOOKUP_PROMISE;
}

async function iso2ToIso3(iso2: string): Promise<string | null> {
  const key = asIso2(iso2);
  if (!key) return null;
  const builtIn: Record<string, string> = {
    de: "DEU",
    us: "USA",
    ca: "CAN",
    id: "IDN",
    ph: "PHL",
    vn: "VNM"
  };
  if (builtIn[key]) return builtIn[key];
  await ensureIsoLookupLoaded();
  return ISO3_CACHE.get(key) ?? null;
}

type GeoBoundariesMeta = {
  boundaryISO?: string;
  boundaryType?: string;
  boundaryName?: string;
  simplifiedGeometryGeoJSON?: string;
  staticDownloadLink?: string;
};

const GEOBOUNDARIES_SHA_BY_KEY = new Map<string, string>(); // key: `${iso3}:${adm}`

async function fetchGeoBoundariesMeta(iso3: string, adm: string): Promise<GeoBoundariesMeta | null> {
  const url = `https://www.geoboundaries.org/api/current/gbOpen/${encodeURIComponent(iso3)}/${encodeURIComponent(adm)}/`;
  const res = await fetch(url, { credentials: "omit" as any });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GeoBoundaries API error: HTTP ${res.status}`);
  return (await res.json()) as GeoBoundariesMeta;
}

async function resolveGeoBoundariesShaFromZip(meta: GeoBoundariesMeta, iso3: string, adm: string): Promise<string | null> {
  const cacheKey = `${iso3}:${adm}`;
  const cached = GEOBOUNDARIES_SHA_BY_KEY.get(cacheKey);
  if (cached) return cached;
  const zip = typeof meta.staticDownloadLink === "string" ? meta.staticDownloadLink : "";
  if (!zip) return null;
  const res = await fetch(zip, { method: "HEAD", redirect: "follow", credentials: "omit" as any });
  // The final URL usually is a media.githubusercontent.com link containing the full SHA.
  const finalUrl = (res as any)?.url as string | undefined;
  const u = typeof finalUrl === "string" ? finalUrl : "";
  const m = u.match(/media\/wmgeolab\/geoBoundaries\/([0-9a-f]{40})\//i);
  if (!m) return null;
  const sha = m[1];
  GEOBOUNDARIES_SHA_BY_KEY.set(cacheKey, sha);
  return sha;
}

async function resolveGeoJsonUrl(meta: GeoBoundariesMeta, iso3: string, adm: string): Promise<string> {
  const raw = typeof meta.simplifiedGeometryGeoJSON === "string" ? meta.simplifiedGeometryGeoJSON : "";
  if (!raw) throw new Error("Missing simplifiedGeometryGeoJSON URL from GeoBoundaries API");
  if (raw.includes("media.githubusercontent.com")) return raw;
  // GitHub raw often returns Git LFS pointer text. Use the media URL by resolving the repo SHA via the zip redirect.
  const sha = await resolveGeoBoundariesShaFromZip(meta, iso3, adm);
  if (!sha) return raw; // fallback (may still fail)
  return `https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/${sha}/releaseData/gbOpen/${iso3}/${adm}/geoBoundaries-${iso3}-${adm}_simplified.geojson`;
}

function pickFeatureKey(geojson: any): string {
  const first = geojson?.features?.[0]?.properties ?? null;
  if (!first || typeof first !== "object") return "shapeName";
  const candidates = ["shapeName", "name", "NAME_1", "NAME_2", "adm1_name", "adm2_name"];
  for (const k of candidates) if (k in first) return k;
  // fallback: first string-like property
  for (const [k, v] of Object.entries(first)) if (typeof v === "string" && v.trim()) return k;
  return "shapeName";
}

function bboxFromGeometry(geom: any): [number, number, number, number] | null {
  const type = geom?.type;
  const coords = geom?.coordinates;
  if (!type || !coords) return null;
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  const add = (lon: number, lat: number) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  };
  const walk = (c: any): void => {
    if (!Array.isArray(c)) return;
    if (c.length >= 2 && typeof c[0] === "number" && typeof c[1] === "number") {
      add(c[0], c[1]);
      return;
    }
    for (const x of c) walk(x);
  };
  walk(coords);
  if (!Number.isFinite(minLon) || !Number.isFinite(minLat) || !Number.isFinite(maxLon) || !Number.isFinite(maxLat)) return null;
  return [minLon, minLat, maxLon, maxLat];
}

function pointInRing(lon: number, lat: number, ring: any[]): boolean {
  // Ray casting algorithm (lon=x, lat=y)
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = Number(ring[i]?.[0]);
    const yi = Number(ring[i]?.[1]);
    const xj = Number(ring[j]?.[0]);
    const yj = Number(ring[j]?.[1]);
    if (!Number.isFinite(xi) || !Number.isFinite(yi) || !Number.isFinite(xj) || !Number.isFinite(yj)) continue;
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lon: number, lat: number, geom: any): boolean {
  const type = geom?.type;
  const coords = geom?.coordinates;
  if (!type || !coords) return false;
  if (type === "Polygon") {
    const rings = coords as any[];
    if (!Array.isArray(rings) || rings.length === 0) return false;
    if (!pointInRing(lon, lat, rings[0] as any[])) return false;
    for (let i = 1; i < rings.length; i++) if (pointInRing(lon, lat, rings[i] as any[])) return false;
    return true;
  }
  if (type === "MultiPolygon") {
    for (const poly of coords as any[]) {
      const rings = poly as any[];
      if (!Array.isArray(rings) || rings.length === 0) continue;
      if (!pointInRing(lon, lat, rings[0] as any[])) continue;
      let inHole = false;
      for (let i = 1; i < rings.length; i++) if (pointInRing(lon, lat, rings[i] as any[])) inHole = true;
      if (!inHole) return true;
    }
    return false;
  }
  return false;
}

function findFeatureName(level: LoadedLevel, lat: number, lng: number): string | null {
  const lon = lng;
  const y = lat;
  for (const f of level.features) {
    const [minLon, minLat, maxLon, maxLat] = f.bbox;
    if (lon < minLon || lon > maxLon || y < minLat || y > maxLat) continue;
    if (pointInPolygon(lon, y, f.geometry)) return f.name || null;
  }
  return null;
}

function guessLatLngOf(r: any): { lat: number; lng: number } | null {
  const lat =
    typeof r?.player_self_guessLat === "number"
      ? r.player_self_guessLat
      : typeof r?.p1_guessLat === "number"
        ? r.p1_guessLat
        : typeof r?.guessLat === "number"
          ? r.guessLat
          : null;
  const lng =
    typeof r?.player_self_guessLng === "number"
      ? r.player_self_guessLng
      : typeof r?.p1_guessLng === "number"
        ? r.p1_guessLng
        : typeof r?.guessLng === "number"
          ? r.guessLng
          : null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

async function listAvailableLevels(iso2: string): Promise<AdminLevel[]> {
  const iso3 = await iso2ToIso3(iso2);
  if (!iso3) return [];

  const jobs = [1, 2, 3, 4].map(async (n) => {
    const adm = `ADM${n}`;
    const meta = await fetchGeoBoundariesMeta(iso3, adm);
    if (!meta) return null;
    const geojsonUrl = await resolveGeoJsonUrl(meta, iso3, adm);
    const name =
      typeof meta.boundaryName === "string" && meta.boundaryName.trim()
        ? meta.boundaryName.trim()
        : n === 1
          ? "Provinces / States"
          : n === 2
            ? "Counties / Districts"
            : `Admin level ${n}`;
    return {
      id: adm,
      label: `${name} (${adm})`,
      iso2,
      iso3,
      geojsonUrl,
      featureKey: "shapeName"
    } satisfies AdminLevel;
  });

  const levels = await Promise.all(jobs);
  return levels.filter(Boolean) as AdminLevel[];
}

async function loadLevel(level: AdminLevel, onPct: (p: number) => void, onStatus: (s: string) => void): Promise<LoadedLevel> {
  const key = `${level.iso3}:${level.id}`;
  const cached = LEVEL_CACHE.get(key);
  if (cached) return cached;

  onStatus(`Downloading boundaries (${level.id})...`);
  onPct(10);
  const res = await fetch(level.geojsonUrl, { credentials: "omit" as any });
  if (!res.ok) throw new Error(`GeoJSON fetch failed: HTTP ${res.status}`);
  const txt = await res.text();
  if (txt.trim().startsWith("version https://git-lfs.github.com/spec")) {
    throw new Error("GeoJSON fetch returned a Git LFS pointer. Try again or pick another provider.");
  }
  const geojson = JSON.parse(txt);

  const featureKey = pickFeatureKey(geojson);
  onStatus("Indexing features...");
  onPct(25);

  const feats: LoadedLevel["features"] = [];
  const features = Array.isArray(geojson?.features) ? geojson.features : [];
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    const props = f?.properties ?? {};
    const name = typeof props?.[featureKey] === "string" ? String(props[featureKey]) : "";
    const bbox = bboxFromGeometry(f?.geometry);
    if (!bbox || !name) continue;
    feats.push({ name, bbox, geometry: f.geometry });
    if (i % 200 === 0) await new Promise<void>((r) => setTimeout(r, 0));
  }

  const loaded: LoadedLevel = { level: { ...level, featureKey }, geojson, features: feats, computed: new WeakMap() };
  LEVEL_CACHE.set(key, loaded);
  return loaded;
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
  title.textContent = widget.title || "Regional accuracy";
  el.appendChild(title);

  const rows = Array.isArray(baseRows) ? baseRows : [];
  void ensureIsoLookupLoaded();
  const countryIso2 = (() => {
    const first = rows.find((r) => r && typeof r === "object");
    return asIso2(first?.trueCountry ?? first?.true_country);
  })();

  const hint = doc.createElement("div");
  hint.className = "ga-muted";
  hint.style.fontSize = "12px";
  hint.textContent = countryIso2
    ? "Load a region level (ADM1/ADM2/…) to see accuracy + maps. Nothing is stored in your database."
    : "Pick a country using the section filter first.";
  el.appendChild(hint);

  if (!countryIso2) return el;

  const summary = doc.createElement("div");
  summary.className = "ga-muted";
  summary.style.fontSize = "12px";
  summary.style.marginTop = "10px";
  summary.textContent = `Country: ${countryIso2.toUpperCase()} • Rounds in selection: ${rows.length}`;
  el.appendChild(summary);

  void (async () => {
    await ensureIsoLookupLoaded();
    const name = ISO_NAME_CACHE.get(countryIso2);
    if (!name) return;
    summary.textContent = `Country: ${name} (${countryIso2.toUpperCase()}) • Rounds in selection: ${rows.length}`;
  })();

  const levelsTitle = doc.createElement("div");
  levelsTitle.style.marginTop = "12px";
  levelsTitle.style.fontWeight = "600";
  levelsTitle.textContent = "Available admin levels";
  el.appendChild(levelsTitle);

  const levelsBox = doc.createElement("div");
  levelsBox.className = "ga-statlist-box";
  el.appendChild(levelsBox);

  const status = doc.createElement("div");
  status.className = "ga-muted";
  status.style.fontSize = "12px";
  status.style.marginTop = "8px";
  el.appendChild(status);

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
  el.appendChild(progress);

  const chartsHost = doc.createElement("div");
  chartsHost.style.display = "flex";
  chartsHost.style.flexDirection = "column";
  chartsHost.style.gap = "14px";
  chartsHost.style.marginTop = "12px";
  el.appendChild(chartsHost);

  const setBusy = (pct: number, msg: string) => {
    progressFill.style.width = `${clamp(pct, 0, 100).toFixed(1)}%`;
    status.textContent = msg;
  };

  let levels: AdminLevel[] = [];
  let active: AdminLevel | null = null;

  const levelKey = (lvl: AdminLevel) => `${lvl.iso3}:${lvl.id}`;
  const isLoaded = (lvl: AdminLevel) => LEVEL_CACHE.has(levelKey(lvl));

  const renderLevelsList = () => {
    levelsBox.innerHTML = "";

    if (!levels.length) {
      const msg = doc.createElement("div");
      msg.className = "ga-muted";
      msg.style.fontSize = "12px";
      msg.textContent = "No admin levels found for this country.";
      levelsBox.appendChild(msg);
      return;
    }

    for (const lvl of levels) {
      const row = doc.createElement("div");
      row.className = "ga-statrow";
      row.style.alignItems = "center";

      const left = doc.createElement("div");
      left.className = "ga-statrow-label";
      left.textContent = lvl.label;

      const right = doc.createElement("div");
      right.className = "ga-statrow-value";
      right.style.display = "flex";
      right.style.gap = "8px";
      right.style.alignItems = "center";

      const loaded = isLoaded(lvl);
      if (loaded) {
        const btnView = doc.createElement("button");
        btnView.className = "ga-filter-btn";
        btnView.textContent = active?.id === lvl.id ? "Viewing" : "View";
        btnView.disabled = active?.id === lvl.id;
        btnView.addEventListener("click", () => {
          active = lvl;
          void renderCharts();
          renderLevelsList();
        });
        right.appendChild(btnView);

        const btnRefresh = doc.createElement("button");
        btnRefresh.className = "ga-filter-btn";
        btnRefresh.textContent = "Refresh";
        btnRefresh.addEventListener("click", () => void doLoad(lvl, true));
        right.appendChild(btnRefresh);

        const btnUnload = doc.createElement("button");
        btnUnload.className = "ga-filter-btn";
        btnUnload.textContent = "Unload";
        btnUnload.addEventListener("click", () => {
          LEVEL_CACHE.delete(levelKey(lvl));
          if (active?.id === lvl.id) {
            active = null;
            chartsHost.innerHTML = "";
          }
          setBusy(0, "Unloaded.");
          renderLevelsList();
        });
        right.appendChild(btnUnload);
      } else {
        const btnLoad = doc.createElement("button");
        btnLoad.className = "ga-filter-btn";
        btnLoad.textContent = "Load";
        btnLoad.addEventListener("click", () => void doLoad(lvl, false));
        right.appendChild(btnLoad);
      }

      row.appendChild(left);
      row.appendChild(right);
      levelsBox.appendChild(row);
    }
  };

  const renderCharts = async (): Promise<void> => {
    chartsHost.innerHTML = "";
    if (!active) return;

    const loaded = LEVEL_CACHE.get(levelKey(active));
    if (!loaded) return;

    const countryRows = rows.filter((r: any) => asIso2(r?.trueCountry ?? r?.true_country) === countryIso2);
    if (!countryRows.length) {
      const msg = doc.createElement("div");
      msg.className = "ga-muted";
      msg.style.fontSize = "12px";
      msg.textContent = "No rounds for this country in the current selection.";
      chartsHost.appendChild(msg);
      return;
    }

    setBusy(55, "Computing per-round regions...");
    const derived: any[] = [];
    for (let i = 0; i < countryRows.length; i++) {
      const r = countryRows[i];
      const cached = loaded.computed.get(r);
      let t: string | null = cached?.t ?? null;
      let g: string | null = cached?.g ?? null;
      if (!cached) {
        const lat = Number(r?.trueLat);
        const lng = Number(r?.trueLng);
        const guess = guessLatLngOf(r);
        t = Number.isFinite(lat) && Number.isFinite(lng) ? findFeatureName(loaded, lat, lng) : null;
        g = guess ? findFeatureName(loaded, guess.lat, guess.lng) : null;
        loaded.computed.set(r, { t, g });
      }
      derived.push({ ...r, adminTrueUnit: t ?? "", adminGuessUnit: g ?? "" });
      if (i % 50 === 0) {
        const pct = 55 + (i / Math.max(1, countryRows.length)) * 35;
        setBusy(pct, `Computing per-round regions... (${i}/${countryRows.length})`);
        await new Promise<void>((res) => setTimeout(res, 0));
      }
    }
    setBusy(92, "Rendering charts...");

    const accuracyTitle = doc.createElement("div");
    accuracyTitle.style.fontWeight = "600";
    accuracyTitle.textContent = `${active.label} accuracy`;
    chartsHost.appendChild(accuracyTitle);

    const accuracyBox = doc.createElement("div");
    accuracyBox.className = "ga-statlist-box";
    chartsHost.appendChild(accuracyBox);

    const overall = (() => {
      let n = 0, hit = 0;
      for (const r of derived) {
        const tt = typeof r.adminTrueUnit === "string" ? r.adminTrueUnit.trim() : "";
        const gg = typeof r.adminGuessUnit === "string" ? r.adminGuessUnit.trim() : "";
        if (!tt || !gg) continue;
        n++;
        if (tt === gg) hit++;
      }
      return n ? hit / n : 0;
    })();

    const line = doc.createElement("div");
    line.className = "ga-statrow";
    const left = doc.createElement("div");
    left.className = "ga-statrow-label";
    left.textContent = "Admin hit rate (overall)";
    const right = doc.createElement("div");
    right.className = "ga-statrow-value";
    right.textContent = `${(overall * 100).toFixed(1)}%`;
    line.appendChild(left);
    line.appendChild(right);
    accuracyBox.appendChild(line);

    const measures = [
      "admin_unit_hit_rate",
      "admin_unit_hit_count",
      "admin_unit_miss_count",
      "rounds_count",
      "avg_score",
      "avg_score_hit_only",
      "avg_distance_km",
      "avg_guess_duration",
      "round_score_per_second",
      "hit_rate",
      "fivek_rate",
      "near_perfect_rate",
      "low_score_rate",
      "throw_rate",
      "damage_dealt_avg",
      "damage_taken_avg",
      "damage_net_avg"
    ];

    const views: any[] = [
      {
        id: "map",
        label: "Map",
        type: "region_map",
        grain: "round",
        spec: {
          dimension: "admin_true_unit",
          geojsonUrl: active.geojsonUrl,
          featureKey: loaded.level.featureKey,
          fitToGeoJson: true,
          measures,
          activeMeasure: "admin_unit_hit_rate",
          mapHeight: 420,
          actions: {
            click: { type: "drilldown", target: "rounds", columnsPreset: "roundMode", filterFromPoint: true }
          }
        }
      },
      {
        id: "bar",
        label: "Bar",
        type: "breakdown",
        grain: "round",
        spec: {
          dimension: "admin_true_unit",
          measures,
          activeMeasure: "rounds_count",
          sorts: [{ mode: "desc" }, { mode: "asc" }, { mode: "chronological" }],
          activeSort: { mode: "desc" },
          limit: 15,
          extendable: true,
          actions: {
            click: { type: "drilldown", target: "rounds", columnsPreset: "roundMode", filterFromPoint: true }
          }
        }
      }
    ];

    const mvWidget: WidgetDef = {
      widgetId: `${widget.widgetId}__${countryIso2}__${active.id}`,
      type: "multi_view",
      title: `${active.label}`,
      grain: "round",
      spec: { activeView: "map", views }
    };

    const mvEl = await renderMultiViewWidget({
      semantic,
      widget: mvWidget,
      overlay,
      datasets: { round: derived },
      renderChild: async (child) => {
        if (child.type === "breakdown") return await renderBreakdownWidget(semantic, child, overlay, derived);
        if (child.type === "region_map") return await renderRegionMetricMapWidget(semantic, child, overlay, derived);
        const ph = doc.createElement("div");
        ph.className = "ga-widget ga-placeholder";
        ph.textContent = `Widget type '${child.type}' not implemented here`;
        return ph;
      }
    });
    chartsHost.appendChild(mvEl);
    setBusy(100, "Done.");
  };

  const doLoad = async (lvl: AdminLevel, forceReload: boolean): Promise<void> => {
    const key = levelKey(lvl);
    if (forceReload) LEVEL_CACHE.delete(key);
    setBusy(8, `Loading ${lvl.id}…`);
    chartsHost.innerHTML = "";
    renderLevelsList();
    try {
      await loadLevel(
        lvl,
        (p) => setBusy(p, status.textContent || ""),
        (s) => setBusy(parseFloat(progressFill.style.width) || 10, s)
      );
      active = { ...lvl, featureKey: LEVEL_CACHE.get(key)?.level.featureKey ?? lvl.featureKey };
      setBusy(45, "Loaded boundaries.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      analysisConsole.error(`Admin level load failed: ${msg}`);
      setBusy(0, `Error: ${msg}`);
      return;
    }
    renderLevelsList();
    await renderCharts();
  };

  const refreshLevels = async () => {
    setBusy(5, "Loading available admin levels...");
    try {
      levels = await listAvailableLevels(countryIso2);
      active = null;
      renderLevelsList();
      setBusy(0, levels.length ? "Ready." : "No admin levels found for this country.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      analysisConsole.error(`Admin levels load failed: ${msg}`);
      setBusy(0, `Error: ${msg}`);
    }
  };

  await refreshLevels();
  await renderCharts();
  return el;
}
