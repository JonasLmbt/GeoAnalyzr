import type { SemanticRegistry } from "../../config/semantic.types";
import type { WidgetDef, BreakdownSpec } from "../../config/dashboard.types";
import type { Grain } from "../../config/semantic.types";
import { getRounds, getGames, getSessions } from "../../engine/queryEngine";
import { DIMENSION_EXTRACTORS } from "../../engine/dimensions";
import { groupByKey } from "../../engine/aggregate";
import { MEASURES_BY_GRAIN } from "../../engine/measures";
import { applyFilters } from "../../engine/filters";
import { maybeEnrichRoundRowsForDimension } from "../../engine/regionEnrichment";
import { DrilldownOverlay } from "../drilldownOverlay";

type Row = {
  key: string;
  value: number;
  rows: any[];
};

function getShareKindFromFormulaId(formulaId: string): "dealt" | "taken" | "rounds" | null {
  if (formulaId === "share_damage_dealt") return "dealt";
  if (formulaId === "share_damage_taken") return "taken";
  if (formulaId === "share_rounds") return "rounds";
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

function normalizeHexColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : undefined;
}

function sortRows(rows: Row[], mode: "chronological" | "asc" | "desc"): Row[] {
  if (mode === "asc") return [...rows].sort((a, b) => a.value - b.value);
  if (mode === "desc") return [...rows].sort((a, b) => b.value - a.value);

  const scoreBucketStart = (k: string) => (k === "5000" ? 5000 : parseInt(k.split("-")[0] ?? "0", 10));
  const isDate = (k: string) => /^\d{4}-\d{2}-\d{2}$/.test(k);
  const weekdayRank = (k: string): number | undefined => {
    const v = k.trim().toLowerCase();
    if (v === "mon") return 0;
    if (v === "tue") return 1;
    if (v === "wed") return 2;
    if (v === "thu") return 3;
    if (v === "fri") return 4;
    if (v === "sat") return 5;
    if (v === "sun") return 6;
    return undefined;
  };

  return [...rows].sort((a, b) => {
    if (isDate(a.key) && isDate(b.key)) return a.key.localeCompare(b.key);
    const wa = weekdayRank(a.key);
    const wb = weekdayRank(b.key);
    if (wa !== undefined && wb !== undefined) return wa - wb;
    const na = Number.isFinite(scoreBucketStart(a.key)) ? scoreBucketStart(a.key) : NaN;
    const nb = Number.isFinite(scoreBucketStart(b.key)) ? scoreBucketStart(b.key) : NaN;
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return a.key.localeCompare(b.key);
  });
}

