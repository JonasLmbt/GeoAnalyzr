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
  const parseKey = (k: string): number | undefined => {
    const first = k.split("-")[0] ?? k;
    const parsed = Number(first);
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

function sortData(data: BarDatum[], mode: "chronological" | "asc" | "desc" | undefined): BarDatum[] {
  if (mode === "chronological") {
    const keys = sortKeysChronological(data.map((d) => d.x));
    const rank = new Map(keys.map((k, i) => [k, i]));
    return [...data].sort((a, b) => (rank.get(a.x) ?? 0) - (rank.get(b.x) ?? 0));
  }
  if (mode === "asc") return [...data].sort((a, b) => a.y - b.y);
  if (mode === "desc") return [...data].sort((a, b) => b.y - a.y);
  return data;
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

function formatMeasureValue(semantic: SemanticRegistry, measureId: string, value: number): string {
  const measure = semantic.measures[measureId];
  const unit = measure ? semantic.units[measure.unit] : undefined;
  if (!unit) return `${value}`;
  if (unit.format === "percent") return `${(value * 100).toFixed(unit.decimals ?? 1)}%`;
  if (unit.format === "int") return `${Math.round(value)}`;
  return value.toFixed(unit.decimals ?? 1);
}

function niceUpperBound(maxValue: number): number {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return 1;
  const exp = Math.floor(Math.log10(maxValue));
  const base = 10 ** exp;
  const n = maxValue / base;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * base;
}

export async function renderChartWidget(
  semantic: SemanticRegistry,
  widget: WidgetDef,
  overlay: DrilldownOverlay
): Promise<HTMLElement> {
  const spec = widget.spec as ChartSpec;
  const doc = overlay.getDocument();

  const wrap = doc.createElement("div");
  wrap.className = "ga-widget ga-chart";

  const title = doc.createElement("div");
  title.className = "ga-widget-title";
  title.textContent = widget.title;

  const controls = doc.createElement("div");
  controls.style.display = "flex";
  controls.style.gap = "8px";
  controls.style.alignItems = "center";
  controls.style.marginBottom = "8px";

  const box = doc.createElement("div");
  box.className = "ga-chart-box";

  const chartHost = doc.createElement("div");
  box.appendChild(chartHost);

  const rows = await getRounds({});
  const dimId = spec.x.dimension;

  const dimDef = semantic.dimensions[dimId];
  if (!dimDef) throw new Error(`Unknown dimension '${dimId}' in widget ${widget.widgetId}`);

  const keyFn = ROUND_DIMENSION_EXTRACTORS[dimId];
  if (!keyFn) throw new Error(`No extractor implemented for dimension '${dimId}'`);

  const measureIds = getMeasureIds(spec);
  if (measureIds.length === 0) throw new Error(`Widget ${widget.widgetId} has no y.measure or y.measures`);
  const measureFnById = new Map<string, (rows: any[]) => number>();
  for (const measureId of measureIds) {
    const measDef = semantic.measures[measureId];
    if (!measDef) throw new Error(`Unknown measure '${measureId}' in widget ${widget.widgetId}`);
    const measureFn = ROUND_MEASURES_BY_FORMULA_ID[measDef.formulaId];
    if (!measureFn) throw new Error(`Missing formula implementation for ${measDef.formulaId}`);
    measureFnById.set(measureId, measureFn);
  }

  const grouped = groupByKey(rows, keyFn);
  const keys = Array.from(grouped.keys());

  const buildDataForMeasure = (measureId: string): BarDatum[] => {
    const measureFn = measureFnById.get(measureId);
    if (!measureFn) return [];
    const baseData: BarDatum[] = keys.map((k) => {
      const g = grouped.get(k) ?? [];
      return { x: k, y: measureFn(g), rows: g };
    });
    const sortedData = sortData(baseData, spec.sort?.mode);
    return typeof spec.limit === "number" && Number.isFinite(spec.limit) && spec.limit > 0
      ? sortedData.slice(0, Math.floor(spec.limit))
      : sortedData;
  };

  let activeMeasure = measureIds.includes(spec.y.activeMeasure || "")
    ? (spec.y.activeMeasure as string)
    : measureIds[0];

  const render = (): void => {
    chartHost.innerHTML = "";
    const measureDef = semantic.measures[activeMeasure];
    const data = buildDataForMeasure(activeMeasure);
    if (!measureDef || data.length === 0) {
      const empty = doc.createElement("div");
      empty.style.fontSize = "12px";
      empty.style.opacity = "0.75";
      empty.textContent = "No chart data available for current selection.";
      chartHost.appendChild(empty);
      return;
    }

    const W = 920;
    const H = 320;
    const PAD_L = 72;
    const PAD_B = 58;
    const PAD_T = 16;
    const PAD_R = 16;
    const innerW = W - PAD_L - PAD_R;
    const innerH = H - PAD_T - PAD_B;

    const dataMax = Math.max(0, ...data.map((d) => d.y));
    const maxY = dataMax > 0 ? niceUpperBound(dataMax * 1.05) : 1;

    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", String(H));

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
      const yVal = (maxY * i) / tickCount;
      const yPos = PAD_T + innerH - (yVal / maxY) * innerH;

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
      yTick.textContent = formatMeasureValue(semantic, activeMeasure, yVal);
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

    const barW = innerW / Math.max(1, data.length);
    data.forEach((d, i) => {
      const x = PAD_L + i * barW;
      const h = (d.y / maxY) * innerH;
      const y = PAD_T + innerH - h;

      const rect = doc.createElementNS(svg.namespaceURI, "rect");
      rect.setAttribute("x", String(x + 1));
      rect.setAttribute("y", String(y));
      rect.setAttribute("width", String(Math.max(1, barW - 2)));
      rect.setAttribute("height", String(Math.max(0, h)));
      rect.setAttribute("rx", "2");
      rect.setAttribute("fill", "var(--ga-graph-color)");
      rect.setAttribute("opacity", "0.72");

      const tooltip = doc.createElementNS(svg.namespaceURI, "title");
      tooltip.textContent = `${d.x}: ${formatMeasureValue(semantic, activeMeasure, d.y)}`;
      rect.appendChild(tooltip);

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
        const tx = doc.createElementNS(svg.namespaceURI, "text");
        tx.setAttribute("x", String(x + barW / 2));
        tx.setAttribute("y", String(PAD_T + innerH + 16));
        tx.setAttribute("text-anchor", "middle");
        tx.setAttribute("font-size", "10");
        tx.setAttribute("fill", "var(--ga-axis-text)");
        tx.setAttribute("opacity", "0.95");
        tx.textContent = d.x;
        svg.appendChild(tx);
      }
    });

    chartHost.appendChild(svg);
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

    controls.appendChild(label);
    controls.appendChild(select);
  }

  render();

  wrap.appendChild(title);
  if (controls.childElementCount > 0) wrap.appendChild(controls);
  wrap.appendChild(box);
  return wrap;
}
