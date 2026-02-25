import type { SemanticRegistry } from "../../config/semantic.types";
import type { WidgetDef, StatValueSpec, Actions } from "../../config/dashboard.types";
import type { Grain } from "../../config/semantic.types";
import { getRounds, getGames, getSessions } from "../../engine/queryEngine";
import { MEASURES_BY_GRAIN } from "../../engine/measures";
import { DrilldownOverlay } from "../drilldownOverlay";

function formatValue(doc: Document, semantic: SemanticRegistry, measureId: string, value: number): string {
  const m = semantic.measures[measureId];
  const unit = m ? semantic.units[m.unit] : undefined;
  if (!m || !unit) return String(value);

  if (unit.format === "datetime") {
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return String(value);
    return d.toLocaleString();
  }
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

async function computeMeasure(semantic: SemanticRegistry, measureId: string, baseRows: any[] | undefined, grain: Grain): Promise<number> {
  const m = semantic.measures[measureId];
  if (!m) return 0;

  const rowsAll =
    baseRows ?? (grain === "game" ? await getGames({}) : grain === "session" ? await getSessions({}) : await getRounds({}));
  const fn = MEASURES_BY_GRAIN[grain]?.[m.formulaId];
  if (!fn) throw new Error(`Missing measure implementation for formulaId=${m.formulaId}`);
  return fn(rowsAll);
}

function attachClickIfAny(
  el: HTMLElement,
  actions: Actions | undefined,
  overlay: DrilldownOverlay,
  semantic: SemanticRegistry,
  title: string,
  baseRows: any[] | undefined,
  grain: Grain,
  measureId: string
): void {
  const click = actions?.click;
  if (!click) return;
  if (click.type !== "drilldown") return;

  el.style.cursor = "pointer";
  el.addEventListener("click", async () => {
    const rowsAll =
      baseRows ?? (grain === "game" ? await getGames({}) : grain === "session" ? await getSessions({}) : await getRounds({}));
    overlay.open(semantic, {
      title,
      target: click.target,
      columnsPreset: click.columnsPreset,
      rows: rowsAll,
      extraFilters: click.extraFilters,
      initialSort: (click as any).initialSort
    });
  });
}

export async function renderStatValueWidget(
  semantic: SemanticRegistry,
  widget: WidgetDef,
  overlay: DrilldownOverlay,
  baseRows?: any[]
): Promise<HTMLElement> {
  const spec = widget.spec as StatValueSpec;
  const doc = overlay.getDocument();
  const grain = widget.grain as Grain;

  const wrap = doc.createElement("div");
  wrap.className = "ga-widget ga-statvalue";

  const title = doc.createElement("div");
  title.className = "ga-widget-title";
  title.textContent = widget.title;

  const box = doc.createElement("div");
  box.className = "ga-statlist-box";

  const line = doc.createElement("div");
  line.className = "ga-statrow";

  const left = doc.createElement("div");
  left.className = "ga-statrow-label";
  left.textContent = spec.label;

  const right = doc.createElement("div");
  right.className = "ga-statrow-value";
  right.textContent = "...";

  line.appendChild(left);
  line.appendChild(right);
  box.appendChild(line);

  wrap.appendChild(title);
  wrap.appendChild(box);

  const measureId = typeof spec.measure === "string" ? spec.measure.trim() : "";
  const val = measureId ? await computeMeasure(semantic, measureId, baseRows, grain) : 0;
  right.textContent = measureId ? formatValue(doc, semantic, measureId, val) : "—";

  if (measureId) {
    attachClickIfAny(line, spec.actions, overlay, semantic, `${widget.title} - ${spec.label}`, baseRows, grain, measureId);
  }

  return wrap;
}

