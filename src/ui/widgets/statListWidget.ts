import type { SemanticRegistry } from "../../config/semantic.types";
import type { WidgetDef, StatListSpec, Actions, FilterClause } from "../../config/dashboard.types";
import type { Grain } from "../../config/semantic.types";
import { getRounds, getGames, getSessions } from "../../engine/queryEngine";
import { MEASURES_BY_GRAIN } from "../../engine/measures";
import { applyFilters } from "../../engine/filters";
import { DrilldownOverlay } from "../drilldownOverlay";

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

function formatValue(doc: Document, semantic: SemanticRegistry, measureId: string, value: number): string {
  const m = semantic.measures[measureId];
  const unit = semantic.units[m.unit];

  if (!unit) return String(value);

  if (unit.format === "datetime") return formatDateTime(doc, value);
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

async function computeMeasure(
  semantic: SemanticRegistry,
  measureId: string,
  baseRows: any[] | undefined,
  grain: Grain,
  filters?: FilterClause[]
): Promise<number> {
  const m = semantic.measures[measureId];
  if (!m) return 0;

  const rowsAll =
    baseRows ?? (grain === "game" ? await getGames({}) : grain === "session" ? await getSessions({}) : await getRounds({}));
  const rows = applyFilters(rowsAll, filters, grain);
  const fn = MEASURES_BY_GRAIN[grain]?.[m.formulaId];
  if (!fn) throw new Error(`Missing measure implementation for formulaId=${m.formulaId}`);
  return fn(rows);
}

function attachClickIfAny(
  el: HTMLElement,
  actions: Actions | undefined,
  overlay: DrilldownOverlay,
  semantic: SemanticRegistry,
  title: string,
  baseRows: any[] | undefined,
  grain: Grain,
  filters?: FilterClause[],
  measureId?: string
): void {
  const clickBase = actions?.click;
  const click = clickBase && clickBase.type === "drilldown"
    ? ({
        ...clickBase,
        filterFromPoint: clickBase.filterFromPoint ?? semantic.measures[measureId ?? ""]?.drilldown?.filterFromPoint,
        extraFilters: [
          ...(semantic.measures[measureId ?? ""]?.drilldown?.extraFilters ?? []),
          ...(clickBase.extraFilters ?? [])
        ]
      } as any)
    : clickBase;
  if (!click) return;

  el.style.cursor = "pointer";
  el.addEventListener("click", async () => {
    if (click.type === "drilldown") {
      const rowsAll =
        baseRows ?? (grain === "game" ? await getGames({}) : grain === "session" ? await getSessions({}) : await getRounds({}));
      const mergedFilters = [...(filters ?? []), ...(click.extraFilters ?? [])];
      const rows = applyFilters(rowsAll, mergedFilters, grain);
      overlay.open(semantic, {
        title,
        target: click.target,
        columnsPreset: click.columnsPreset,
        rows,
        extraFilters: click.extraFilters
      });
    }
  });
}

export async function renderStatListWidget(
  semantic: SemanticRegistry,
  widget: WidgetDef,
  overlay: DrilldownOverlay,
  baseRows?: any[]
): Promise<HTMLElement> {
  const spec = widget.spec as StatListSpec;
  const doc = overlay.getDocument();
  const widgetGrain = widget.grain as Grain;

  const wrap = doc.createElement("div");
  wrap.className = "ga-widget ga-statlist";

  const title = doc.createElement("div");
  title.className = "ga-widget-title";
  title.textContent = widget.title;

  const box = doc.createElement("div");
  box.className = "ga-statlist-box";

  for (const row of spec.rows) {
    const rowGrain = (row as any).grain ? ((row as any).grain as Grain) : widgetGrain;
    // `baseRows` is pre-filtered for the widget grain. If a row overrides grain,
    // it must fetch from its own dataset instead.
    const rowBaseRows = rowGrain === widgetGrain ? baseRows : undefined;
    const line = doc.createElement("div");
    line.className = "ga-statrow";

    const left = doc.createElement("div");
    left.className = "ga-statrow-label";
    left.textContent = row.label;

    const right = doc.createElement("div");
    right.className = "ga-statrow-value";
    right.textContent = "...";

    const val = await computeMeasure(semantic, row.measure, rowBaseRows, rowGrain, row.filters);
    const primaryText = formatValue(doc, semantic, row.measure, val);

    const secondaryId = typeof (row as any).secondaryMeasure === "string" ? ((row as any).secondaryMeasure as string).trim() : "";
    if (secondaryId) {
      const secVal = await computeMeasure(semantic, secondaryId, rowBaseRows, rowGrain, row.filters);
      const secondaryText = formatValue(doc, semantic, secondaryId, secVal);
      right.textContent = `${primaryText} (${secondaryText})`;
    } else {
      right.textContent = primaryText;
    }

    attachClickIfAny(line, row.actions, overlay, semantic, `${row.label} - Drilldown`, rowBaseRows, rowGrain, row.filters, row.measure);

    line.appendChild(left);
    line.appendChild(right);
    box.appendChild(line);
  }

  wrap.appendChild(title);
  wrap.appendChild(box);
  return wrap;
}
