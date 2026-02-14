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
  if (dash.dashboard.globalFilters) validateGlobalFiltersSpec(semantic, dash);
  for (const section of dash.dashboard.sections) {
    if ((section as any).localFilters) validateLocalFiltersSpec(semantic, section as any);
    for (const placedCard of section.layout.cards) {
      for (const widget of placedCard.card.children) {
        validateWidget(semantic, widget);
      }
    }
  }
}

function validateGlobalFiltersSpec(semantic: SemanticRegistry, dash: DashboardDoc): void {
  const gf: any = (dash.dashboard as any).globalFilters;
  assert(!!gf && typeof gf === "object", "E_BAD_SPEC", "dashboard.globalFilters must be an object");
  assert(typeof gf.enabled === "boolean", "E_BAD_SPEC", "dashboard.globalFilters.enabled must be boolean");
  assert(Array.isArray(gf.controls), "E_BAD_SPEC", "dashboard.globalFilters.controls must be an array");

  const ids = new Set<string>();
  for (const c of gf.controls as any[]) {
    assert(!!c && typeof c === "object", "E_BAD_SPEC", "Global filter control must be an object");
    assert(typeof c.id === "string" && c.id.trim().length > 0, "E_BAD_SPEC", "Global filter control id must be a string");
    assert(!ids.has(c.id), "E_BAD_SPEC", `Duplicate global filter control id '${c.id}'`);
    ids.add(c.id);
    assert(typeof c.type === "string", "E_BAD_SPEC", `Global filter control '${c.id}' missing type`);
    assert(typeof c.label === "string" && c.label.trim().length > 0, "E_BAD_SPEC", `Global filter control '${c.id}' missing label`);
    assert(Array.isArray(c.appliesTo) && c.appliesTo.length > 0, "E_BAD_SPEC", `Global filter control '${c.id}' appliesTo must be a non-empty array`);

    if (c.type === "date_range") {
      assert(!!c.default && typeof c.default === "object", "E_BAD_SPEC", `date_range '${c.id}' default must be an object`);
      const fromTs = (c.default as any).fromTs;
      const toTs = (c.default as any).toTs;
      assert(fromTs === null || typeof fromTs === "number", "E_BAD_SPEC", `date_range '${c.id}' default.fromTs must be number|null`);
      assert(toTs === null || typeof toTs === "number", "E_BAD_SPEC", `date_range '${c.id}' default.toTs must be number|null`);
      continue;
    }

    if (c.type === "select") {
      assert(typeof c.dimension === "string" && c.dimension.trim().length > 0, "E_BAD_SPEC", `select '${c.id}' missing dimension`);
      assert(typeof c.options === "string", "E_BAD_SPEC", `select '${c.id}' missing options`);
      assert(
        c.options === "auto_distinct" || c.options === "auto_teammates",
        "E_BAD_SPEC",
        `select '${c.id}' options must be 'auto_distinct' | 'auto_teammates'`
      );
      assert(typeof c.default === "string" && c.default.trim().length > 0, "E_BAD_SPEC", `select '${c.id}' default must be a string`);

      const dimId = String(c.dimension);
      const dim = semantic.dimensions[dimId];
      assert(!!dim, "E_UNKNOWN_DIMENSION", `Unknown dimension '${dimId}' in global filter '${c.id}'`);
      const dimGrains = Array.isArray(dim.grain) ? dim.grain : [dim.grain];
      for (const g of c.appliesTo as any[]) {
        assert(dimGrains.includes(g), "E_GRAIN_MISMATCH", `Global filter '${c.id}' appliesTo includes unsupported grain '${g}' for dimension '${dimId}'`);
      }
      continue;
    }

    throw new ValidationError("E_BAD_SPEC", `Unknown global filter control type '${c.type}'`);
  }
}

