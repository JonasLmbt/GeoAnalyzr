import type { SemanticRegistry } from "../../config/semantic.types";
import type { WidgetDef, ChartSpec } from "../../config/dashboard.types";
import type { Grain } from "../../config/semantic.types";
import { getRounds, getGames } from "../../engine/queryEngine";
import { DIMENSION_EXTRACTORS } from "../../engine/dimensions";
import { groupByKey } from "../../engine/aggregate";
import { MEASURES_BY_GRAIN } from "../../engine/measures";
import { applyFilters } from "../../engine/filters";
import { DrilldownOverlay } from "../drilldownOverlay";

type Datum = { x: string; y: number; rows: any[] };

function getShareKindFromFormulaId(formulaId: string): "dealt" | "taken" | null {
  if (formulaId === "share_damage_dealt") return "dealt";
  if (formulaId === "share_damage_taken") return "taken";
  return null;
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

function sortKeysChronological(keys: string[]): string[] {
  const weekdayRank = (k: string): number | undefined => {
    const v = k.trim().toLowerCase();
    // We prefer Mon..Sun as "chronological" for week-based charts.
    if (v === "mon") return 0;
    if (v === "tue") return 1;
    if (v === "wed") return 2;
    if (v === "thu") return 3;
    if (v === "fri") return 4;
    if (v === "sat") return 5;
    if (v === "sun") return 6;
    return undefined;
  };
  const weekdayKeys = keys.map((k) => weekdayRank(k));
  if (weekdayKeys.every((r) => r !== undefined)) {
    return [...keys].sort((a, b) => (weekdayRank(a) ?? 0) - (weekdayRank(b) ?? 0));
  }

  const parseKey = (k: string): number | undefined => {
    const first = k.split("-")[0] ?? k;
    const t = first.trim();
    // Handle labels like "<20 sec" and ">180 sec" deterministically.
    if (t.startsWith("<")) return -1;
    if (t.startsWith(">")) return 1e9;
    const parsed = Number(t.replace(/[^0-9.]/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  return [...keys].sort((a, b) => {
    const na = parseKey(a);
    const nb = parseKey(b);
    if (na !== undefined && nb !== undefined) return na - nb;
    if (na !== undefined) return -1;
    if (nb !== undefined) return 1;
    return a.localeCompare(b);
  });
}

function sortData(data: Datum[], mode: "chronological" | "asc" | "desc" | undefined): Datum[] {
  if (mode === "chronological") {
    const keys = sortKeysChronological(data.map((d) => d.x));
    const rank = new Map(keys.map((k, i) => [k, i]));
    return [...data].sort((a, b) => (rank.get(a.x) ?? 0) - (rank.get(b.x) ?? 0));
  }
  if (mode === "asc") return [...data].sort((a, b) => a.y - b.y);
  if (mode === "desc") return [...data].sort((a, b) => b.y - a.y);
  return data;
}

function getSortModes(spec: ChartSpec): Array<"chronological" | "asc" | "desc"> {
  const out: Array<"chronological" | "asc" | "desc"> = [];
  const single = spec.sort?.mode;
  if (single) out.push(single);
  if (Array.isArray(spec.sorts)) {
    for (const s of spec.sorts) {
      const mode = s?.mode;
      if (!mode) continue;
      if (!out.includes(mode)) out.push(mode);
    }
  }
  return out;
}

function sortLabel(mode: "chronological" | "asc" | "desc"): string {
  if (mode === "chronological") return "Chronological";
  if (mode === "asc") return "Ascending";
  return "Descending";
}

function accumulationLabel(mode: "period" | "to_date"): string {
  return mode === "to_date" ? "To date" : "Per period";
}

function toDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayKeysBetween(fromTs: number, toTs: number): string[] {
  const out: string[] = [];
  const start = new Date(fromTs);
  start.setHours(0, 0, 0, 0);
  const end = new Date(toTs);
  end.setHours(0, 0, 0, 0);
  for (let t = start.getTime(); t <= end.getTime(); t += 24 * 60 * 60 * 1000) {
    out.push(toDayKey(t));
  }
  return out;
}

function chunkKeys(keys: string[], maxPoints: number): Array<{ label: string; keys: string[] }> {
  if (!Number.isFinite(maxPoints) || maxPoints <= 1) return keys.map((k) => ({ label: k, keys: [k] }));
  if (keys.length <= maxPoints) return keys.map((k) => ({ label: k, keys: [k] }));
  const bucket = Math.ceil(keys.length / maxPoints);
  const out: Array<{ label: string; keys: string[] }> = [];
  for (let i = 0; i < keys.length; i += bucket) {
    const slice = keys.slice(i, i + bucket);
    const label = slice.length <= 1 ? slice[0] : `${slice[0]}..${slice[slice.length - 1]}`;
    out.push({ label, keys: slice });
  }
  return out;
}

function getMeasureIds(spec: ChartSpec): string[] {
  const out: string[] = [];
  const single = typeof spec.y.measure === "string" ? spec.y.measure.trim() : "";
  if (single) out.push(single);
  if (Array.isArray(spec.y.measures)) {
    for (const m of spec.y.measures) {
      if (typeof m !== "string") continue;
      const clean = m.trim();
      if (!clean || out.includes(clean)) continue;
      out.push(clean);
    }
  }
  return out;
}

function readDateFormatMode(doc: Document): "dd/mm/yyyy" | "mm/dd/yyyy" | "yyyy-mm-dd" | "locale" {
  const root = doc.querySelector(".ga-root") as HTMLElement | null;
  const mode = root?.dataset?.gaDateFormat;
  return mode === "mm/dd/yyyy" || mode === "yyyy-mm-dd" || mode === "locale" ? mode : "dd/mm/yyyy";
}

function formatDateTime(doc: Document, ts: number): string {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return String(ts);
  const mode = readDateFormatMode(doc);
  if (mode === "locale") return d.toLocaleString();

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");

  if (mode === "yyyy-mm-dd") return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
  if (mode === "mm/dd/yyyy") return `${m}/${day}/${y} ${hh}:${mm}:${ss}`;
  return `${day}/${m}/${y} ${hh}:${mm}:${ss}`;
}

function readCountryFormatMode(doc: Document): "iso2" | "english" {
  const root = doc.querySelector(".ga-root") as HTMLElement | null;
  return root?.dataset?.gaCountryFormat === "english" ? "english" : "iso2";
}

function formatCountry(doc: Document, isoOrName: string): string {
  const mode = readCountryFormatMode(doc);
  if (mode === "iso2") return isoOrName;
  const iso2 = isoOrName.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(iso2)) return isoOrName;
  if (typeof Intl === "undefined" || !(Intl as any).DisplayNames) return isoOrName;
  try {
    const dn = new (Intl as any).DisplayNames(["en"], { type: "region" });
    return dn.of(iso2) ?? isoOrName;
  } catch {
    return isoOrName;
  }
}

function formatDimensionKey(doc: Document, dimId: string, key: string): string {
  if (dimId === "confused_countries") return key; // always iso2 for space reasons
  if (dimId === "true_country" || dimId === "guess_country" || dimId === "opponent_country") return formatCountry(doc, key);
  return key;
}

function formatMeasureValue(doc: Document, semantic: SemanticRegistry, measureId: string, value: number): string {
  const measure = semantic.measures[measureId];
  const unit = measure ? semantic.units[measure.unit] : undefined;
  if (!unit) return `${value}`;
  if (unit.format === "datetime") return formatDateTime(doc, value);
  if (unit.format === "percent") {
    const clamped = Math.max(0, Math.min(1, value));
    return `${(clamped * 100).toFixed(unit.decimals ?? 1)}%`;
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
    return unit.showSign && v > 0 ? `+${v}` : `${v}`;
  }
  const txt = value.toFixed(unit.decimals ?? 1);
  return unit.showSign && value > 0 ? `+${txt}` : txt;
}

function clampForMeasure(semantic: SemanticRegistry, measureId: string, value: number): number {
  const measure = semantic.measures[measureId];
  const unit = measure ? semantic.units[measure.unit] : undefined;
  if (unit?.format === "percent") return Math.max(0, Math.min(1, value));
  return value;
}

function mergeDrilldownDefaults<T extends { extraFilters?: any[]; filterFromPoint?: boolean }>(
  base: T | undefined,
  defs: { extraFilters?: any[]; filterFromPoint?: boolean } | undefined
): T | undefined {
  if (!base) return base;
  if (!defs) return base;
  return {
    ...(base as any),
    filterFromPoint: (base as any).filterFromPoint ?? defs.filterFromPoint,
    extraFilters: [...(defs.extraFilters ?? []), ...((base as any).extraFilters ?? [])]
  } as T;
}

function computeYBounds(opts: {
  unitFormat: "int" | "float" | "percent" | "duration";
  values: number[];
  preferZero: boolean;
  hardMin?: number;
  hardMax?: number;
}): { minY: number; maxY: number } {
  const { unitFormat, values, preferZero, hardMin, hardMax } = opts;
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { minY: 0, maxY: 1 };

  if (unitFormat === "percent") {
    // For percent series we still want "fit to data" (otherwise small changes are invisible),
    // but we must never go below 0% or above 100%.
    const clamped = finite.map((v) => Math.max(0, Math.min(1, v)));
    let min = Math.min(...clamped);
    let max = Math.max(...clamped);
    if (preferZero) min = 0;

    let range = max - min;
    if (!Number.isFinite(range) || range <= 0) range = Math.max(0.01, Math.abs(max) || 0.01);
    const pad = range * 0.06;
    min = Math.max(0, min - pad);
    max = Math.min(1, max + pad);
    range = max - min;

    const niceStep = (raw: number): number => {
      if (!Number.isFinite(raw) || raw <= 0) return 0.01;
      const exp = Math.floor(Math.log10(raw));
      const base = 10 ** exp;
      const n = raw / base;
      const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
      return nice * base;
    };

    const tickCount = 5;
    const step = niceStep(range / tickCount);
    const niceMin = preferZero ? 0 : Math.max(0, Math.floor(min / step) * step);
    const niceMax = Math.min(1, Math.ceil(max / step) * step);
    if (niceMax <= niceMin) return { minY: niceMin, maxY: Math.min(1, niceMin + Math.max(step, 0.01)) };
    return { minY: niceMin, maxY: niceMax };
  }

  let min = Math.min(...finite);
  let max = Math.max(...finite);

  if (preferZero) min = Math.min(0, min);
  if (typeof hardMin === "number" && Number.isFinite(hardMin)) min = Math.max(min, hardMin);
  if (typeof hardMax === "number" && Number.isFinite(hardMax)) max = Math.min(max, hardMax);

  let range = max - min;
  if (!Number.isFinite(range) || range <= 0) range = Math.max(1, Math.abs(max) || 1);

  // Fit line charts tighter by basing "nice" ticks on the range (not the absolute magnitude),
  // otherwise 3.6k..4.1k would jump to 0..5k and hide changes.
  const pad = range * 0.06;
  min -= pad;
  max += pad;
  if (typeof hardMin === "number" && Number.isFinite(hardMin)) min = Math.max(min, hardMin);
  if (typeof hardMax === "number" && Number.isFinite(hardMax)) max = Math.min(max, hardMax);
  range = max - min;

  const niceStep = (raw: number): number => {
    if (!Number.isFinite(raw) || raw <= 0) return 1;
    const exp = Math.floor(Math.log10(raw));
    const base = 10 ** exp;
    const n = raw / base;
    const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return nice * base;
  };

  const tickCount = 5;
  const step = niceStep(range / tickCount);
  const niceMin = preferZero ? 0 : Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;

  let outMin = Number.isFinite(niceMin) ? niceMin : 0;
  let outMax = Number.isFinite(niceMax) ? niceMax : 1;
  if (typeof hardMin === "number" && Number.isFinite(hardMin)) outMin = Math.max(outMin, hardMin);
  if (typeof hardMax === "number" && Number.isFinite(hardMax)) outMax = Math.min(outMax, hardMax);
  if (outMax <= outMin) return { minY: outMin, maxY: outMin + 1 };
  return { minY: outMin, maxY: outMax };
}

function normalizeHexColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : undefined;
}

function isAnimationsEnabled(doc: Document): boolean {
  const root = doc.getElementById("geoanalyzr-semantic-root");
  return root?.getAttribute("data-ga-chart-animations") !== "off";
}

function maybeAnimateChartSvg(svg: SVGSVGElement, doc: Document): void {
  if (!isAnimationsEnabled(doc)) {
    svg.setAttribute("data-anim-state", "off");
    return;
  }
  svg.setAttribute("data-anim-state", "pending");
  const obs = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        svg.setAttribute("data-anim-state", "run");
        obs.disconnect();
        return;
      }
    },
    { threshold: 0.15 }
  );
  obs.observe(svg);
}

