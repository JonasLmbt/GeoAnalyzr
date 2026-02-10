// src/engine/validate.ts

import type { SemanticRegistry } from "../config/semantic.types";
import type { DashboardDoc, WidgetDef } from "../config/dashboard.types";

export class ValidationError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function assert(condition: unknown, code: string, msg: string): asserts condition {
  if (!condition) throw new ValidationError(code, msg);
}

export function validateDashboardAgainstSemantic(semantic: SemanticRegistry, dash: DashboardDoc): void {
  for (const section of dash.dashboard.sections) {
    for (const placedCard of section.layout.cards) {
      for (const widget of placedCard.card.children) {
        validateWidget(semantic, widget);
      }
    }
  }
}

function validateWidget(semantic: SemanticRegistry, widget: WidgetDef): void {
  // Common: grain must be valid
  assert(semantic.datasets[widget.grain] !== undefined, "E_UNKNOWN_GRAIN", `Unknown grain: ${widget.grain}`);

  if (widget.type === "chart") {
    // Narrow the spec safely
    const spec: any = widget.spec;
    const xDimId = spec.x?.dimension;
    const yMeasId = spec.y?.measure;
    assert(typeof xDimId === "string", "E_BAD_SPEC", `Chart widget ${widget.widgetId} missing x.dimension`);
    assert(typeof yMeasId === "string", "E_BAD_SPEC", `Chart widget ${widget.widgetId} missing y.measure`);

    const xDim = semantic.dimensions[xDimId];
    const yMeas = semantic.measures[yMeasId];

    assert(!!xDim, "E_UNKNOWN_DIMENSION", `Unknown dimension '${xDimId}' in widget ${widget.widgetId}`);
    assert(!!yMeas, "E_UNKNOWN_MEASURE", `Unknown measure '${yMeasId}' in widget ${widget.widgetId}`);

    assert(xDim.grain === widget.grain, "E_GRAIN_MISMATCH", `x '${xDimId}' grain=${xDim.grain} but widget grain=${widget.grain}`);
    assert(yMeas.grain === widget.grain, "E_GRAIN_MISMATCH", `y '${yMeasId}' grain=${yMeas.grain} but widget grain=${widget.grain}`);

    // chart type constraints
    assert(xDim.allowedCharts.includes(spec.type), "E_NOT_ALLOWED", `Dimension '${xDimId}' not allowed for ${spec.type}`);
    assert(yMeas.allowedCharts.includes(spec.type), "E_NOT_ALLOWED", `Measure '${yMeasId}' not allowed for ${spec.type}`);

    if (spec.type === "line") {
      assert(xDim.ordered === true, "E_CHART_X_NOT_ORDERED", `Line chart requires ordered x dimension '${xDimId}'`);
    }

    // selectorRequired dimensions (e.g. true_country)
    if (xDim.cardinality?.selectorRequired) {
      assert(!!spec.x.selector, "E_SELECTOR_REQUIRED", `Dimension '${xDimId}' requires selector`);
    }

    // series validation
    if (spec.series) {
      const sDimId = spec.series.dimension;
      const sDim = semantic.dimensions[sDimId];
      assert(!!sDim, "E_UNKNOWN_DIMENSION", `Unknown series dimension '${sDimId}'`);
      assert(sDim.grain === widget.grain, "E_GRAIN_MISMATCH", `series '${sDimId}' grain=${sDim.grain} but widget grain=${widget.grain}`);
      assert(!!spec.series.selector, "E_BAD_SPEC", `series.selector missing for '${sDimId}'`);
      const maxSeries = sDim.cardinality?.maxSeries ?? 50;
      const requested = spec.series.selector.mode === "selected"
        ? (spec.series.selector.values?.length ?? 0)
        : (spec.series.selector.mode === "top_n" ? (spec.series.selector.n ?? 0) : (spec.series.selector.maxSeries ?? maxSeries));
      assert(requested <= maxSeries, "E_TOO_MANY_SERIES", `Too many series for '${sDimId}' requested=${requested} max=${maxSeries}`);
    }

    validateClickAction(semantic, widget.widgetId, spec.actions?.click);
  }

  if (widget.type === "stat_list") {
    const spec: any = widget.spec;
    assert(Array.isArray(spec.rows) && spec.rows.length > 0, "E_BAD_SPEC", `stat_list ${widget.widgetId} has no rows`);
    for (const row of spec.rows) {
      const meas = semantic.measures[row.measure];
      assert(!!meas, "E_UNKNOWN_MEASURE", `Unknown measure '${row.measure}' in stat_list ${widget.widgetId}`);
      assert(meas.grain === widget.grain, "E_GRAIN_MISMATCH", `Measure '${row.measure}' grain=${meas.grain} but widget grain=${widget.grain}`);
      validateClickAction(semantic, widget.widgetId, row.actions?.click);
    }
  }

  if (widget.type === "stat_value") {
    const spec: any = widget.spec;
    const meas = semantic.measures[spec.measure];
    assert(!!meas, "E_UNKNOWN_MEASURE", `Unknown measure '${spec.measure}' in stat_value ${widget.widgetId}`);
    assert(meas.grain === widget.grain, "E_GRAIN_MISMATCH", `Measure '${spec.measure}' grain=${meas.grain} but widget grain=${widget.grain}`);
    validateClickAction(semantic, widget.widgetId, spec.actions?.click);
  }

  if (widget.type === "breakdown") {
    const spec: any = widget.spec;
    const dim = semantic.dimensions[spec.dimension];
    const meas = semantic.measures[spec.measure];
    assert(!!dim, "E_UNKNOWN_DIMENSION", `Unknown dimension '${spec.dimension}' in breakdown ${widget.widgetId}`);
    assert(!!meas, "E_UNKNOWN_MEASURE", `Unknown measure '${spec.measure}' in breakdown ${widget.widgetId}`);
    assert(dim.grain === widget.grain, "E_GRAIN_MISMATCH", `Breakdown dim grain mismatch in ${widget.widgetId}`);
    assert(meas.grain === widget.grain, "E_GRAIN_MISMATCH", `Breakdown measure grain mismatch in ${widget.widgetId}`);
    if (dim.cardinality?.selectorRequired) {
      assert(
        typeof spec.limit === "number" && spec.limit > 0,
        "E_SELECTOR_REQUIRED",
        `Breakdown '${spec.dimension}' requires a positive limit`
      );
    }

    validateClickAction(semantic, widget.widgetId, spec.actions?.click);
  }

  // record_list: we keep structural validation only here; actual logic later.
}

function validateClickAction(semantic: SemanticRegistry, widgetId: string, click: any): void {
  if (!click || click.type !== "drilldown") return;
  const targetPreset = semantic.drilldownPresets[click.target];
  assert(!!targetPreset, "E_BAD_SPEC", `Unknown drilldown target '${click.target}' in widget ${widgetId}`);
  const columns = targetPreset?.columnsPresets?.[click.columnsPreset];
  assert(!!columns && columns.length > 0, "E_BAD_SPEC", `Unknown columnsPreset '${click.columnsPreset}' in widget ${widgetId}`);
}
