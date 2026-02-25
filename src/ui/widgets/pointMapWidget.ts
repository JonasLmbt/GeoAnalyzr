import type { SemanticRegistry } from "../../config/semantic.types";
import type { WidgetDef, PointMapSpec, PointMapSourceDef } from "../../config/dashboard.types";
import type { Grain } from "../../config/semantic.types";
import { getRounds, getGames, getSessions } from "../../engine/queryEngine";
import { applyFilters } from "../../engine/filters";
import { MEASURES_BY_GRAIN } from "../../engine/measures";
import { DrilldownOverlay } from "../drilldownOverlay";

function hasGmXhr(): boolean {
  return typeof (globalThis as any).GM_xmlhttpRequest === "function";
}

function gmGetText(url: string, accept?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const gm = (globalThis as any).GM_xmlhttpRequest;
    gm({
      method: "GET",
      url,
      headers: { Accept: accept ?? "application/json" },
      onload: (res: any) => resolve(typeof res?.responseText === "string" ? res.responseText : ""),
      onerror: (err: any) => reject(err),
      ontimeout: () => reject(new Error("GM_xmlhttpRequest timeout"))
    });
  });
}

async function fetchJson(url: string): Promise<any> {
  if (hasGmXhr()) {
    const txt = await gmGetText(url, "application/json");
    return JSON.parse(txt);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

const WORLD_GEOJSON_URL = "https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json";
let worldPromise: Promise<any> | null = null;
function loadWorldGeoJson(): Promise<any> {
  if (!worldPromise) worldPromise = fetchJson(WORLD_GEOJSON_URL);
  return worldPromise;
}

type Viewport = { scale: number; tx: number; ty: number };

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function project(lon: number, lat: number, w: number, h: number): [number, number] {
  const x = ((lon + 180) / 360) * w;
  const y = ((90 - lat) / 180) * h;
  return [x, y];
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

function parseCssColor(v: string): { r: number; g: number; b: number } | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^#[0-9a-fA-F]{6}$/.test(s)) {
    return { r: parseInt(s.slice(1, 3), 16), g: parseInt(s.slice(3, 5), 16), b: parseInt(s.slice(5, 7), 16) };
  }
  const m = s.match(/^rgb\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*\)$/);
  if (m) {
    const r = clamp(parseInt(m[1], 10), 0, 255);
    const g = clamp(parseInt(m[2], 10), 0, 255);
    const b = clamp(parseInt(m[3], 10), 0, 255);
    return { r, g, b };
  }
  return null;
}

function colorForValue(base: { r: number; g: number; b: number }, t: number): string {
  const tt = clamp(t, 0, 1);
  const r = Math.round(base.r * tt);
  const g = Math.round(base.g * tt);
  const b = Math.round(base.b * tt);
  return `rgb(${r} ${g} ${b})`;
}

function formatValue(doc: Document, semantic: SemanticRegistry, measureId: string, value: number): string {
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
  const txt = value.toFixed(decimals);
  return unit.showSign && value > 0 ? `+${txt}` : txt;
}

function getByPath(obj: any, path: string): any {
  const raw = typeof path === "string" ? path.trim() : "";
  if (!raw) return undefined;
  if (!raw.includes(".")) return obj?.[raw];
  let cur: any = obj;
  for (const part of raw.split(".").map((p) => p.trim()).filter(Boolean)) {
    cur = cur?.[part];
    if (cur === undefined || cur === null) return cur;
  }
  return cur;
}

function normalizeSources(points: PointMapSourceDef[] | undefined): PointMapSourceDef[] {
  const out: PointMapSourceDef[] = [];
  if (!Array.isArray(points)) return out;
  for (const p of points) {
    const latField = typeof p?.latField === "string" ? p.latField.trim() : "";
    const lngField = typeof p?.lngField === "string" ? p.lngField.trim() : "";
    if (!latField || !lngField) continue;
    out.push({
      id: typeof p?.id === "string" ? p.id.trim() : undefined,
      label: typeof p?.label === "string" ? p.label.trim() : undefined,
      latField,
      lngField
    });
  }
  return out;
}