function sanitizeFileName(name: string): string {
  const out = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim();
  return out.length > 0 ? out : "chart";
}

function triggerDownload(doc: Document, blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = doc.createElement("a");
  a.href = url;
  a.download = filename;
  doc.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function serializeSvg(svg: SVGSVGElement): { text: string; width: number; height: number } {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.removeAttribute("data-anim-state");
  const vb = clone.getAttribute("viewBox")?.trim().split(/\s+/).map(Number) ?? [];
  const width = Number.isFinite(vb[2]) && vb[2] > 0 ? vb[2] : 1200;
  const height = Number.isFinite(vb[3]) && vb[3] > 0 ? vb[3] : 360;
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  return { text: new XMLSerializer().serializeToString(clone), width, height };
}

async function downloadSvg(doc: Document, svg: SVGSVGElement, title: string): Promise<void> {
  const { text } = serializeSvg(svg);
  const blob = new Blob([text], { type: "image/svg+xml;charset=utf-8" });
  triggerDownload(doc, blob, `${sanitizeFileName(title)}.svg`);
}

async function downloadPng(doc: Document, svg: SVGSVGElement, title: string): Promise<void> {
  const prepared = serializeSvg(svg);
  const svgBlob = new Blob([prepared.text], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Could not render chart image."));
      img.src = url;
    });
    const canvas = doc.createElement("canvas");
    canvas.width = prepared.width;
    canvas.height = prepared.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context unavailable.");
    ctx.drawImage(img, 0, 0, prepared.width, prepared.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (blob) {
      triggerDownload(doc, blob, `${sanitizeFileName(title)}.png`);
      return;
    }
    const dataUrl = canvas.toDataURL("image/png");
    const fallbackBlob = await (await fetch(dataUrl)).blob();
    triggerDownload(doc, fallbackBlob, `${sanitizeFileName(title)}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function prepareLineAnimation(path: SVGPathElement): void {
  const len = Math.max(1, Math.ceil(path.getTotalLength()));
  path.style.setProperty("--ga-line-length", String(len));
  path.style.strokeDasharray = `${len}`;
  path.style.strokeDashoffset = `${len}`;
}

export async function renderChartWidget(
  semantic: SemanticRegistry,
  widget: WidgetDef,
  overlay: DrilldownOverlay,
  datasets?: Partial<Record<Grain, any[]>>,
  context?: { dateRange?: { fromTs: number | null; toTs: number | null } }
): Promise<HTMLElement> {
  const spec = widget.spec as ChartSpec;
  const doc = overlay.getDocument();

  const wrap = doc.createElement("div");
  wrap.className = "ga-widget ga-chart";

  const title = doc.createElement("div");
  title.className = "ga-widget-title";
  title.textContent = widget.title;

  const controls = doc.createElement("div");
  controls.className = "ga-chart-controls";

  const controlsLeft = doc.createElement("div");
  controlsLeft.className = "ga-chart-controls-left";
  controls.appendChild(controlsLeft);

  const actionsRight = doc.createElement("div");
  actionsRight.className = "ga-chart-actions";
  controls.appendChild(actionsRight);

  const box = doc.createElement("div");
  box.className = "ga-chart-box";

  const chartHost = doc.createElement("div");
  chartHost.className = "ga-chart-host";
  box.appendChild(chartHost);

  const dimId = spec.x.dimension;

  const dimDef = semantic.dimensions[dimId];
  if (!dimDef) throw new Error(`Unknown dimension '${dimId}' in widget ${widget.widgetId}`);

  const measureIds = getMeasureIds(spec);
  if (measureIds.length === 0) throw new Error(`Widget ${widget.widgetId} has no y.measure or y.measures`);
  const colorOverride = normalizeHexColor(spec.color);

  const sortModes = getSortModes(spec);
  let activeSortMode: "chronological" | "asc" | "desc" | undefined =
    spec.activeSort?.mode ?? spec.sort?.mode ?? sortModes[0];
  if (activeSortMode && !sortModes.includes(activeSortMode)) sortModes.unshift(activeSortMode);

  let activeMeasure = measureIds.includes(spec.y.activeMeasure || "")
    ? (spec.y.activeMeasure as string)
    : measureIds[0];

  const accModes: Array<"period" | "to_date"> = [];
  const singleAcc = spec.y.accumulation;
  if (singleAcc) accModes.push(singleAcc);
  if (Array.isArray(spec.y.accumulations)) {
    for (const a of spec.y.accumulations) {
      if (!a) continue;
      if (!accModes.includes(a)) accModes.push(a);
    }
  }
  let activeAcc: "period" | "to_date" = spec.y.activeAccumulation ?? spec.y.accumulation ?? accModes[0] ?? "period";
  if (!accModes.includes(activeAcc)) accModes.unshift(activeAcc);

  let currentSvg: SVGSVGElement | null = null;

  const mkActionBtn = (label: string, onClick: () => void): HTMLButtonElement => {
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  };

  actionsRight.appendChild(
    mkActionBtn("Save PNG", () => {
      if (currentSvg) void downloadPng(doc, currentSvg, `${widget.title}_${activeMeasure}`);
    })
  );
  actionsRight.appendChild(
    mkActionBtn("Save SVG", () => {
      if (currentSvg) void downloadSvg(doc, currentSvg, `${widget.title}_${activeMeasure}`);
    })
  );

  if (sortModes.length > 1) {
    const label = doc.createElement("label");
    label.style.fontSize = "12px";
    label.style.opacity = "0.9";
    label.textContent = "Sort:";

    const select = doc.createElement("select");
    select.style.background = "var(--ga-control-bg)";
    select.style.color = "var(--ga-control-text)";
    select.style.border = "1px solid var(--ga-control-border)";
    select.style.borderRadius = "8px";
    select.style.padding = "4px 8px";

    for (const mode of sortModes) {
      const option = doc.createElement("option");
      option.value = mode;
      option.textContent = sortLabel(mode);
      if (mode === activeSortMode) option.selected = true;
      select.appendChild(option);
    }

    select.addEventListener("change", () => {
      const next = select.value as any;
      if (!sortModes.includes(next)) return;
      activeSortMode = next;
      render();
    });

    controlsLeft.appendChild(label);
    controlsLeft.appendChild(select);
  }

  if (accModes.length > 1 && dimId === "time_day") {
    const label = doc.createElement("label");
    label.style.fontSize = "12px";
    label.style.opacity = "0.9";
    label.textContent = "Mode:";

    const select = doc.createElement("select");
    select.style.background = "var(--ga-control-bg)";
    select.style.color = "var(--ga-control-text)";
    select.style.border = "1px solid var(--ga-control-border)";
    select.style.borderRadius = "8px";
    select.style.padding = "4px 8px";

    for (const mode of accModes) {
      const option = doc.createElement("option");
      option.value = mode;
      option.textContent = accumulationLabel(mode);
      if (mode === activeAcc) option.selected = true;
      select.appendChild(option);
    }

    select.addEventListener("change", () => {
      const next = select.value as any;
      if (!accModes.includes(next)) return;
      activeAcc = next;
      render();
    });

    controlsLeft.appendChild(label);
    controlsLeft.appendChild(select);
  }

  function getActiveGrain(): Grain {
    const measDef = semantic.measures[activeMeasure];
    return (measDef?.grain as Grain) ?? (widget.grain as Grain);
  }

  function getDatasetForGrain(g: Grain): any[] {
    const provided = datasets?.[g];
    if (Array.isArray(provided)) return provided;
    // Fallback only for non-analysis contexts.
    if (g === "game") return [];
    if (g === "session") return [];
    return [];
  }

  const drilldownGrainForTarget = (target: string): Grain => {
    if (target === "rounds") return "round";
    if (target === "players") return "game";
    if (target === "games") return "game";
    if (target === "sessions") return "session";
    return getActiveGrain();
  };

  const materializeRowsForDrilldown = (target: string, sourceGrain: Grain, rows: any[]): { grain: Grain; rows: any[] } => {
    const g = drilldownGrainForTarget(target);
    if (g === sourceGrain) return { grain: g, rows };

    // Allow session widgets to drill down into underlying rounds.
    if (sourceGrain === "session" && g === "round") {
      const out: any[] = [];
      for (const s of rows as any[]) {
        const r = (s as any)?.rounds;
        if (Array.isArray(r)) out.push(...r);
      }
      return { grain: "round", rows: out };
    }

    return { grain: g, rows };
  };

  const buildDataForMeasure = (measureId: string, limitOverride?: number): Datum[] => {
    const measDef = semantic.measures[measureId];
    if (!measDef) return [];

    const g = measDef.grain as Grain;
    const rows = getDatasetForGrain(g);
    const keyFn = DIMENSION_EXTRACTORS[g]?.[dimId];
    if (!keyFn) return [];

    const measureFn = MEASURES_BY_GRAIN[g]?.[measDef.formulaId];
    if (!measureFn) return [];

    const shareKind = getShareKindFromFormulaId(measDef.formulaId);
    const denom = shareKind ? sumDamage(rows, shareKind) : 0;
    const yForRows = (bucketRows: any[]): number => {
      if (!shareKind) return measureFn(bucketRows);
      return denom > 0 ? sumDamage(bucketRows, shareKind) / denom : 0;
    };

    // For time_day, fill all days, but clamp the range to the filtered data bounds (so charts start at first datapoint).
    if (dimId === "time_day") {
      const tsValues = rows
        .map((r) =>
          typeof (r as any).playedAt === "number"
            ? (r as any).playedAt
            : typeof (r as any).ts === "number"
              ? (r as any).ts
              : null
        )
        .filter((x) => typeof x === "number") as number[];
      const dataMinTs = tsValues.length ? Math.min(...tsValues) : null;
      const dataMaxTs = tsValues.length ? Math.max(...tsValues) : null;

      let fromTs = context?.dateRange?.fromTs ?? null;
      let toTs = context?.dateRange?.toTs ?? null;

      if (fromTs === null) fromTs = dataMinTs;
      if (toTs === null) toTs = dataMaxTs;
      if (dataMinTs !== null && fromTs !== null) fromTs = Math.max(fromTs, dataMinTs);
      if (dataMaxTs !== null && toTs !== null) toTs = Math.min(toTs, dataMaxTs);
      if (fromTs !== null && toTs !== null && fromTs > toTs) fromTs = toTs;

      const grouped = groupByKey(rows, keyFn);
      const keys = (fromTs !== null && toTs !== null) ? dayKeysBetween(fromTs, toTs) : sortKeysChronological(Array.from(grouped.keys()));
      const maxPoints =
        typeof spec.maxPoints === "number" && Number.isFinite(spec.maxPoints)
          ? Math.floor(spec.maxPoints)
          : typeof limitOverride === "number" && Number.isFinite(limitOverride)
            ? Math.floor(limitOverride)
            : 0;
      const buckets = maxPoints > 1 ? chunkKeys(keys, maxPoints) : keys.map((k) => ({ label: k, keys: [k] }));

      if (activeAcc === "to_date") {
        const cum: any[] = [];
        const out: Datum[] = [];
        for (const b of buckets) {
          const bucketRows: any[] = [];
          for (const k of b.keys) {
            const dayRows = grouped.get(k) ?? [];
            if (dayRows.length) bucketRows.push(...dayRows);
          }
          if (bucketRows.length) cum.push(...bucketRows);
          out.push({ x: b.label, y: clampForMeasure(semantic, measureId, yForRows(cum)), rows: cum.slice() });
        }
        return out;
      }

      const fillMode = measDef.timeDayFill ?? "none";
      const isRating = measDef.unit === "rating";
      let lastY: number | null = null;
      const out: Datum[] = [];
      for (const b of buckets) {
        const bucketRows: any[] = [];
        for (const k of b.keys) {
          const dayRows = grouped.get(k) ?? [];
          if (dayRows.length) bucketRows.push(...dayRows);
        }
        const yRaw = yForRows(bucketRows);
        const y = clampForMeasure(semantic, measureId, yRaw);

        if (fillMode === "carry_forward" && lastY !== null) {
          const isEmptyBucket = bucketRows.length === 0;
          const isMissingRatingValue = isRating && bucketRows.length > 0 && y === 0;
          const isNonFinite = !Number.isFinite(y);
          if (isEmptyBucket || isMissingRatingValue || isNonFinite) {
            out.push({ x: b.label, y: lastY, rows: bucketRows });
            continue;
          }
        }

        lastY = y;
        out.push({ x: b.label, y, rows: bucketRows });
      }
      return out;
    }

    const grouped = groupByKey(rows, keyFn);
    const keys = Array.from(grouped.keys());
    const baseData: Datum[] = keys.map((k) => {
      const rowsForKey = grouped.get(k) ?? [];
      return { x: k, y: clampForMeasure(semantic, measureId, yForRows(rowsForKey)), rows: rowsForKey };
    });

    // If this is an ordered axis and a long series, optionally bucket down to maxPoints.
    if (dimDef.ordered && typeof spec.maxPoints === "number" && Number.isFinite(spec.maxPoints) && spec.maxPoints > 1) {
      const maxPoints = Math.floor(spec.maxPoints);
      const ordered = sortData(baseData, "chronological");
      if (ordered.length > maxPoints && activeSortMode === "chronological") {
        const buckets = chunkKeys(ordered.map((d) => d.x), maxPoints);
        const byKey = new Map(ordered.map((d) => [d.x, d]));
        const out: Datum[] = buckets.map((b) => {
          const bucketRows: any[] = [];
          for (const k of b.keys) {
            const item = byKey.get(k);
            if (item?.rows?.length) bucketRows.push(...item.rows);
          }
          return { x: b.label, y: clampForMeasure(semantic, measureId, yForRows(bucketRows)), rows: bucketRows };
        });
        return out;
      }
    }

    const sortedData = sortData(baseData, activeSortMode);

    const limit = typeof limitOverride === "number" && Number.isFinite(limitOverride) && limitOverride > 0 ? limitOverride : spec.limit;
    return typeof limit === "number" && Number.isFinite(limit) && limit > 0
      ? sortedData.slice(0, Math.floor(limit))
      : sortedData;
  };

  const render = (): void => {
    chartHost.innerHTML = "";
    currentSvg = null;
    const measureDef = semantic.measures[activeMeasure];
    if (!measureDef) {
      const empty = doc.createElement("div");
      empty.style.fontSize = "12px";
      empty.style.opacity = "0.75";
      empty.textContent = "No chart data available for current selection.";
      chartHost.appendChild(empty);
      return;
    }

    const W = 1200;
    const H = 360;
    const PAD_L = 72;
    const PAD_B = 58;
    const PAD_T = 16;
    // Give extra room on the right so last bar/dot isn't visually clipped by rounded containers.
    const PAD_R = 72;
    const innerW = W - PAD_L - PAD_R;
    const innerH = H - PAD_T - PAD_B;

    const effectiveLimit =
      spec.type === "bar" && !(typeof spec.limit === "number" && Number.isFinite(spec.limit) && spec.limit > 0)
        ? (() => {
            const hostW = chartHost.getBoundingClientRect().width;
            const safeHostW = hostW > 50 ? hostW : 1000;
            const minBarPx = 18;
            const pxInnerW = safeHostW * (innerW / W);
            const maxBars = Math.floor(pxInnerW / minBarPx);
            return Math.max(6, Math.min(200, maxBars));
          })()
        : undefined;

    const data = buildDataForMeasure(activeMeasure, effectiveLimit);
    if (data.length === 0) {
      const empty = doc.createElement("div");
      empty.style.fontSize = "12px";
      empty.style.opacity = "0.75";
      empty.textContent = "No chart data available for current selection.";
      chartHost.appendChild(empty);
      return;
    }

    const unitFormatRaw = semantic.units[measureDef.unit]?.format ?? "float";
    // Datetime measures are not intended for chart y-axes; treat them as ints to avoid layout/type issues.
    const unitFormat = unitFormatRaw === "datetime" ? "int" : unitFormatRaw;
    // Percent line series should be allowed to "fit" (still clamped to 0..100% in computeYBounds).
    const preferZero = spec.type === "bar" || unitFormat === "int";
    const yVals = data.map((d) => clampForMeasure(semantic, activeMeasure, d.y));
    const hardMin = measureDef.range?.min;
    const hardMax = measureDef.range?.max;
    const { minY, maxY } = computeYBounds({
      unitFormat,
      values: yVals,
      preferZero,
      hardMin: typeof hardMin === "number" && Number.isFinite(hardMin) ? hardMin : undefined,
      hardMax: typeof hardMax === "number" && Number.isFinite(hardMax) ? hardMax : undefined
    });
    const yRange = Math.max(1e-9, maxY - minY);

    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("ga-chart-svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

    const axisX = doc.createElementNS(svg.namespaceURI, "line");
    axisX.setAttribute("x1", String(PAD_L));
    axisX.setAttribute("y1", String(PAD_T + innerH));
    axisX.setAttribute("x2", String(PAD_L + innerW));
    axisX.setAttribute("y2", String(PAD_T + innerH));
    axisX.setAttribute("stroke", "var(--ga-axis-color)");
    axisX.setAttribute("opacity", "0.7");
    svg.appendChild(axisX);

    const axisY = doc.createElementNS(svg.namespaceURI, "line");
    axisY.setAttribute("x1", String(PAD_L));
    axisY.setAttribute("y1", String(PAD_T));
    axisY.setAttribute("x2", String(PAD_L));
    axisY.setAttribute("y2", String(PAD_T + innerH));
    axisY.setAttribute("stroke", "var(--ga-axis-color)");
    axisY.setAttribute("opacity", "0.7");
    svg.appendChild(axisY);

    const tickCount = 5;
    for (let i = 0; i <= tickCount; i++) {
      const yVal = minY + (yRange * i) / tickCount;
      const yPos = PAD_T + innerH - ((yVal - minY) / yRange) * innerH;

      const grid = doc.createElementNS(svg.namespaceURI, "line");
      grid.setAttribute("x1", String(PAD_L));
      grid.setAttribute("y1", String(yPos));
      grid.setAttribute("x2", String(PAD_L + innerW));
      grid.setAttribute("y2", String(yPos));
      grid.setAttribute("stroke", "var(--ga-axis-grid)");
      grid.setAttribute("opacity", i === 0 ? "0.8" : "0.45");
      svg.appendChild(grid);

      const yTick = doc.createElementNS(svg.namespaceURI, "text");
      yTick.setAttribute("x", String(PAD_L - 8));
      yTick.setAttribute("y", String(yPos + 3));
      yTick.setAttribute("text-anchor", "end");
      yTick.setAttribute("font-size", "10");
      yTick.setAttribute("fill", "var(--ga-axis-text)");
      yTick.setAttribute("opacity", "0.95");
      yTick.textContent = formatMeasureValue(doc, semantic, activeMeasure, yVal);
      svg.appendChild(yTick);
    }

    const xAxisLabel = doc.createElementNS(svg.namespaceURI, "text");
    xAxisLabel.setAttribute("x", String(PAD_L + innerW / 2));
    xAxisLabel.setAttribute("y", String(H - 8));
    xAxisLabel.setAttribute("text-anchor", "middle");
    xAxisLabel.setAttribute("font-size", "12");
    xAxisLabel.setAttribute("fill", "var(--ga-axis-text)");
    xAxisLabel.setAttribute("opacity", "0.95");
    xAxisLabel.textContent = dimDef.label;
    svg.appendChild(xAxisLabel);

    // Minimal x-axis labeling for long time series: show start/end only (always visible).
    if (dimId === "time_day" && data.length > 0) {
      const first = data[0].x;
      const last = data[data.length - 1].x;

      const lx = doc.createElementNS(svg.namespaceURI, "text");
      lx.setAttribute("x", String(PAD_L + 2));
      lx.setAttribute("y", String(PAD_T + innerH + 18));
      lx.setAttribute("text-anchor", "start");
      lx.setAttribute("font-size", "10");
      lx.setAttribute("fill", "var(--ga-axis-text)");
      lx.setAttribute("opacity", "0.95");
      lx.textContent = first;
      svg.appendChild(lx);

      const rx = doc.createElementNS(svg.namespaceURI, "text");
      rx.setAttribute("x", String(PAD_L + innerW - 2));
      rx.setAttribute("y", String(PAD_T + innerH + 18));
      rx.setAttribute("text-anchor", "end");
      rx.setAttribute("font-size", "10");
      rx.setAttribute("fill", "var(--ga-axis-text)");
      rx.setAttribute("opacity", "0.95");
      rx.textContent = last;
      svg.appendChild(rx);
    }

    const yAxisLabel = doc.createElementNS(svg.namespaceURI, "text");
    yAxisLabel.setAttribute("x", "16");
    yAxisLabel.setAttribute("y", String(PAD_T + innerH / 2));
    yAxisLabel.setAttribute("text-anchor", "middle");
    yAxisLabel.setAttribute("font-size", "12");
    yAxisLabel.setAttribute("fill", "var(--ga-axis-text)");
    yAxisLabel.setAttribute("opacity", "0.95");
    yAxisLabel.setAttribute("transform", `rotate(-90 16 ${PAD_T + innerH / 2})`);
    yAxisLabel.textContent = measureDef.label;
    svg.appendChild(yAxisLabel);

    if (spec.type === "line") {
      const outerPad = Math.min(28, innerW * 0.06);
      const xSpan = Math.max(1, innerW - outerPad * 2);
      const points = data.map((d, i) => {
        const x = PAD_L + outerPad + (i / Math.max(1, data.length - 1)) * xSpan;
        const y = PAD_T + innerH - ((clampForMeasure(semantic, activeMeasure, d.y) - minY) / yRange) * innerH;
        return { x, y, d };
      });
      const path = doc.createElementNS(svg.namespaceURI, "path");
      path.classList.add("ga-chart-line-path");
      const dPath = points.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
      path.setAttribute("d", dPath);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", colorOverride ?? "var(--ga-graph-color)");
      path.setAttribute("stroke-width", "2.5");
      path.setAttribute("opacity", "0.9");
      svg.appendChild(path);
      if (isAnimationsEnabled(doc)) {
        // Set dash properties once; CSS animates dashoffset on visibility.
        prepareLineAnimation(path);
      }
      points.forEach((p, i) => {
        const dot = doc.createElementNS(svg.namespaceURI, "circle");
        dot.classList.add("ga-chart-line-dot");
        dot.style.setProperty("--ga-dot-index", String(i));
        dot.setAttribute("cx", String(p.x));
        dot.setAttribute("cy", String(p.y));
        dot.setAttribute("r", "3");
        dot.setAttribute("fill", colorOverride ?? "var(--ga-graph-color)");
        dot.setAttribute("opacity", "0.95");
        const tooltip = doc.createElementNS(svg.namespaceURI, "title");
        tooltip.textContent = `${formatDimensionKey(doc, dimId, p.d.x)}: ${formatMeasureValue(doc, semantic, activeMeasure, clampForMeasure(semantic, activeMeasure, p.d.y))}`;
        dot.appendChild(tooltip);
        const click = mergeDrilldownDefaults(spec.actions?.click as any, semantic.measures[activeMeasure]?.drilldown as any);
        if (click?.type === "drilldown") {
          dot.setAttribute("style", "cursor: pointer;");
          dot.addEventListener("click", () => {
            const sourceGrain = getActiveGrain();
            const ddGrain = drilldownGrainForTarget(click.target);
            const base = getDatasetForGrain(ddGrain);
            const sourceRows = click.filterFromPoint ? p.d.rows : base;
            // When not filtering from point we already have drilldown-grain rows (base).
            const sourceRowsGrain = click.filterFromPoint ? sourceGrain : ddGrain;
            const { grain, rows } = materializeRowsForDrilldown(click.target, sourceRowsGrain, sourceRows as any[]);
            const filteredRows = applyFilters(rows, click.extraFilters, grain);
            overlay.open(semantic, {
              title: `${widget.title} - ${p.d.x}`,
              target: click.target,
              columnsPreset: click.columnsPreset,
              rows: filteredRows,
              extraFilters: click.extraFilters
            });
          });
        }
        svg.appendChild(dot);
      });
      maybeAnimateChartSvg(svg, doc);
    } else {
      const n = Math.max(1, data.length);
      const slotW = innerW / n;
      const outerPad = Math.min(28, slotW * 0.6);
      const xSpan = Math.max(1, innerW - outerPad * 2);
      const barW = xSpan / n;
      data.forEach((d, i) => {
        const x = PAD_L + outerPad + i * barW;
        const h = ((clampForMeasure(semantic, activeMeasure, d.y) - minY) / yRange) * innerH;
        const y = PAD_T + innerH - h;

        const rect = doc.createElementNS(svg.namespaceURI, "rect");
        rect.classList.add("ga-chart-bar");
        rect.style.setProperty("--ga-bar-index", String(i));
        rect.setAttribute("x", String(x + 1));
        rect.setAttribute("y", String(y));
        rect.setAttribute("width", String(Math.max(1, barW - 2)));
        rect.setAttribute("height", String(Math.max(0, h)));
        rect.setAttribute("rx", "2");
        rect.setAttribute("fill", colorOverride ?? "var(--ga-graph-color)");
        rect.setAttribute("opacity", "0.72");
        rect.style.animationDelay = `${Math.min(i * 18, 320)}ms`;
        rect.style.transformOrigin = `${x + barW / 2}px ${PAD_T + innerH}px`;
        rect.style.transformBox = "view-box";

        const tooltip = doc.createElementNS(svg.namespaceURI, "title");
        tooltip.textContent = `${formatDimensionKey(doc, dimId, d.x)}: ${formatMeasureValue(doc, semantic, activeMeasure, clampForMeasure(semantic, activeMeasure, d.y))}`;
        rect.appendChild(tooltip);

        const click = mergeDrilldownDefaults(spec.actions?.click as any, semantic.measures[activeMeasure]?.drilldown as any);
        if (click?.type === "drilldown") {
          rect.setAttribute("style", `${rect.getAttribute("style") ?? ""};cursor:pointer;`);
          rect.addEventListener("click", () => {
            const sourceGrain = getActiveGrain();
            const ddGrain = drilldownGrainForTarget(click.target);
            const base = getDatasetForGrain(ddGrain);
            const sourceRows = click.filterFromPoint ? d.rows : base;
            // When not filtering from point we already have drilldown-grain rows (base).
            const sourceRowsGrain = click.filterFromPoint ? sourceGrain : ddGrain;
            const { grain, rows } = materializeRowsForDrilldown(click.target, sourceRowsGrain, sourceRows as any[]);
            const filteredRows = applyFilters(rows, click.extraFilters, grain);
            overlay.open(semantic, {
              title: `${widget.title} - ${d.x}`,
              target: click.target,
              columnsPreset: click.columnsPreset,
              rows: filteredRows,
              extraFilters: click.extraFilters
            });
          });
        }
        svg.appendChild(rect);

        if (data.length <= 20 || i % Math.ceil(data.length / 10) === 0) {
          const tx = doc.createElementNS(svg.namespaceURI, "text");
          const isFirst = i === 0;
          const isLast = i === data.length - 1;
          const labelX = isFirst ? PAD_L + 2 : isLast ? PAD_L + innerW - 2 : x + barW / 2;
          tx.setAttribute("x", String(labelX));
          tx.setAttribute("y", String(PAD_T + innerH + 16));
          tx.setAttribute("text-anchor", isFirst ? "start" : isLast ? "end" : "middle");
          tx.setAttribute("font-size", "10");
          tx.setAttribute("fill", "var(--ga-axis-text)");
          tx.setAttribute("opacity", "0.95");
          tx.textContent = formatDimensionKey(doc, dimId, d.x);
          svg.appendChild(tx);
        }
      });
      maybeAnimateChartSvg(svg, doc);
    }

    chartHost.appendChild(svg);
    currentSvg = svg;
  };

  if (measureIds.length > 1) {
    const label = doc.createElement("label");
    label.style.fontSize = "12px";
    label.style.opacity = "0.9";
    label.textContent = "Measure:";

    const select = doc.createElement("select");
    select.style.background = "var(--ga-control-bg)";
    select.style.color = "var(--ga-control-text)";
    select.style.border = "1px solid var(--ga-control-border)";
    select.style.borderRadius = "8px";
    select.style.padding = "4px 8px";
    for (const measureId of measureIds) {
      const option = doc.createElement("option");
      option.value = measureId;
      option.textContent = semantic.measures[measureId]?.label || measureId;
      if (measureId === activeMeasure) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener("change", () => {
      activeMeasure = select.value;
      render();
    });

    controlsLeft.appendChild(label);
    controlsLeft.appendChild(select);
  }

  render();

  wrap.appendChild(title);
  wrap.appendChild(controls);
  wrap.appendChild(box);
  return wrap;
}
