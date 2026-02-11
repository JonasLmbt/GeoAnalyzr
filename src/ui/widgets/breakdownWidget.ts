import type { SemanticRegistry } from "../../config/semantic.types";
import type { WidgetDef, BreakdownSpec } from "../../config/dashboard.types";
import { getRounds } from "../../engine/queryEngine";
import { ROUND_DIMENSION_EXTRACTORS } from "../../engine/dimensions";
import { groupByKey } from "../../engine/aggregate";
import { ROUND_MEASURES_BY_FORMULA_ID } from "../../engine/measures";
import { applyFilters } from "../../engine/filters";
import { DrilldownOverlay } from "../drilldownOverlay";

type Row = {
  key: string;
  value: number;
  rows: any[];
};

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

  return [...rows].sort((a, b) => {
    if (isDate(a.key) && isDate(b.key)) return a.key.localeCompare(b.key);
    const na = Number.isFinite(scoreBucketStart(a.key)) ? scoreBucketStart(a.key) : NaN;
    const nb = Number.isFinite(scoreBucketStart(b.key)) ? scoreBucketStart(b.key) : NaN;
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return a.key.localeCompare(b.key);
  });
}

function formatValue(semantic: SemanticRegistry, measureId: string, value: number): string {
  const m = semantic.measures[measureId];
  const unit = semantic.units[m.unit];
  if (!unit) return String(value);

  if (unit.format === "percent") {
    const decimals = unit.decimals ?? 1;
    return `${(value * 100).toFixed(decimals)}%`;
  }
  if (unit.format === "int") return String(Math.round(value));
  const decimals = unit.decimals ?? 1;
  return value.toFixed(decimals);
}

export async function renderBreakdownWidget(
  semantic: SemanticRegistry,
  widget: WidgetDef,
  overlay: DrilldownOverlay
): Promise<HTMLElement> {
  const spec = widget.spec as BreakdownSpec;
  const doc = overlay.getDocument();

  const wrap = doc.createElement("div");
  wrap.className = "ga-widget ga-breakdown";

  const title = doc.createElement("div");
  title.className = "ga-widget-title";
  title.textContent = widget.title;

  const box = doc.createElement("div");
  box.className = "ga-breakdown-box";

  const rowsAll = applyFilters(await getRounds({}), spec.filters);
  const dimId = spec.dimension;
  const measId = spec.measure;

  const dimDef = semantic.dimensions[dimId];
  const measDef = semantic.measures[measId];
  if (!dimDef) throw new Error(`Unknown dimension '${dimId}' in breakdown ${widget.widgetId}`);
  if (!measDef) throw new Error(`Unknown measure '${measId}' in breakdown ${widget.widgetId}`);

  const keyFn = ROUND_DIMENSION_EXTRACTORS[dimId];
  if (!keyFn) throw new Error(`No extractor implemented for dimension '${dimId}' (breakdown)`);

  const measureFn = ROUND_MEASURES_BY_FORMULA_ID[measDef.formulaId];
  if (!measureFn) throw new Error(`Missing measure implementation for formulaId=${measDef.formulaId}`);

  const grouped = groupByKey(rowsAll, keyFn);
  const colorOverride = normalizeHexColor(spec.color);

  let rows: Row[] = Array.from(grouped.entries()).map(([k, g]) => ({
    key: k,
    value: measureFn(g),
    rows: g
  }));

  const sortMode = spec.sort?.mode ?? "desc";
  rows = sortRows(rows, sortMode);

  const limit = typeof spec.limit === "number" ? spec.limit : 12;
  rows = rows.slice(0, limit);

  const maxVal = Math.max(1e-9, ...rows.map((r) => r.value));

  for (const r of rows) {
    const line = doc.createElement("div");
    line.className = "ga-breakdown-row";

    const left = doc.createElement("div");
    left.className = "ga-breakdown-label";
    left.textContent = r.key;

    const right = doc.createElement("div");
    right.className = "ga-breakdown-right";

    const val = doc.createElement("div");
    val.className = "ga-breakdown-value";
    val.textContent = formatValue(semantic, measId, r.value);

    const barWrap = doc.createElement("div");
    barWrap.className = "ga-breakdown-barwrap";

    const bar = doc.createElement("div");
    bar.className = "ga-breakdown-bar";
    bar.style.width = `${Math.max(2, (r.value / maxVal) * 100)}%`;
    if (colorOverride) bar.style.background = colorOverride;

    barWrap.appendChild(bar);
    right.appendChild(val);
    right.appendChild(barWrap);

    line.appendChild(left);
    line.appendChild(right);

    const click = spec.actions?.click;
    if (click?.type === "drilldown") {
      line.style.cursor = "pointer";
      line.addEventListener("click", () => {
        const rowsFromPoint = click.filterFromPoint ? r.rows : rowsAll;
        const filteredRows = applyFilters(rowsFromPoint, click.extraFilters);
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

  wrap.appendChild(title);
  wrap.appendChild(box);
  return wrap;
}