type PointGroup = {
  lat: number;
  lng: number;
  pointRows: any[];
  baseRows: any[];
  baseKeys: Set<string>;
};

function rowKeyForGrain(grain: Grain, row: any): string {
  if (grain === "round") {
    const gid = typeof row?.gameId === "string" ? row.gameId : "";
    const rn = typeof row?.roundNumber === "number" ? row.roundNumber : null;
    return gid && rn !== null ? `${gid}#${rn}` : JSON.stringify(row);
  }
  if (grain === "game") {
    const gid = typeof row?.gameId === "string" ? row.gameId : "";
    return gid || JSON.stringify(row);
  }
  const sid = typeof row?.sessionId === "string" ? row.sessionId : "";
  return sid || JSON.stringify(row);
}

function sumDamage(rows: any[], kind: "dealt" | "taken"): number {
  let sum = 0;
  for (const r of rows as any[]) {
    const dmg = (r as any)?.damage;
    if (typeof dmg !== "number" || !Number.isFinite(dmg)) continue;
    if (kind === "dealt") sum += Math.max(0, dmg);
    else sum += Math.max(0, -dmg);
  }
  return sum;
}

export async function renderPointMapWidget(
  semantic: SemanticRegistry,
  widget: WidgetDef,
  overlay: DrilldownOverlay,
  baseRows?: any[]
): Promise<HTMLElement> {
  const spec = widget.spec as PointMapSpec;
  const doc = overlay.getDocument();
  const grain = widget.grain as Grain;

  const wrap = doc.createElement("div");
  wrap.className = "ga-widget ga-point-map";

  const title = doc.createElement("div");
  title.className = "ga-widget-title";
  title.textContent = widget.title;

  const header = doc.createElement("div");
  header.className = "ga-breakdown-header";

  const headerLeft = doc.createElement("div");
  headerLeft.className = "ga-breakdown-header-left";
  headerLeft.textContent = "Coordinates";

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

  const rowsAllBase =
    baseRows ??
    (grain === "game" ? await getGames({}) : grain === "session" ? await getSessions({}) : await getRounds({}));
  const rowsAll = applyFilters(rowsAllBase as any[], spec.filters, grain);

  const sources = normalizeSources(spec.points);
  if (sources.length === 0) throw new Error(`Point map ${widget.widgetId} has no points[] sources configured`);

  const measures: string[] = [];
  if (typeof (spec as any).measure === "string" && (spec as any).measure.trim()) measures.push((spec as any).measure.trim());
  if (Array.isArray(spec.measures)) for (const m of spec.measures) if (typeof m === "string" && m.trim() && !measures.includes(m.trim())) measures.push(m.trim());
  if (measures.length === 0) throw new Error(`Point map ${widget.widgetId} has no measure or measures[]`);

  let activeMeasure = measures.includes(spec.activeMeasure || "") ? (spec.activeMeasure as string) : measures[0];

  const renderHeaderRight = (): void => {
    headerRight.innerHTML = "";
    const wrapRight = doc.createElement("div");
    wrapRight.className = "ga-breakdown-controls";

    if (measures.length > 1) {
      const mLabel = doc.createElement("span");
      mLabel.className = "ga-breakdown-ctl-label";
      mLabel.textContent = "Measure:";

      const mSelect = doc.createElement("select");
      mSelect.className = "ga-breakdown-ctl-select";
      for (const mId of measures) {
        const opt = doc.createElement("option");
        opt.value = mId;
        opt.textContent = semantic.measures[mId]?.label ?? mId;
        if (mId === activeMeasure) opt.selected = true;
        mSelect.appendChild(opt);
      }
      mSelect.addEventListener("change", () => {
        const next = mSelect.value;
        if (!measures.includes(next)) return;
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
    const measDef = semantic.measures[activeMeasure];
    if (!measDef) throw new Error(`Unknown measure '${activeMeasure}' (point_map)`);

    const precision = typeof spec.keyPrecision === "number" && Number.isFinite(spec.keyPrecision) ? Math.max(0, Math.min(10, Math.round(spec.keyPrecision))) : 6;
    const keyFor = (lat: number, lng: number): string => `${lat.toFixed(precision)},${lng.toFixed(precision)}`;

    const expandedRows: any[] = [];
    const grouped = new Map<string, PointGroup>();

    for (const base of rowsAll as any[]) {
      for (const src of sources) {
        const latRaw = getByPath(base, src.latField);
        const lngRaw = getByPath(base, src.lngField);
        const lat = typeof latRaw === "number" && Number.isFinite(latRaw) ? latRaw : null;
        const lng = typeof lngRaw === "number" && Number.isFinite(lngRaw) ? lngRaw : null;
        if (lat === null || lng === null) continue;
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;

        const k = keyFor(lat, lng);
        const pointRow = base;
        expandedRows.push(pointRow);

        const g = grouped.get(k) ?? { lat, lng, pointRows: [], baseRows: [], baseKeys: new Set<string>() };
        g.pointRows.push(pointRow);
        const rk = rowKeyForGrain(grain, base);
        if (!g.baseKeys.has(rk)) {
          g.baseKeys.add(rk);
          g.baseRows.push(base);
        }
        grouped.set(k, g);
      }
    }

    const formulaId = measDef.formulaId;
    const shareKind = formulaId === "share_damage_dealt" ? "dealt" : formulaId === "share_damage_taken" ? "taken" : formulaId === "share_rounds" ? "rounds" : null;
    const denom = shareKind === "rounds" ? expandedRows.length : shareKind ? sumDamage(expandedRows, shareKind as any) : 0;

    const measureFn = shareKind ? null : MEASURES_BY_GRAIN[grain]?.[formulaId];
    if (!shareKind && !measureFn) throw new Error(`Missing measure implementation for formulaId=${formulaId}`);

    const values = new Map<string, number>();
    const allVals: number[] = [];
    for (const [k, g] of grouped.entries()) {
      const v =
        shareKind === "rounds"
          ? denom > 0
            ? g.pointRows.length / denom
            : 0
          : shareKind
            ? denom > 0
              ? sumDamage(g.pointRows, shareKind as any) / denom
              : 0
            : (measureFn as any)(g.pointRows);
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      values.set(k, v);
      allVals.push(v);
    }

    allVals.sort((a, b) => a - b);
    const quantile = (sorted: number[], q: number): number => {
      if (sorted.length === 0) return 0;
      const qq = clamp(q, 0, 1);
      const idx = qq * (sorted.length - 1);
      const lo = Math.floor(idx);
      const hi = Math.ceil(idx);
      if (lo === hi) return sorted[lo];
      const t = idx - lo;
      return sorted[lo] + (sorted[hi] - sorted[lo]) * t;
    };

    const scaleMin = allVals.length ? quantile(allVals, 0.05) : 0;
    const scaleMax = allVals.length ? quantile(allVals, 0.95) : 1;
    const scaleSpan = scaleMax - scaleMin;

    // Legend colors
    const root = doc.querySelector(".ga-root") as HTMLElement | null;
    const theme = root?.dataset?.gaTheme === "geoguessr" ? "geoguessr" : "default";
    const styles = doc.defaultView?.getComputedStyle(doc.documentElement);
    const baseColorRaw =
      theme === "geoguessr"
        ? (styles?.getPropertyValue("--ga-warn") ?? "")
        : (styles?.getPropertyValue("--ga-graph-color") ?? "");
    const baseColor = parseCssColor(baseColorRaw) ?? parseCssColor(styles?.getPropertyValue("--ga-warn") ?? "") ?? { r: 126, g: 182, b: 255 };

    // Legend
    legend.innerHTML = "";
    const left = doc.createElement("div");
    left.className = "ga-country-map-legend-min";
    left.textContent = formatValue(doc, semantic, activeMeasure, scaleMin);
    const bar = doc.createElement("div");
    bar.className = "ga-country-map-legend-bar";
    bar.style.background = `linear-gradient(90deg, ${colorForValue(baseColor, 0)}, ${colorForValue(baseColor, 1)})`;
    const right = doc.createElement("div");
    right.className = "ga-country-map-legend-max";
    right.textContent = formatValue(doc, semantic, activeMeasure, scaleMax);
    legend.appendChild(left);
    legend.appendChild(bar);
    legend.appendChild(right);

    let geojson: any;
    try {
      geojson = await loadWorldGeoJson();
    } catch (e) {
      mapHost.innerHTML = "";
      const msg = doc.createElement("div");
      msg.className = "ga-filter-map-error";
      msg.textContent = "Map unavailable (network/CSP).";
      mapHost.appendChild(msg);
      throw e;
    }

    mapHost.innerHTML = "";
    const wrapMap = doc.createElement("div");
    wrapMap.className = "ga-country-map-wrap";
    mapHost.appendChild(wrapMap);

    const toolbar = doc.createElement("div");
    toolbar.className = "ga-country-map-toolbar";
    wrapMap.appendChild(toolbar);

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
    hint.textContent = "Scroll to zoom, drag to pan, click a dot to drill down.";

    toolbar.appendChild(btnMinus);
    toolbar.appendChild(btnPlus);
    toolbar.appendChild(hint);

    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("ga-country-map-svg");
    wrapMap.appendChild(svg);

    const W = 1000;
    const H = 500;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    const g = doc.createElementNS("http://www.w3.org/2000/svg", "g");
    svg.appendChild(g);

    // Base world shapes
    const features = Array.isArray(geojson?.features) ? geojson.features : [];
    for (const f of features) {
      const d = pathFromGeo(f.geometry, W, H);
      if (!d) continue;
      const p = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", d);
      p.setAttribute("fill-rule", "evenodd");
      p.classList.add("ga-country-shape");
      // Keep base map non-interactive; interactions happen on the overlay points + pan/zoom.
      (p.style as any).pointerEvents = "none";
      g.appendChild(p);
    }

    const pointsLayer = doc.createElementNS("http://www.w3.org/2000/svg", "g");
    g.appendChild(pointsLayer);

    let vp: Viewport = { scale: 1, tx: 0, ty: 0 };
    applyViewport(g, vp);

    const dots: SVGCircleElement[] = [];
    const updateDotSizes = (): void => {
      const s = Math.max(0.0001, vp.scale);
      for (const el of dots) {
        const baseR = parseFloat(String((el as any).dataset?.baseR ?? ""));
        if (!Number.isFinite(baseR)) continue;
        // Keep dots screen-space stable while zooming by counter-scaling radius.
        const r = clamp(baseR / s, 1.25, 10);
        el.setAttribute("r", r.toFixed(3));
      }
    };

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
      vp = { scale: nextScale, tx: px - nextScale * sx, ty: py - nextScale * sy };
      applyViewport(g, vp);
      updateDotSizes();
    };

    const setScaleCentered = (nextScale: number) => {
      const cx = W / 2;
      const cy = H / 2;
      zoomAt(cx, cy, nextScale);
    };

    btnPlus.addEventListener("click", () => setScaleCentered(clamp(vp.scale * 1.25, 1, 20)));
    btnMinus.addEventListener("click", () => setScaleCentered(clamp(vp.scale / 1.25, 1, 20)));

    let drag: { id: number; x: number; y: number; tx0: number; ty0: number; moved: boolean } | null = null;
    let suppressClick = false;

    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const { x, y } = rectPoint(e.clientX, e.clientY);
      const dir = e.deltaY > 0 ? -1 : 1;
      const factor = dir > 0 ? 1.15 : 1 / 1.15;
      const nextScale = clamp(vp.scale * factor, 1, 30);
      zoomAt(x, y, nextScale);
    }, { passive: false } as any);

    svg.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const pt = rectPoint(e.clientX, e.clientY);
      drag = { id: e.pointerId, x: pt.x, y: pt.y, tx0: vp.tx, ty0: vp.ty, moved: false };
      suppressClick = false;
      (e.target as any)?.setPointerCapture?.(e.pointerId);
    });

    svg.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const pt = rectPoint(e.clientX, e.clientY);
      const dx = pt.x - drag.x;
      const dy = pt.y - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      vp = { ...vp, tx: drag.tx0 + dx, ty: drag.ty0 + dy };
      applyViewport(g, vp);
    });

    svg.addEventListener("pointerup", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      suppressClick = drag.moved;
      drag = null;
      try { (e.target as any)?.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
      setTimeout(() => { suppressClick = false; }, 0);
    });

    // Render points (cap to reduce DOM overhead on very large datasets).
    const maxDots = typeof (spec as any).maxDots === "number" && Number.isFinite((spec as any).maxDots) ? Math.max(200, Math.round((spec as any).maxDots)) : 2500;
    const allGroups = Array.from(grouped.entries())
      .map(([k, g2]) => ({ k, g: g2, n: g2.pointRows.length }))
      .sort((a, b) => b.n - a.n);

    const limited = allGroups.slice(0, Math.min(maxDots, allGroups.length));
    if (allGroups.length > limited.length) {
      hint.textContent = `Scroll to zoom, drag to pan, click a dot to drill down. Showing top ${limited.length}/${allGroups.length} points (by frequency).`;
    }

    const frag = doc.createDocumentFragment();

    for (const item of limited) {
      const k = item.k;
      const g2 = item.g;
      const v = values.get(k);
      const [x, y] = project(g2.lng, g2.lat, W, H);

      const circle = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.classList.add("ga-point-dot");
      circle.dataset.key = k;
      const c = g2.pointRows.length;
      const rBase = 1.8 + Math.sqrt(Math.max(1, c)) * 0.7;
      (circle as any).dataset.baseR = String(clamp(rBase, 2, 10));
      circle.setAttribute("cx", x.toFixed(2));
      circle.setAttribute("cy", y.toFixed(2));
      circle.setAttribute("r", String(clamp(rBase, 2, 10)));

      if (typeof v === "number" && Number.isFinite(v)) {
        const rawT = scaleSpan > 0 ? (v - scaleMin) / scaleSpan : 1;
        const clampedT = clamp(rawT, 0, 1);
        const t = Math.pow(clampedT, 0.55);
        circle.style.fill = colorForValue(baseColor, t);
        circle.style.opacity = "0.95";
      } else {
        circle.style.fill = "rgba(255,255,255,0.25)";
        circle.style.opacity = "0.6";
      }

      const ttVal = typeof v === "number" && Number.isFinite(v) ? formatValue(doc, semantic, activeMeasure, v) : "n/a";
      const titleEl = doc.createElementNS("http://www.w3.org/2000/svg", "title");
      titleEl.textContent = `${k} • ${c} pts • ${ttVal}`;
      circle.appendChild(titleEl);

      dots.push(circle);
      frag.appendChild(circle);
    }

    pointsLayer.appendChild(frag);
    updateDotSizes();

    // Event delegation (fewer listeners = better perf on large dot counts).
    pointsLayer.addEventListener("pointerenter", (e) => {
      const el = (e.target as any)?.closest?.("circle.ga-point-dot") as SVGCircleElement | null;
      if (!el) return;
      el.style.filter = "brightness(1.15)";
      el.style.strokeWidth = "2";
    }, true as any);
    pointsLayer.addEventListener("pointerleave", (e) => {
      const el = (e.target as any)?.closest?.("circle.ga-point-dot") as SVGCircleElement | null;
      if (!el) return;
      el.style.filter = "";
      el.style.strokeWidth = "";
    }, true as any);

    const click = spec.actions?.click as any;
    if (click && click.type === "drilldown") {
      pointsLayer.addEventListener("click", (e) => {
        const el = (e.target as any)?.closest?.("circle.ga-point-dot") as SVGCircleElement | null;
        if (!el) return;
        if (suppressClick) return;
        const k = typeof (el as any).dataset?.key === "string" ? String((el as any).dataset.key) : "";
        if (!k) return;
        const g2 = grouped.get(k);
        if (!g2) return;
        const rowsFromPoint = click.filterFromPoint ? g2.baseRows : (rowsAll as any[]);
        const filteredRows = applyFilters(rowsFromPoint, click.extraFilters, grain);
        overlay.open(semantic, {
          title: `${widget.title} - ${k}`,
          target: click.target,
          columnsPreset: click.columnsPreset,
          rows: filteredRows,
          extraFilters: click.extraFilters
        });
      });
    }
  };

  renderHeaderRight();
  await renderMap();

  wrap.appendChild(title);
  wrap.appendChild(header);
  wrap.appendChild(box);
  return wrap;
}