function validateLocalFiltersSpec(semantic: SemanticRegistry, section: any): void {
  const lf: any = section.localFilters;
  assert(!!lf && typeof lf === "object", "E_BAD_SPEC", `section '${section.id}' localFilters must be an object`);
  assert(Array.isArray(lf.controls) && lf.controls.length > 0, "E_BAD_SPEC", `section '${section.id}' localFilters.controls must be a non-empty array`);

  const ids = new Set<string>();
  for (const c of lf.controls as any[]) {
    assert(!!c && typeof c === "object", "E_BAD_SPEC", `Local filter control in section '${section.id}' must be an object`);
    assert(typeof c.id === "string" && c.id.trim().length > 0, "E_BAD_SPEC", `Local filter control id must be a string`);
    assert(!ids.has(c.id), "E_BAD_SPEC", `Duplicate local filter control id '${c.id}' in section '${section.id}'`);
    ids.add(c.id);

    assert(c.type === "select", "E_BAD_SPEC", `Local filter '${c.id}' in section '${section.id}' must have type 'select'`);
    assert(typeof c.label === "string" && c.label.trim().length > 0, "E_BAD_SPEC", `Local filter '${c.id}' missing label`);
    assert(typeof c.dimension === "string" && c.dimension.trim().length > 0, "E_BAD_SPEC", `Local filter '${c.id}' missing dimension`);
    assert(typeof c.options === "string", "E_BAD_SPEC", `Local filter '${c.id}' missing options`);
    assert(
      c.options === "auto_distinct" || c.options === "auto_teammates",
      "E_BAD_SPEC",
      `Local filter '${c.id}' options must be 'auto_distinct' | 'auto_teammates'`
    );
    assert(typeof c.default === "string" && c.default.trim().length > 0, "E_BAD_SPEC", `Local filter '${c.id}' default must be a string`);
    assert(Array.isArray(c.appliesTo) && c.appliesTo.length > 0, "E_BAD_SPEC", `Local filter '${c.id}' appliesTo must be a non-empty array`);

    const dimId = String(c.dimension);
    const dim = semantic.dimensions[dimId];
    assert(!!dim, "E_UNKNOWN_DIMENSION", `Unknown dimension '${dimId}' in local filter '${c.id}' (section '${section.id}')`);
    const dimGrains = Array.isArray(dim.grain) ? dim.grain : [dim.grain];
    for (const g of c.appliesTo as any[]) {
      assert(dimGrains.includes(g), "E_GRAIN_MISMATCH", `Local filter '${c.id}' appliesTo includes unsupported grain '${g}' for dimension '${dimId}'`);
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
    assert(typeof xDimId === "string", "E_BAD_SPEC", `Chart widget ${widget.widgetId} missing x.dimension`);
    const yMeasureIds = getChartMeasureIds(spec);
    assert(yMeasureIds.length > 0, "E_BAD_SPEC", `Chart widget ${widget.widgetId} missing y.measure or y.measures`);

    const xDim = semantic.dimensions[xDimId];
    assert(!!xDim, "E_UNKNOWN_DIMENSION", `Unknown dimension '${xDimId}' in widget ${widget.widgetId}`);
    const xGrains = Array.isArray(xDim.grain) ? xDim.grain : [xDim.grain];
    assert(xGrains.includes(widget.grain), "E_GRAIN_MISMATCH", `x '${xDimId}' grain mismatch for widget grain=${widget.grain}`);

    // chart type constraints
    assert(xDim.allowedCharts.includes(spec.type), "E_NOT_ALLOWED", `Dimension '${xDimId}' not allowed for ${spec.type}`);
    if (spec.sort?.mode) {
      assert(xDim.sortModes.includes(spec.sort.mode), "E_NOT_ALLOWED", `Sort mode '${spec.sort.mode}' not allowed for dimension '${xDimId}'`);
    }
    if (Array.isArray(spec.sorts)) {
      for (const s of spec.sorts) {
        const mode = s?.mode;
        if (!mode) continue;
        assert(xDim.sortModes.includes(mode), "E_NOT_ALLOWED", `Sort mode '${mode}' not allowed for dimension '${xDimId}'`);
      }
    }
    if (spec.activeSort?.mode) {
      assert(xDim.sortModes.includes(spec.activeSort.mode), "E_NOT_ALLOWED", `Sort mode '${spec.activeSort.mode}' not allowed for dimension '${xDimId}'`);
    }
    for (const yMeasId of yMeasureIds) {
      const yMeas = semantic.measures[yMeasId];
      assert(!!yMeas, "E_UNKNOWN_MEASURE", `Unknown measure '${yMeasId}' in widget ${widget.widgetId}`);
      // Allow mixed-grain y-measures as long as the x-dimension supports that grain.
      assert(
        xGrains.includes(yMeas.grain),
        "E_GRAIN_MISMATCH",
        `y '${yMeasId}' grain=${yMeas.grain} not supported by x '${xDimId}' grains=${xGrains.join(",")}`
      );
      assert(yMeas.allowedCharts.includes(spec.type), "E_NOT_ALLOWED", `Measure '${yMeasId}' not allowed for ${spec.type}`);
    }
    const activeMeasure = typeof spec.y?.activeMeasure === "string" ? spec.y.activeMeasure : undefined;
    if (activeMeasure) {
      assert(yMeasureIds.includes(activeMeasure), "E_BAD_SPEC", `activeMeasure '${activeMeasure}' is not listed in y.measures`);
    }

    if (spec.type === "line") {
      assert(xDim.ordered === true, "E_CHART_X_NOT_ORDERED", `Line chart requires ordered x dimension '${xDimId}'`);
    }

    // selectorRequired dimensions (e.g. true_country)
    if (xDim.cardinality?.selectorRequired) {
      const hasTopN = typeof spec.limit === "number" && spec.limit > 0;
      const selectorMode = spec.x?.selector?.mode;
      const hasSelector = selectorMode === "top_n" || selectorMode === "selected";
      assert(
        hasTopN || hasSelector,
        "E_SELECTOR_REQUIRED",
        `Dimension '${xDimId}' requires selector; set chart.limit or x.selector`
      );
    }


    // series validation
    if (spec.series) {
      const sDimId = spec.series.dimension;
      const sDim = semantic.dimensions[sDimId];
      assert(!!sDim, "E_UNKNOWN_DIMENSION", `Unknown series dimension '${sDimId}'`);
      const sGrains = Array.isArray(sDim.grain) ? sDim.grain : [sDim.grain];
      assert(sGrains.includes(widget.grain), "E_GRAIN_MISMATCH", `series '${sDimId}' grain mismatch for widget grain=${widget.grain}`);
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
      const rowGrain = (row as any).grain ?? widget.grain;
      assert(
        meas.grain === rowGrain,
        "E_GRAIN_MISMATCH",
        `Measure '${row.measure}' grain=${meas.grain} but stat row grain=${rowGrain} (widget grain=${widget.grain})`
      );
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
    const measIds = getBreakdownMeasureIds(spec);
    assert(!!dim, "E_UNKNOWN_DIMENSION", `Unknown dimension '${spec.dimension}' in breakdown ${widget.widgetId}`);
    const dGrains = Array.isArray(dim.grain) ? dim.grain : [dim.grain];
    assert(dGrains.includes(widget.grain), "E_GRAIN_MISMATCH", `Breakdown dim grain mismatch in ${widget.widgetId}`);
    assert(measIds.length > 0, "E_BAD_SPEC", `Breakdown ${widget.widgetId} missing measure or measures[]`);
    for (const measId of measIds) {
      const meas = semantic.measures[measId];
      assert(!!meas, "E_UNKNOWN_MEASURE", `Unknown measure '${measId}' in breakdown ${widget.widgetId}`);
      assert(meas.grain === widget.grain, "E_GRAIN_MISMATCH", `Breakdown measure '${measId}' grain mismatch in ${widget.widgetId}`);
    }
    if (typeof spec.activeMeasure === "string" && spec.activeMeasure.trim()) {
      assert(measIds.includes(spec.activeMeasure.trim()), "E_BAD_SPEC", `breakdown ${widget.widgetId} activeMeasure must be in measures[]`);
    }
    if (spec.sort?.mode) {
      assert(dim.sortModes.includes(spec.sort.mode), "E_NOT_ALLOWED", `Sort mode '${spec.sort.mode}' not allowed for dimension '${spec.dimension}'`);
    }
    if (Array.isArray(spec.sorts)) {
      for (const s of spec.sorts) {
        const mode = s?.mode;
        if (!mode) continue;
        assert(dim.sortModes.includes(mode), "E_NOT_ALLOWED", `Sort mode '${mode}' not allowed for dimension '${spec.dimension}'`);
      }
    }
    if (spec.activeSort?.mode) {
      assert(dim.sortModes.includes(spec.activeSort.mode), "E_NOT_ALLOWED", `Sort mode '${spec.activeSort.mode}' not allowed for dimension '${spec.dimension}'`);
    }
    if (dim.cardinality?.selectorRequired) {
      assert(
        typeof spec.limit === "number" && spec.limit > 0,
        "E_SELECTOR_REQUIRED",
        `Breakdown '${spec.dimension}' requires a positive limit`
      );
    }

    validateClickAction(semantic, widget.widgetId, spec.actions?.click);
  }

  if (widget.type === "record_list") {
    const spec: any = widget.spec;
    assert(Array.isArray(spec.records) && spec.records.length > 0, "E_BAD_SPEC", `record_list ${widget.widgetId} has no records`);
    for (const r of spec.records) {
      const kind = r?.kind === "same_value_streak" ? "same_value_streak" : r?.kind === "streak" ? "streak" : "group_extreme";
      if (kind === "streak") {
        assert(Array.isArray(r.streakFilters) && r.streakFilters.length > 0, "E_BAD_SPEC", `record ${r.id} missing streakFilters`);
        validateClickAction(semantic, widget.widgetId, r.actions?.click);
        continue;
      }
      if (kind === "same_value_streak") {
        assert(typeof r.dimension === "string" && r.dimension.trim().length > 0, "E_BAD_SPEC", `record ${r.id} missing dimension`);
        const d = semantic.dimensions[r.dimension];
        assert(!!d, "E_UNKNOWN_DIMENSION", `Unknown record dimension '${r.dimension}' in ${widget.widgetId}`);
        const grains = Array.isArray(d.grain) ? d.grain : [d.grain];
        assert(grains.includes(widget.grain), "E_GRAIN_MISMATCH", `Record dimension '${r.dimension}' grain mismatch in ${widget.widgetId}`);
        validateClickAction(semantic, widget.widgetId, r.actions?.click);
        continue;
      }
      const m = semantic.measures[r.metric];
      assert(!!m, "E_UNKNOWN_MEASURE", `Unknown record metric '${r.metric}' in ${widget.widgetId}`);
      assert(m.grain === widget.grain, "E_GRAIN_MISMATCH", `Record metric '${r.metric}' grain mismatch in ${widget.widgetId}`);
      const d = semantic.dimensions[r.groupBy];
      assert(!!d, "E_UNKNOWN_DIMENSION", `Unknown record groupBy '${r.groupBy}' in ${widget.widgetId}`);
      const grains = Array.isArray(d.grain) ? d.grain : [d.grain];
      assert(grains.includes(widget.grain), "E_GRAIN_MISMATCH", `Record groupBy '${r.groupBy}' grain mismatch in ${widget.widgetId}`);
      assert(r.extreme === "max" || r.extreme === "min", "E_BAD_SPEC", `Record extreme must be max|min in ${widget.widgetId}`);
      validateClickAction(semantic, widget.widgetId, r.actions?.click);
    }
  }

  if (widget.type === "leader_list") {
    const spec: any = widget.spec;
    assert(Array.isArray(spec.rows) && spec.rows.length > 0, "E_BAD_SPEC", `leader_list ${widget.widgetId} has no rows`);
    for (const r of spec.rows as any[]) {
      assert(typeof r.label === "string" && r.label.trim().length > 0, "E_BAD_SPEC", `leader_list row missing label in ${widget.widgetId}`);
      assert(typeof r.dimension === "string" && r.dimension.trim().length > 0, "E_BAD_SPEC", `leader_list row missing dimension in ${widget.widgetId}`);
      const d = semantic.dimensions[r.dimension];
      assert(!!d, "E_UNKNOWN_DIMENSION", `Unknown leader_list dimension '${r.dimension}' in ${widget.widgetId}`);
      const grains = Array.isArray(d.grain) ? d.grain : [d.grain];
      assert(grains.includes(widget.grain), "E_GRAIN_MISMATCH", `leader_list dimension '${r.dimension}' grain mismatch in ${widget.widgetId}`);
      validateClickAction(semantic, widget.widgetId, r.actions?.click);
    }
  }
}

function validateClickAction(semantic: SemanticRegistry, widgetId: string, click: any): void {
  if (!click || click.type !== "drilldown") return;
  const target = click.target as string;
  const targetPreset = semantic.drilldownPresets[target as keyof typeof semantic.drilldownPresets];
  assert(!!targetPreset, "E_BAD_SPEC", `Unknown drilldown target '${target}' in widget ${widgetId}`);
  const columns = targetPreset?.columnsPresets?.[click.columnsPreset];
  assert(!!columns && columns.length > 0, "E_BAD_SPEC", `Unknown columnsPreset '${click.columnsPreset}' in widget ${widgetId}`);
}

function validateFilterClause(semantic: SemanticRegistry, clause: any): void {
  assert(!!clause && typeof clause === "object", "E_BAD_SPEC", "FilterClause must be an object");
  assert(typeof clause.dimension === "string" && clause.dimension.trim().length > 0, "E_BAD_SPEC", "FilterClause.dimension must be a string");
  assert(clause.op === "eq" || clause.op === "neq" || clause.op === "in" || clause.op === "nin", "E_BAD_SPEC", "FilterClause.op invalid");
  if (clause.op === "in" || clause.op === "nin") {
    assert(Array.isArray(clause.values), "E_BAD_SPEC", "FilterClause.values must be an array for in/nin");
  }

  const dimId = String(clause.dimension);
  const dim = semantic.dimensions[dimId];
  // If the dimension exists in semantic registry, global filters should be round-grain compatible.
  if (dim) {
    const grains = Array.isArray(dim.grain) ? dim.grain : [dim.grain];
    assert(grains.includes("round"), "E_GRAIN_MISMATCH", `Global filter dimension '${dimId}' grain mismatch (expected round)`);
  }
}

function getChartMeasureIds(spec: any): string[] {
  const result: string[] = [];
  const single = typeof spec?.y?.measure === "string" ? spec.y.measure.trim() : "";
  if (single) result.push(single);
  if (Array.isArray(spec?.y?.measures)) {
    for (const m of spec.y.measures) {
      if (typeof m !== "string") continue;
      const clean = m.trim();
      if (!clean || result.includes(clean)) continue;
      result.push(clean);
    }
  }
  return result;
}

function getBreakdownMeasureIds(spec: any): string[] {
  const result: string[] = [];
  const single = typeof spec?.measure === "string" ? spec.measure.trim() : "";
  if (single) result.push(single);
  if (Array.isArray(spec?.measures)) {
    for (const m of spec.measures) {
      if (typeof m !== "string") continue;
      const clean = m.trim();
      if (!clean || result.includes(clean)) continue;
      result.push(clean);
    }
  }
  return result;
}
