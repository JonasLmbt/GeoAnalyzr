import type { SemanticRegistry } from "../../config/semantic.types";
import type { WidgetDef, RegionMetricMapSpec } from "../../config/dashboard.types";
import type { Grain } from "../../config/semantic.types";
import { getRounds, getGames, getSessions } from "../../engine/queryEngine";
import { applyFilters } from "../../engine/filters";
import { groupByKey } from "../../engine/aggregate";
import { DIMENSION_EXTRACTORS } from "../../engine/dimensions";
import { MEASURES_BY_GRAIN } from "../../engine/measures";
import {
  getAdminEnrichmentRequiredCountry,
  isAdminEnrichmentEnabledForDimension,
  maybeEnrichRoundRowsForDimension,
} from "../../engine/regionEnrichment";
import { DrilldownOverlay } from "../drilldownOverlay";
import { loadGeoJson } from "../../geo/geoJsonFetch";

type Viewport = { scale: number; tx: number; ty: number };

function project(lon: number, lat: number, w: number, h: number): [number, number] {
  const x = ((lon + 180) / 360) * w;
  const y = ((90 - lat) / 180) * h;
  return [x, y];
}

function boundsFromGeoJson(geojson: any): { minLon: number; minLat: number; maxLon: number; maxLat: number } | null {
  const features = Array.isArray(geojson?.features) ? geojson.features : [];
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
      add(Number(c[0]), Number(c[1]));
      return;
    }
    for (const x of c) walk(x);
  };
  for (const f of features) {
    const coords = f?.geometry?.coordinates;
    if (coords) walk(coords);
  }
  if (!Number.isFinite(minLon) || !Number.isFinite(minLat) || !Number.isFinite(maxLon) || !Number.isFinite(maxLat)) return null;
  return { minLon, minLat, maxLon, maxLat };
}

function pathFromGeo(geometry: any, w: number, h: number): string {
  const d: string[] = [];
  const addRing = (ring: any[]) => {
    if (!Array.isArray(ring) || ring.length < 2) return;
    const pts = ring
      .map((p) => (Array.isArray(p) && p.length >= 2 ? [Number(p[0]), Number(p[1])] : null))
      .filter((p): p is [number, number] => !!p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (pts.length < 2) return;
    const [x0, y0] = project(pts[0][0], pts[0][1], w, h);
    d.push(`M${x0.toFixed(2)},${y0.toFixed(2)}`);
    for (let i = 1; i < pts.length; i++) {
      const [x, y] = project(pts[i][0], pts[i][1], w, h);
      d.push(`L${x.toFixed(2)},${y.toFixed(2)}`);
    }
    d.push("Z");
  };

  const type = geometry?.type;
  const coords = geometry?.coordinates;
  if (!type || !coords) return "";

  if (type === "Polygon") {
    for (const ring of coords as any[]) addRing(ring);
    return d.join(" ");
  }
  if (type === "MultiPolygon") {
    for (const poly of coords as any[]) {
      for (const ring of poly as any[]) addRing(ring);
    }
    return d.join(" ");
  }
  return "";
}

function applyViewport(g: SVGGElement, vp: Viewport): void {
  g.setAttribute("transform", `translate(${vp.tx.toFixed(2)} ${vp.ty.toFixed(2)}) scale(${vp.scale.toFixed(4)})`);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const clamped = Math.max(0, Math.min(1, p));
  const idx = (sorted.length - 1) * clamped;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return lerp(sorted[lo], sorted[hi], idx - lo);
}

function parseCssRgb(input: string): { r: number; g: number; b: number } | null {
  const s = input.trim();
  const m = s.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i);
  if (!m) return null;
  const r = Number(m[1]);
  const g = Number(m[2]);
  const b = Number(m[3]);
  if (![r, g, b].every((x) => Number.isFinite(x))) return null;
  return { r: Math.max(0, Math.min(255, Math.round(r))), g: Math.max(0, Math.min(255, Math.round(g))), b: Math.max(0, Math.min(255, Math.round(b))) };
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(h)) return null;
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return { r, g, b };
}

function parseCssColor(input: string): { r: number; g: number; b: number } | null {
  return parseHex(input) ?? parseCssRgb(input);
}

