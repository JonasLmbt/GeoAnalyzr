import type { SemanticRegistry } from "../../config/semantic.types";
import type { WidgetDef, StatListSpec, Actions, FilterClause } from "../../config/dashboard.types";
import type { Grain } from "../../config/semantic.types";
import { getRounds, getGames, getSessions } from "../../engine/queryEngine";
import { MEASURES_BY_GRAIN } from "../../engine/measures";
import { applyFilters } from "../../engine/filters";
import { DrilldownOverlay } from "../drilldownOverlay";

function formatValue(semantic: SemanticRegistry, measureId: string, value: number): string {
  const m = semantic.measures[measureId];
  const unit = semantic.units[m.unit];

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
  if (unit.format === "int") return String(Math.round(value));
  const decimals = unit.decimals ?? 1;
  return value.toFixed(decimals);
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
  grain: Grain
): void {
  const click = actions?.click;
  if (!click) return;

  el.style.cursor = "pointer";
  el.addEventListener("click", async () => {
    if (click.type === "drilldown") {
      const rowsAll =
        baseRows ?? (grain === "game" ? await getGames({}) : grain === "session" ? await getSessions({}) : await getRounds({}));
      const rows = applyFilters(rowsAll, click.extraFilters, grain);
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
    right.textContent = formatValue(semantic, row.measure, val);

    attachClickIfAny(line, row.actions, overlay, semantic, `${row.label} - Drilldown`, rowBaseRows, rowGrain);

    line.appendChild(left);
    line.appendChild(right);
    box.appendChild(line);
  }

  wrap.appendChild(title);
  wrap.appendChild(box);
  return wrap;
}
