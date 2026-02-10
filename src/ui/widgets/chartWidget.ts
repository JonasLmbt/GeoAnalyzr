import type { SemanticRegistry } from "../../config/semantic.types";
import type { WidgetDef, ChartSpec } from "../../config/dashboard.types";
import { getRounds } from "../../engine/queryEngine";
import { ROUND_DIMENSION_EXTRACTORS } from "../../engine/dimensions";
import { groupByKey } from "../../engine/aggregate";
import { ROUND_MEASURES_BY_FORMULA_ID } from "../../engine/measures";
import { applyFilters } from "../../engine/filters";
import { DrilldownOverlay } from "../drilldownOverlay";

type BarDatum = { x: string; y: number; rows: any[] };

function sortKeysChronological(keys: string[]): string[] {
  const parseKey = (k: string) => (k === "5000" ? 5000 : parseInt(k.split("-")[0] ?? "0", 10));
  return [...keys].sort((a, b) => parseKey(a) - parseKey(b));
}

export async function renderChartWidget(
  semantic: SemanticRegistry,
  widget: WidgetDef,
  overlay: DrilldownOverlay
): Promise<HTMLElement> {
  const spec = widget.spec as ChartSpec;

  const wrap = document.createElement("div");
  wrap.className = "ga-widget ga-chart";

  const title = document.createElement("div");
  title.className = "ga-widget-title";
  title.textContent = widget.title;

  const box = document.createElement("div");
  box.className = "ga-chart-box";

  const rows = await getRounds({});
  const dimId = spec.x.dimension;
  const measId = spec.y.measure;

  const dimDef = semantic.dimensions[dimId];
  const measDef = semantic.measures[measId];
  if (!dimDef || !measDef) throw new Error(`Unknown dimension/measure in widget ${widget.widgetId}`);

  const keyFn = ROUND_DIMENSION_EXTRACTORS[dimId];
  if (!keyFn) throw new Error(`No extractor implemented for dimension '${dimId}'`);

  const grouped = groupByKey(rows, keyFn);
  const measureFn = ROUND_MEASURES_BY_FORMULA_ID[measDef.formulaId];
  if (!measureFn) throw new Error(`Missing formula implementation for ${measDef.formulaId}`);

  const keys = Array.from(grouped.keys());
  const sortedKeys = spec.sort?.mode === "chronological" ? sortKeysChronological(keys) : keys;

  const data: BarDatum[] = sortedKeys.map((k) => {
    const g = grouped.get(k) ?? [];
    return { x: k, y: measureFn(g), rows: g };
  });

  const W = 900;
  const H = 260;
  const PAD_L = 40;
  const PAD_B = 30;
  const PAD_T = 10;
  const PAD_R = 10;

  const maxY = Math.max(1, ...data.map((d) => d.y));
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", String(H));

  const axis = document.createElementNS(svg.namespaceURI, "line");
  axis.setAttribute("x1", String(PAD_L));
  axis.setAttribute("y1", String(PAD_T + innerH));
  axis.setAttribute("x2", String(PAD_L + innerW));
  axis.setAttribute("y2", String(PAD_T + innerH));
  axis.setAttribute("stroke", "currentColor");
  axis.setAttribute("opacity", "0.35");
  svg.appendChild(axis);

  const barW = innerW / Math.max(1, data.length);

  data.forEach((d, i) => {
    const x = PAD_L + i * barW;
    const h = (d.y / maxY) * innerH;
    const y = PAD_T + innerH - h;

    const rect = document.createElementNS(svg.namespaceURI, "rect");
    rect.setAttribute("x", String(x + 1));
    rect.setAttribute("y", String(y));
    rect.setAttribute("width", String(Math.max(1, barW - 2)));
    rect.setAttribute("height", String(h));
    rect.setAttribute("rx", "2");
    rect.setAttribute("fill", "currentColor");
    rect.setAttribute("opacity", "0.35");

    const t = document.createElementNS(svg.namespaceURI, "title");
    t.textContent = `${d.x}: ${d.y}`;
    rect.appendChild(t);

    const click = spec.actions?.click;
    if (click?.type === "drilldown") {
      rect.setAttribute("style", "cursor: pointer;");
      rect.addEventListener("click", () => {
        const rowsFromPoint = click.filterFromPoint ? d.rows : rows;
        const filteredRows = applyFilters(rowsFromPoint, click.extraFilters);
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
      const tx = document.createElementNS(svg.namespaceURI, "text");
      tx.setAttribute("x", String(x + barW / 2));
      tx.setAttribute("y", String(PAD_T + innerH + 18));
      tx.setAttribute("text-anchor", "middle");
      tx.setAttribute("font-size", "10");
      tx.setAttribute("opacity", "0.7");
      tx.textContent = d.x === "5000" ? "5k" : d.x.split("-")[0];
      svg.appendChild(tx);
    }
  });

  box.appendChild(svg);
  wrap.appendChild(title);
  wrap.appendChild(box);
  return wrap;
}
