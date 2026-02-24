import type { SemanticRegistry } from "../../config/semantic.types";
import type { WidgetDef, CountryMetricMapSpec } from "../../config/dashboard.types";
import type { Grain } from "../../config/semantic.types";
import { getRounds, getGames, getSessions } from "../../engine/queryEngine";
import { applyFilters } from "../../engine/filters";
import { groupByKey } from "../../engine/aggregate";
import { DIMENSION_EXTRACTORS } from "../../engine/dimensions";
import { MEASURES_BY_GRAIN } from "../../engine/measures";
import { renderCountryMapPicker } from "../countryMapPicker";
import { DrilldownOverlay } from "../drilldownOverlay";

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

function normalizeIso2Key(key: string): string | null {
  const v = key.trim().toLowerCase();
  return /^[a-z]{2}$/.test(v) ? v : null;
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

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(h)) return null;
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return { r, g, b };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function colorForValue(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  // Higher = darker.
  const lo = { r: 96, g: 140, b: 214 };
  const hi = { r: 18, g: 64, b: 128 };
  const a = lerp(0.18, 0.95, clamped);
  const r = Math.round(lerp(lo.r, hi.r, clamped));
  const g = Math.round(lerp(lo.g, hi.g, clamped));
  const b = Math.round(lerp(lo.b, hi.b, clamped));
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

export async function renderCountryMetricMapWidget(
  semantic: SemanticRegistry,
  widget: WidgetDef,
  overlay: DrilldownOverlay,
  baseRows?: any[]
): Promise<HTMLElement> {
  const spec = widget.spec as CountryMetricMapSpec;
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

  const rowsAllBase =
    baseRows ??
    (grain === "game" ? await getGames({}) : grain === "session" ? await getSessions({}) : await getRounds({}));
  const rowsAll = applyFilters(rowsAllBase as any[], spec.filters, grain);

  const keyFn = DIMENSION_EXTRACTORS[grain]?.[spec.dimension];
  if (!keyFn) throw new Error(`No extractor implemented for dimension '${spec.dimension}' (country_map)`);

  const measures: string[] = [];
  if (typeof (spec as any).measure === "string" && (spec as any).measure.trim()) measures.push((spec as any).measure.trim());
  if (Array.isArray(spec.measures)) for (const m of spec.measures) if (typeof m === "string" && m.trim() && !measures.includes(m.trim())) measures.push(m.trim());
  if (measures.length === 0) throw new Error(`Country map ${widget.widgetId} has no measure or measures[]`);

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
    if (!measDef) throw new Error(`Unknown measure '${activeMeasure}' (country_map)`);
    const unit = semantic.units[measDef.unit];

    const groupedRaw = groupByKey(rowsAll as any[], keyFn as any);
    const grouped = new Map<string, any[]>();
    for (const [k, g] of groupedRaw.entries()) {
      const iso2 = normalizeIso2Key(String(k));
      if (!iso2) continue;
      grouped.set(iso2, g);
    }

    const selectableValues = Array.from(grouped.keys());

    const values = new Map<string, number>();
    const formulaId = measDef.formulaId;
    const shareKind = formulaId === "share_damage_dealt" ? "dealt" : formulaId === "share_damage_taken" ? "taken" : formulaId === "share_rounds" ? "rounds" : null;
    const denom =
      shareKind === "rounds" ? rowsAll.length : shareKind ? sumDamage(rowsAll as any[], shareKind as any) : 0;

    const measureFn = shareKind ? null : MEASURES_BY_GRAIN[grain]?.[formulaId];
    if (!shareKind && !measureFn) throw new Error(`Missing measure implementation for formulaId=${formulaId}`);

    let min = Infinity;
    let max = -Infinity;
    for (const [iso2, g] of grouped.entries()) {
      const v =
        shareKind === "rounds"
          ? denom > 0
            ? g.length / denom
            : 0
          : shareKind
            ? denom > 0
              ? sumDamage(g, shareKind as any) / denom
              : 0
            : (measureFn as any)(g);
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      const vv = unit?.format === "percent" ? Math.max(0, Math.min(1, v)) : v;
      values.set(iso2, vv);
      min = Math.min(min, vv);
      max = Math.max(max, vv);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      min = 0;
      max = 1;
    }
    const span = Math.max(1e-9, max - min);

    // Legend
    legend.innerHTML = "";
    const left = doc.createElement("div");
    left.className = "ga-country-map-legend-min";
    left.textContent = formatValue(doc, semantic, activeMeasure, min);
    const bar = doc.createElement("div");
    bar.className = "ga-country-map-legend-bar";
    bar.style.background = `linear-gradient(90deg, ${colorForValue(0)}, ${colorForValue(1)})`;
    const right = doc.createElement("div");
    right.className = "ga-country-map-legend-max";
    right.textContent = formatValue(doc, semantic, activeMeasure, max);
    legend.appendChild(left);
    legend.appendChild(bar);
    legend.appendChild(right);

    // Render base map (cached geojson). Then apply fills/tooltip.
    await renderCountryMapPicker({
      container: mapHost,
      value: "",
      selectableValues,
      tintSelectable: false,
      onChange: (iso2) => {
        const click = spec.actions?.click as any;
        if (!click || click.type !== "drilldown") return;
        const rowsFromPoint = click.filterFromPoint ? (grouped.get(iso2) ?? []) : (rowsAll as any[]);
        const filteredRows = applyFilters(rowsFromPoint, click.extraFilters, grain);
        overlay.open(semantic, {
          title: `${widget.title} - ${formatCountry(doc, iso2.toUpperCase())}`,
          target: click.target,
          columnsPreset: click.columnsPreset,
          rows: filteredRows,
          extraFilters: click.extraFilters
        });
      }
    });

    const paths = Array.from(mapHost.querySelectorAll("path.ga-country-shape")) as SVGPathElement[];
    for (const p of paths) {
      const iso2 = typeof (p as any).dataset?.iso2 === "string" ? String((p as any).dataset.iso2) : "";
      const v = values.get(iso2);
      if (typeof v === "number" && Number.isFinite(v)) {
        const t = span > 0 ? (v - min) / span : 1;
        p.style.fill = colorForValue(t);
        p.style.opacity = "1";
      }

      // Tooltip
      const label = iso2 ? formatCountry(doc, iso2.toUpperCase()) : "";
      const valTxt = typeof v === "number" && Number.isFinite(v) ? formatValue(doc, semantic, activeMeasure, v) : "n/a";
      const tt = `${label}${label && valTxt ? ": " : ""}${valTxt}`;
      let titleEl = p.querySelector("title");
      if (!titleEl) {
        titleEl = doc.createElementNS("http://www.w3.org/2000/svg", "title");
        p.appendChild(titleEl);
      }
      titleEl.textContent = tt;

      // Hover emphasis without overriding the choropleth fill.
      p.addEventListener("pointerenter", () => {
        p.style.filter = "brightness(1.12)";
        p.style.strokeWidth = "2";
      });
      p.addEventListener("pointerleave", () => {
        p.style.filter = "";
        p.style.strokeWidth = "";
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

