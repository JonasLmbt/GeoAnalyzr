import type { SemanticRegistry } from "../../config/semantic.types";
import type { WidgetDef, StatListSpec, Actions, FilterClause } from "../../config/dashboard.types";
import { getRounds } from "../../engine/queryEngine";
import { ROUND_MEASURES_BY_FORMULA_ID } from "../../engine/measures";
import { applyFilters } from "../../engine/filters";
import { DrilldownOverlay } from "../drilldownOverlay";

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

async function computeMeasure(
  semantic: SemanticRegistry,
  measureId: string,
  filters?: FilterClause[]
): Promise<number> {
  const m = semantic.measures[measureId];
  if (!m) return 0;

  const rows = applyFilters(await getRounds({}), filters);
  const fn = ROUND_MEASURES_BY_FORMULA_ID[m.formulaId];
  if (!fn) throw new Error(`Missing measure implementation for formulaId=${m.formulaId}`);
  return fn(rows);
}

function attachClickIfAny(
  el: HTMLElement,
  actions: Actions | undefined,
  overlay: DrilldownOverlay,
  semantic: SemanticRegistry,
  title: string
): void {
  const click = actions?.click;
  if (!click) return;

  el.style.cursor = "pointer";
  el.addEventListener("click", async () => {
    if (click.type === "drilldown") {
      const rows = applyFilters(await getRounds({}), click.extraFilters);
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
  overlay: DrilldownOverlay
): Promise<HTMLElement> {
  const spec = widget.spec as StatListSpec;
  const doc = overlay.getDocument();

  const wrap = doc.createElement("div");
  wrap.className = "ga-widget ga-statlist";

  const title = doc.createElement("div");
  title.className = "ga-widget-title";
  title.textContent = widget.title;

  const box = doc.createElement("div");
  box.className = "ga-statlist-box";

  for (const row of spec.rows) {
    const line = doc.createElement("div");
    line.className = "ga-statrow";

    const left = doc.createElement("div");
    left.className = "ga-statrow-label";
    left.textContent = row.label;

    const right = doc.createElement("div");
    right.className = "ga-statrow-value";
    right.textContent = "...";

    const val = await computeMeasure(semantic, row.measure, row.filters);
    right.textContent = formatValue(semantic, row.measure, val);

    attachClickIfAny(line, row.actions, overlay, semantic, `${row.label} - Drilldown`);

    line.appendChild(left);
    line.appendChild(right);
    box.appendChild(line);
  }

  wrap.appendChild(title);
  wrap.appendChild(box);
  return wrap;
}