function readDateFormatMode(doc: Document): "dd/mm/yyyy" | "mm/dd/yyyy" | "yyyy-mm-dd" | "locale" {
  const root = doc.querySelector(".ga-root") as HTMLElement | null;
  const mode = root?.dataset?.gaDateFormat;
  return mode === "mm/dd/yyyy" || mode === "yyyy-mm-dd" || mode === "locale" ? mode : "dd/mm/yyyy";
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

function formatValue(doc: Document, semantic: SemanticRegistry, measureId: string, value: number): string {
  const m = semantic.measures[measureId];
  const unit = semantic.units[m.unit];
  if (!unit) return String(value);

  if (unit.format === "datetime") return formatDateTime(doc, value);
  if (unit.format === "percent") {
    const clamped = Math.max(0, Math.min(1, value));
    const decimals = unit.decimals ?? 1;
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

function clampForMeasure(semantic: SemanticRegistry, measureId: string, value: number): number {
  const m = semantic.measures[measureId];
  const unit = m ? semantic.units[m.unit] : undefined;
  if (unit?.format === "percent") return Math.max(0, Math.min(1, value));
  return value;
}

function getMeasureIds(spec: BreakdownSpec): string[] {
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

function getSortModes(spec: BreakdownSpec): Array<"chronological" | "asc" | "desc"> {
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

export async function renderBreakdownWidget(
  semantic: SemanticRegistry,
  widget: WidgetDef,
  overlay: DrilldownOverlay,
  baseRows?: any[]
): Promise<HTMLElement> {
  const spec = widget.spec as BreakdownSpec;
  const doc = overlay.getDocument();
  const exclude = new Set(
    Array.isArray(spec.excludeKeys) ? spec.excludeKeys.map((k) => (typeof k === "string" ? k.trim().toLowerCase() : "")).filter(Boolean) : []
  );

  const wrap = doc.createElement("div");
  wrap.className = "ga-widget ga-breakdown";

  const title = doc.createElement("div");
  title.className = "ga-widget-title";
  title.textContent = widget.title;

  const header = doc.createElement("div");
  header.className = "ga-breakdown-header";

  const box = doc.createElement("div");
  box.className = "ga-breakdown-box";

  const grain = widget.grain as Grain;
  const rowsAllBase =
    baseRows ??
    (grain === "game" ? await getGames({}) : grain === "session" ? await getSessions({}) : await getRounds({}));
  const rowsAll = applyFilters(rowsAllBase, spec.filters, grain);
  const dimId = spec.dimension;

  const dimDef = semantic.dimensions[dimId];
  if (!dimDef) throw new Error(`Unknown dimension '${dimId}' in breakdown ${widget.widgetId}`);

  const keyFn = DIMENSION_EXTRACTORS[grain]?.[dimId];
  if (!keyFn) throw new Error(`No extractor implemented for dimension '${dimId}' (breakdown)`);

  if (grain === "round") {
    await maybeEnrichRoundRowsForDimension(dimId, rowsAll as any[]);
  }

  const measureIds = getMeasureIds(spec);
  if (measureIds.length === 0) throw new Error(`Breakdown ${widget.widgetId} has no measure or measures[]`);
  const measureFnById = new Map<string, (rows: any[]) => number>();
  for (const measureId of measureIds) {
    const measDef = semantic.measures[measureId];
    if (!measDef) throw new Error(`Unknown measure '${measureId}' in breakdown ${widget.widgetId}`);
    const measureFn = MEASURES_BY_GRAIN[grain]?.[measDef.formulaId];
    if (!measureFn) throw new Error(`Missing measure implementation for formulaId=${measDef.formulaId}`);
    measureFnById.set(measureId, measureFn);
  }

  let activeMeasure = measureIds.includes(spec.activeMeasure || "")
    ? (spec.activeMeasure as string)
    : measureIds[0];

  const sortModes = getSortModes(spec);
  let activeSortMode: "chronological" | "asc" | "desc" =
    spec.activeSort?.mode ?? spec.sort?.mode ?? sortModes[0] ?? "desc";
  if (!sortModes.includes(activeSortMode)) sortModes.unshift(activeSortMode);

  const grouped = groupByKey(rowsAll, keyFn);
  const colorOverride = normalizeHexColor(spec.color);

  const limit = typeof spec.limit === "number" ? spec.limit : 12;
  let expanded = false;

  const headerLeft = doc.createElement("div");
  headerLeft.className = "ga-breakdown-header-left";
  headerLeft.textContent = dimDef.label;

  const headerRight = doc.createElement("div");
  headerRight.className = "ga-breakdown-header-right";

  header.appendChild(headerLeft);
  header.appendChild(headerRight);

  let rowsAllSorted: Row[] = [];
  let maxValAll = 1e-9;

  const rebuildForActiveMeasure = (): void => {
    const measDef = semantic.measures[activeMeasure];
    if (!measDef) return;

    const shareKind = getShareKindFromFormulaId(measDef.formulaId);
    const measureFn = shareKind ? null : measureFnById.get(activeMeasure);
    if (!shareKind && !measureFn) return;
    const denom =
      shareKind === "rounds" ? rowsAll.length : shareKind ? sumDamage(rowsAll, shareKind) : 0;

    rowsAllSorted = Array.from(grouped.entries())
      .filter(([k]) => !exclude.has(String(k).trim().toLowerCase()))
      .map(([k, g]) => ({
        key: k,
        value: clampForMeasure(
          semantic,
          activeMeasure,
          shareKind === "rounds"
            ? (denom > 0 ? g.length / denom : 0)
            : shareKind
              ? (denom > 0 ? sumDamage(g, shareKind) / denom : 0)
              : (measureFn as any)(g)
        ),
        rows: g
      }));

    rowsAllSorted = sortRows(rowsAllSorted, activeSortMode);
    maxValAll = Math.max(1e-9, ...rowsAllSorted.map((r) => clampForMeasure(semantic, activeMeasure, r.value)));
  };

  const renderHeaderRight = (): void => {
    headerRight.innerHTML = "";
    const measDef = semantic.measures[activeMeasure];
    const labelText = measDef ? measDef.label : activeMeasure;

    const wrapRight = doc.createElement("div");
    wrapRight.className = "ga-breakdown-controls";

    if (measureIds.length > 1) {
      const mLabel = doc.createElement("span");
      mLabel.className = "ga-breakdown-ctl-label";
      mLabel.textContent = "Measure:";

      const mSelect = doc.createElement("select");
      mSelect.className = "ga-breakdown-ctl-select";
      for (const measureId of measureIds) {
        const opt = doc.createElement("option");
        opt.value = measureId;
        opt.textContent = semantic.measures[measureId]?.label ?? measureId;
        if (measureId === activeMeasure) opt.selected = true;
        mSelect.appendChild(opt);
      }
      mSelect.addEventListener("change", () => {
        const next = mSelect.value;
        if (!measureIds.includes(next)) return;
        activeMeasure = next;
        rebuildForActiveMeasure();
        renderHeaderRight();
        renderRows();
        renderFooter();
      });

      wrapRight.appendChild(mLabel);
      wrapRight.appendChild(mSelect);
    } else {
      const mText = doc.createElement("span");
      mText.textContent = labelText;
      wrapRight.appendChild(mText);
    }

    if (sortModes.length > 1) {
      const sLabel = doc.createElement("span");
      sLabel.className = "ga-breakdown-ctl-label";
      sLabel.textContent = "Sort:";

      const sSelect = doc.createElement("select");
      sSelect.className = "ga-breakdown-ctl-select";
      for (const mode of sortModes) {
        const opt = doc.createElement("option");
        opt.value = mode;
        opt.textContent = sortLabel(mode);
        if (mode === activeSortMode) opt.selected = true;
        sSelect.appendChild(opt);
      }
      sSelect.addEventListener("change", () => {
        const next = sSelect.value as any;
        if (!sortModes.includes(next)) return;
        activeSortMode = next;
        rebuildForActiveMeasure();
        renderRows();
        renderFooter();
      });

      wrapRight.appendChild(sLabel);
      wrapRight.appendChild(sSelect);
    }

    headerRight.appendChild(wrapRight);
  };

  const renderRows = (): void => {
    box.innerHTML = "";
    const visible = expanded ? rowsAllSorted : rowsAllSorted.slice(0, limit);

    for (const r of visible) {
      const line = doc.createElement("div");
      line.className = "ga-breakdown-row";

      const left = doc.createElement("div");
      left.className = "ga-breakdown-label";
      left.textContent = formatDimensionKey(doc, dimId, r.key);

      const right = doc.createElement("div");
      right.className = "ga-breakdown-right";

      const val = doc.createElement("div");
      val.className = "ga-breakdown-value";
      val.textContent = formatValue(doc, semantic, activeMeasure, r.value);

      const barWrap = doc.createElement("div");
      barWrap.className = "ga-breakdown-barwrap";

      const bar = doc.createElement("div");
      bar.className = "ga-breakdown-bar";
      bar.style.width = `${Math.max(2, (r.value / maxValAll) * 100)}%`;
      if (colorOverride) bar.style.background = colorOverride;

      barWrap.appendChild(bar);
      right.appendChild(val);
      right.appendChild(barWrap);

      line.appendChild(left);
      line.appendChild(right);

      const click = mergeDrilldownDefaults(spec.actions?.click as any, semantic.measures[activeMeasure]?.drilldown as any);
      if (click?.type === "drilldown") {
        line.style.cursor = "pointer";
        line.addEventListener("click", () => {
          const rowsFromPoint = click.filterFromPoint ? r.rows : rowsAll;
          let sourceRows: any[] = rowsFromPoint as any[];
          let targetGrain: Grain = grain;
          if (grain === "session" && click.target === "rounds") {
            targetGrain = "round";
            const out: any[] = [];
            for (const s of sourceRows as any[]) {
              const rr = (s as any)?.rounds;
              if (Array.isArray(rr)) out.push(...rr);
            }
            sourceRows = out;
          }
          const filteredRows = applyFilters(sourceRows, click.extraFilters, targetGrain);
          overlay.open(semantic, {
            title: `${widget.title} - ${r.key}`,
            target: click.target,
            columnsPreset: click.columnsPreset,
            rows: filteredRows,
            extraFilters: click.extraFilters
          });
        });
      }

      box.appendChild(line);
    }
  };

  const footer = doc.createElement("div");
  footer.className = "ga-breakdown-footer";

  const renderFooter = (): void => {
    footer.innerHTML = "";
    const canExpand = !!spec.extendable && rowsAllSorted.length > limit;
    if (!canExpand) return;

    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "ga-breakdown-toggle";
    const updateLabel = () => {
      btn.textContent = expanded ? `Show top ${limit}` : `Show all (${rowsAllSorted.length})`;
    };
    updateLabel();
    btn.addEventListener("click", () => {
      expanded = !expanded;
      updateLabel();
      renderRows();
    });
    footer.appendChild(btn);
  };

  rebuildForActiveMeasure();
  renderHeaderRight();
  renderRows();
  renderFooter();

  wrap.appendChild(title);
  wrap.appendChild(header);
  wrap.appendChild(box);
  if (footer.childElementCount > 0) wrap.appendChild(footer);
  return wrap;
}