function colorForValue(base: { r: number; g: number; b: number }, t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const mixToBlack = lerp(0.18, 0.70, clamped);
  const a = lerp(0.10, 0.96, clamped);
  const r = Math.round(base.r * (1 - mixToBlack));
  const g = Math.round(base.g * (1 - mixToBlack));
  const b = Math.round(base.b * (1 - mixToBlack));
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

function formatNumericWithSuffix(unitId: string, unit: any, numericText: string, value: number): string {
  const sign = unit?.showSign && value > 0 ? "+" : "";
  const base = `${sign}${numericText}`;
  const u = String(unitId ?? "").trim().toLowerCase();
  if (u === "km") return `${base} km`;
  if (u === "seconds") return `${base} s`;
  return base;
}

function compactNumberPerValue(value: number, decimals: number): string {
  const abs = Math.abs(value);
  if (abs < 10000) return value.toFixed(decimals);
  try {
    const nf = new Intl.NumberFormat("en", {
      notation: "compact",
      compactDisplay: "short",
      maximumFractionDigits: Math.max(0, Math.min(3, decimals + 1))
    } as any);
    return nf.format(value);
  } catch {
    return value.toFixed(decimals);
  }
}

function chooseLegendScale(maxAbs: number): { div: number; suffix: string } {
  if (maxAbs >= 1e9) return { div: 1e9, suffix: "B" };
  if (maxAbs >= 1e6) return { div: 1e6, suffix: "M" };
  if (maxAbs >= 1e3) return { div: 1e3, suffix: "k" };
  return { div: 1, suffix: "" };
}

function formatValueTooltip(doc: Document, semantic: SemanticRegistry, measureId: string, value: number): string {
  const m = semantic.measures[measureId];
  const unit = m ? semantic.units[m.unit] : undefined;
  if (!m || !unit) return String(value);
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
  const decimals = unit.decimals ?? 1;
  const txt = compactNumberPerValue(value, decimals);
  return formatNumericWithSuffix(m.unit, unit as any, txt, value);
}

function formatValueLegend(doc: Document, semantic: SemanticRegistry, measureId: string, value: number, scale: { div: number; suffix: string }): string {
  const m = semantic.measures[measureId];
  const unit = m ? semantic.units[m.unit] : undefined;
  if (!m || !unit) return String(value);
  if (unit.format === "percent" || unit.format === "duration") return formatValueTooltip(doc, semantic, measureId, value);

  const decimals = unit.format === "int" ? 0 : unit.decimals ?? 1;
  const scaled = scale.div > 1 ? value / scale.div : value;
  const txt = unit.format === "int" ? String(Math.round(scaled)) : scaled.toFixed(decimals);
  return formatNumericWithSuffix(m.unit, unit as any, `${txt}${scale.suffix}`, value);
}

function getMeasureIds(spec: RegionMetricMapSpec): string[] {
  const out: string[] = [];
  const single = typeof spec.measure === "string" ? spec.measure.trim() : "";
  if (single) out.push(single);
  if (Array.isArray(spec.measures)) {
    for (const m of spec.measures) {
      if (typeof m !== "string") continue;
      const clean = m.trim();
      if (!clean || out.includes(clean)) continue;
      out.push(clean);
    }
  }
  return out;
}

export async function renderRegionMetricMapWidget(
  semantic: SemanticRegistry,
  widget: WidgetDef,
  overlay: DrilldownOverlay,
  baseRows?: any[]
): Promise<HTMLElement> {
  const spec = widget.spec as RegionMetricMapSpec;
  const doc = overlay.getDocument();
  const grain = widget.grain as Grain;

  const wrap = doc.createElement("div");
  wrap.className = "ga-widget ga-country-metric-map";

  const title = doc.createElement("div");
  title.className = "ga-widget-title";
  title.textContent = widget.title;

  const header = doc.createElement("div");
  header.className = "ga-breakdown-header";

  const headerLeft = doc.createElement("div");
  headerLeft.className = "ga-breakdown-header-left";
  headerLeft.textContent = semantic.dimensions[spec.dimension]?.label ?? spec.dimension;

  const headerRight = doc.createElement("div");
  headerRight.className = "ga-breakdown-header-right";

  header.appendChild(headerLeft);
  header.appendChild(headerRight);

  const box = doc.createElement("div");
  box.className = "ga-breakdown-box";

  const legend = doc.createElement("div");
  legend.className = "ga-country-map-legend";

  const mapHost = doc.createElement("div");
  mapHost.className = "ga-country-map";
  const h = typeof spec.mapHeight === "number" && Number.isFinite(spec.mapHeight) ? Math.round(spec.mapHeight) : 420;
  mapHost.style.setProperty("--ga-country-map-h", `${Math.max(180, Math.min(1200, h))}px`);

  box.appendChild(legend);
  box.appendChild(mapHost);

  const measureIds = getMeasureIds(spec);
  if (measureIds.length === 0) throw new Error(`Region map ${widget.widgetId} has no measure or measures[]`);
  let activeMeasure = measureIds.includes(spec.activeMeasure || "") ? (spec.activeMeasure as string) : measureIds[0];

  const rowsAllBase =
    baseRows ??
    (grain === "game" ? await getGames({}) : grain === "session" ? await getSessions({}) : await getRounds({}));
  const rowsAll = applyFilters(rowsAllBase as any[], spec.filters, grain);

  const keyFn = DIMENSION_EXTRACTORS[grain]?.[spec.dimension];
  if (!keyFn) throw new Error(`No extractor implemented for dimension '${spec.dimension}' (region_map)`);

  const requiredCountry = getAdminEnrichmentRequiredCountry(spec.dimension);
  const adminEnabled = requiredCountry ? await isAdminEnrichmentEnabledForDimension(spec.dimension) : true;

  if (grain === "round" && adminEnabled) {
    await maybeEnrichRoundRowsForDimension(spec.dimension, rowsAll as any[]);
  }

  const renderHeaderRight = (): void => {
    headerRight.innerHTML = "";
    const wrapRight = doc.createElement("div");
    wrapRight.className = "ga-breakdown-controls";

    if (measureIds.length > 1) {
      const mLabel = doc.createElement("span");
      mLabel.className = "ga-breakdown-ctl-label";
      mLabel.textContent = "Measure:";

      const mSelect = doc.createElement("select");
      mSelect.className = "ga-breakdown-ctl-select";
      for (const mId of measureIds) {
        const opt = doc.createElement("option");
        opt.value = mId;
        opt.textContent = semantic.measures[mId]?.label ?? mId;
        if (mId === activeMeasure) opt.selected = true;
        mSelect.appendChild(opt);
      }
      mSelect.addEventListener("change", () => {
        const next = mSelect.value;
        if (!measureIds.includes(next)) return;
        activeMeasure = next;
        void renderMap();
      });

      wrapRight.appendChild(mLabel);
      wrapRight.appendChild(mSelect);
    } else {
      const mText = doc.createElement("span");
      mText.textContent = semantic.measures[activeMeasure]?.label ?? activeMeasure;
      wrapRight.appendChild(mText);
    }

    headerRight.appendChild(wrapRight);
  };

  const renderMap = async (): Promise<void> => {
    mapHost.innerHTML = "";

      if (requiredCountry && !adminEnabled) {
        legend.innerHTML = "";
        const wrapCta = doc.createElement("div");
        wrapCta.style.display = "flex";
        wrapCta.style.justifyContent = "center";
        wrapCta.style.alignItems = "center";
        wrapCta.style.height = "100%";
        wrapCta.style.minHeight = "180px";

        const msg = doc.createElement("div");
        msg.className = "ga-muted";
        msg.style.fontSize = "12px";
        msg.style.textAlign = "center";
        msg.textContent = `Detailed admin analysis required for ${requiredCountry.toUpperCase()}. Open the “Detailed admin analysis” section to load this level.`;
        wrapCta.appendChild(msg);
        mapHost.appendChild(wrapCta);
        return;
      }

    const measDef = semantic.measures[activeMeasure];
    if (!measDef) throw new Error(`Unknown measure '${activeMeasure}' (region_map)`);
    const unit = semantic.units[measDef.unit];

    const grouped = groupByKey(rowsAll as any[], keyFn as any);

    const values = new Map<string, number>();
    const allVals: number[] = [];
    let min = Infinity;
    let max = -Infinity;
    const measureFn = MEASURES_BY_GRAIN[grain]?.[measDef.formulaId];
    if (!measureFn) throw new Error(`Missing measure implementation for formulaId=${measDef.formulaId}`);
    for (const [k, g] of grouped.entries()) {
      const key = String(k ?? "").trim();
      if (!key) continue;
      const v = (measureFn as any)(g);
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      const vv = unit?.format === "percent" ? Math.max(0, Math.min(1, v)) : v;
      values.set(key, vv);
      allVals.push(vv);
      min = Math.min(min, vv);
      max = Math.max(max, vv);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      min = 0;
      max = 1;
    }
    const sorted = allVals.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
    const p10 = Number.isFinite(percentile(sorted, 0.10)) ? percentile(sorted, 0.10) : min;
    const p90 = Number.isFinite(percentile(sorted, 0.90)) ? percentile(sorted, 0.90) : max;
    const scaleMin = Math.min(p10, p90);
    const scaleMax = Math.max(p10, p90);
    const scaleSpan = Math.max(1e-9, scaleMax - scaleMin);
    const legendScale = chooseLegendScale(Math.max(Math.abs(scaleMin), Math.abs(scaleMax)));

    const rootEl = (doc.querySelector(".ga-root") as HTMLElement | null) ?? null;
    const theme = rootEl?.dataset?.gaTheme ?? "";
    const styles = rootEl ? getComputedStyle(rootEl) : null;
    const baseColorRaw =
      theme === "geoguessr"
        ? (styles?.getPropertyValue("--ga-warn") ?? "")
        : (styles?.getPropertyValue("--ga-graph-color") ?? "");
    const baseColor = parseCssColor(baseColorRaw) ?? parseCssColor(styles?.getPropertyValue("--ga-warn") ?? "") ?? { r: 126, g: 182, b: 255 };

    legend.innerHTML = "";
    const left = doc.createElement("div");
    left.className = "ga-country-map-legend-min";
    left.textContent = formatValueLegend(doc, semantic, activeMeasure, scaleMin, legendScale);
    const bar = doc.createElement("div");
    bar.className = "ga-country-map-legend-bar";
    bar.style.background = `linear-gradient(90deg, ${colorForValue(baseColor, 0)}, ${colorForValue(baseColor, 1)})`;
    const right = doc.createElement("div");
    right.className = "ga-country-map-legend-max";
    right.textContent = formatValueLegend(doc, semantic, activeMeasure, scaleMax, legendScale);
    legend.appendChild(left);
    legend.appendChild(bar);
    legend.appendChild(right);

    const geojson = spec.geojson ?? (await loadGeoJson(spec.geojsonUrl));
    const wrap = doc.createElement("div");
    wrap.className = "ga-country-map-wrap";
    mapHost.appendChild(wrap);

    const toolbar = doc.createElement("div");
    toolbar.className = "ga-country-map-toolbar";
    wrap.appendChild(toolbar);

    const btnMinus = doc.createElement("button");
    btnMinus.type = "button";
    btnMinus.className = "ga-country-map-btn";
    btnMinus.textContent = "−";
    btnMinus.title = "Zoom out";

    const btnPlus = doc.createElement("button");
    btnPlus.type = "button";
    btnPlus.className = "ga-country-map-btn";
    btnPlus.textContent = "+";
    btnPlus.title = "Zoom in";

    const hint = doc.createElement("div");
    hint.className = "ga-country-map-hint";
    hint.textContent = "Scroll to zoom, drag to pan, click to select.";

    toolbar.appendChild(btnMinus);
    toolbar.appendChild(btnPlus);
    toolbar.appendChild(hint);

    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("ga-country-map-svg");
    wrap.appendChild(svg);

    const W = 1000;
    const H = 500;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    const g = doc.createElementNS("http://www.w3.org/2000/svg", "g");
    svg.appendChild(g);

    const features = Array.isArray(geojson?.features) ? geojson.features : [];
    const groupedByKey = grouped as Map<string, any[]>;

    for (const f of features) {
      const props = f?.properties;
      const key = props && spec.featureKey in props ? String(props[spec.featureKey] ?? "").trim() : "";
      if (!key) continue;
      const d = pathFromGeo(f.geometry, W, H);
      if (!d) continue;

      const p = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", d);
      p.setAttribute("fill-rule", "evenodd");
      p.dataset.key = key;
      p.classList.add("ga-country-shape");
      g.appendChild(p);

      const v = values.get(key);
      if (typeof v === "number" && Number.isFinite(v)) {
        const rawT = (v - scaleMin) / scaleSpan;
        const clamped = Math.max(0, Math.min(1, rawT));
        const t = Math.pow(clamped, 0.65);
        p.style.fill = colorForValue(baseColor, t);
        p.style.opacity = "1";
      } else {
        p.style.opacity = "0.35";
      }

      const valTxt = typeof v === "number" && Number.isFinite(v) ? formatValueTooltip(doc, semantic, activeMeasure, v) : "n/a";
      const tt = `${key}${valTxt ? ": " : ""}${valTxt}`;
      const titleEl = doc.createElementNS("http://www.w3.org/2000/svg", "title");
      titleEl.textContent = tt;
      p.appendChild(titleEl);

      p.addEventListener("pointerenter", () => {
        p.style.filter = "brightness(1.12)";
        p.style.strokeWidth = "2";
      });
      p.addEventListener("pointerleave", () => {
        p.style.filter = "";
        p.style.strokeWidth = "";
      });

      p.addEventListener("click", () => {
        const click = spec.actions?.click as any;
        if (!click || click.type !== "drilldown") return;
        const rowsFromPoint = click.filterFromPoint ? (groupedByKey.get(key) ?? []) : (rowsAll as any[]);
        const filteredRows = applyFilters(rowsFromPoint, click.extraFilters, grain);
        overlay.open(semantic, {
          title: `${widget.title} - ${key}`,
          target: click.target,
          columnsPreset: click.columnsPreset,
          rows: filteredRows,
          extraFilters: click.extraFilters
        });
      });
    }

      let vp: Viewport = { scale: 1, tx: 0, ty: 0 };
      if (spec.fitToGeoJson) {
        const b = boundsFromGeoJson(geojson);
        if (b) {
          const [x0, y0] = project(b.minLon, b.maxLat, W, H);
          const [x1, y1] = project(b.maxLon, b.minLat, W, H);
          const minX = Math.min(x0, x1);
          const maxX = Math.max(x0, x1);
          const minY = Math.min(y0, y1);
          const maxY = Math.max(y0, y1);
          const spanX = Math.max(1, maxX - minX);
          const spanY = Math.max(1, maxY - minY);
          const margin = 0.08;
          const s = Math.min((W * (1 - margin * 2)) / spanX, (H * (1 - margin * 2)) / spanY);
          const scale = Math.max(1, Math.min(24, s));
          const tx = (W - spanX * scale) / 2 - minX * scale;
          const ty = (H - spanY * scale) / 2 - minY * scale;
          vp = { scale, tx, ty };
        }
      }
      applyViewport(g, vp);

    const rectPoint = (clientX: number, clientY: number): { x: number; y: number } => {
      const r = svg.getBoundingClientRect();
      const x = ((clientX - r.left) / Math.max(1, r.width)) * W;
      const y = ((clientY - r.top) / Math.max(1, r.height)) * H;
      return { x, y };
    };

    const zoomAt = (px: number, py: number, nextScale: number) => {
      const s0 = vp.scale;
      const sx = (px - vp.tx) / s0;
      const sy = (py - vp.ty) / s0;
      vp = {
        scale: nextScale,
        tx: px - nextScale * sx,
        ty: py - nextScale * sy
      };
      applyViewport(g, vp);
    };

    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

    const onZoom = (delta: number, clientX: number, clientY: number) => {
      const p = rectPoint(clientX, clientY);
      const factor = delta > 0 ? 1.12 : 1 / 1.12;
      const next = clamp(vp.scale * factor, 1, 24);
      zoomAt(p.x, p.y, next);
    };

    svg.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        onZoom(e.deltaY, e.clientX, e.clientY);
      },
      { passive: false }
    );

    btnPlus.addEventListener("click", () => {
      const r = svg.getBoundingClientRect();
      onZoom(-1, r.left + r.width / 2, r.top + r.height / 2);
    });
    btnMinus.addEventListener("click", () => {
      const r = svg.getBoundingClientRect();
      onZoom(1, r.left + r.width / 2, r.top + r.height / 2);
    });

    let drag: { x: number; y: number; tx: number; ty: number } | null = null;
    svg.addEventListener("pointerdown", (e) => {
      const target = e.target as HTMLElement | null;
      if (target && target.tagName.toLowerCase() === "path") return;
      (svg as any).setPointerCapture?.(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, tx: vp.tx, ty: vp.ty };
    });
    svg.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = ((e.clientX - drag.x) / Math.max(1, svg.getBoundingClientRect().width)) * W;
      const dy = ((e.clientY - drag.y) / Math.max(1, svg.getBoundingClientRect().height)) * H;
      vp = { ...vp, tx: drag.tx + dx, ty: drag.ty + dy };
      applyViewport(g, vp);
    });
    svg.addEventListener("pointerup", () => (drag = null));
    svg.addEventListener("pointercancel", () => (drag = null));
  };

  renderHeaderRight();
  await renderMap();

  wrap.appendChild(title);
  wrap.appendChild(header);
  wrap.appendChild(box);
  return wrap;
}
