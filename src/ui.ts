import { AnalysisBarPoint, AnalysisChart, AnalysisDrilldownItem, AnalysisSection, AnalysisWindowData } from "./analysis";
import { db } from "./db";
import designTemplateJson from "../design.json";
import designSchemaJson from "../design.schema.json";

type AnalysisTheme = "dark" | "light";
type AnalysisSettings = {
  theme: AnalysisTheme;
  accent: string;
  visibleFilters: {
    date: boolean;
    mode: boolean;
    movement: boolean;
    teammate: boolean;
    country: boolean;
  };
};

type FilterKey = "date" | "mode" | "movement" | "teammate" | "country";

type ThemePalette = {
  bg: string;
  text: string;
  panel: string;
  panelAlt: string;
  border: string;
  axis: string;
  textMuted: string;
  buttonBg: string;
  buttonText: string;
  chipBg: string;
  chipText: string;
};

type DesignIconKey =
  | "overview"
  | "time_patterns"
  | "sessions"
  | "tempo"
  | "scores"
  | "rounds"
  | "countries"
  | "opponents"
  | "rating"
  | "team"
  | "spotlight"
  | "records"
  | "default";

type DesignSectionLayout =
  | {
      mode: "legacy_colon";
    }
  | {
      mode: "header_blocks";
      headers: string[];
      preserveUnmatched?: boolean;
      boxes?: Array<{
        title: string;
        lines?: Array<{ label: string }>;
      }>;
      single?: Array<{ label: string }>;
      graphs?: Array<DesignGraphTemplate>;
    }
  | {
      mode: "object_order";
      order: Array<{ kind: "single" | "box" | "graph"; id: string }>;
      preserveUnmatched?: boolean;
    };

type DesignGraphTemplate = {
  id?: string;
  sourceIndex?: number;
  type?: AnalysisChart["type"] | "horizontalBar" | "verticalBar";
  title?: string;
  yLabel?: string;
  content?: string;
  hoverable?: boolean;
  clickable?: boolean;
  metrics?: string[];
  defaultMetric?: string;
  defaultSort?: "chronological" | "desc" | "asc";
  sorts?: Array<"chronological" | "desc" | "asc">;
  orientation?: "vertical" | "horizontal";
  sortable?: boolean;
  allowSort?: boolean;
  initialBars?: number | "max";
  expandable?: boolean;
  maxCompare?: number;
  drilldownType?: "rounds" | "players";
  drilldownColumns?: string[];
  drilldownColored?: string[];
  drilldownClickable?: string[];
};

type GraphContentDefinition = {
  metrics?: string[];
  defaultMetric?: string;
  defaultSort?: "chronological" | "desc" | "asc";
  sorts?: Array<"chronological" | "desc" | "asc">;
};

type DesignSectionTemplate = {
  id: string;
  sourceSectionId?: string;
  tocLabel?: string;
  icon?: DesignIconKey;
  tocIcon?: {
    enabled?: boolean;
    key?: DesignIconKey;
    svg?: string;
  };
  titleTemplate?: string;
  title?: string;
  group?: AnalysisSection["group"];
  appliesFilters?: AnalysisSection["appliesFilters"];
  static?: {
    lines?: string[];
  };
  render?: {
    chartIndices?: number[];
    chartTitles?: string[];
    includeLineLabels?: string[];
    excludeLineLabels?: string[];
    preserveUnmatchedLines?: boolean;
  };
  graphTemplates?: DesignGraphTemplate[];
  objects?: {
    singles?: Array<{ id: string; label: string; type?: string; sourceSectionId?: string }>;
    boxes?: Array<{
      id: string;
      title: string;
      lines?: Array<{ label: string; type?: string; sourceSectionId?: string }>;
    }>;
    graphs?: Array<DesignGraphTemplate & { id: string }>;
  };
  layout?: DesignSectionLayout;
  requiredFilters?: {
    teammate?: {
      enabled?: boolean;
      default?: "top_games";
      label?: string;
    };
    country?: {
      enabled?: boolean;
      default?: "top_rounds";
      label?: string;
    };
  };
};

type AnalysisDesignTemplate = {
  window?: {
    titleTemplate?: string;
    appearance?: {
      defaults?: {
        theme?: AnalysisTheme;
        accent?: string;
      };
    };
    toc?: {
      labelOverrides?: Record<string, string>;
    };
  };
  appearance?: {
    defaultTheme?: AnalysisTheme;
    defaultAccent?: string;
  };
  graphContentDefinitions?: Record<string, GraphContentDefinition>;
  section_layout?: {
    order?: string[];
    appendUnspecified?: boolean;
  };
  sections?: Array<
    DesignSectionTemplate & {
      tocTitle?: string;
      layout?: DesignSectionLayout & {
        boxes?: Array<{ title?: string }>;
      };
    }
  >;
};

const DEFAULT_ANALYSIS_DESIGN: AnalysisDesignTemplate = typeof designTemplateJson === "object" && designTemplateJson
  ? (designTemplateJson as AnalysisDesignTemplate)
  : {};
let analysisDesign: AnalysisDesignTemplate = JSON.parse(JSON.stringify(DEFAULT_ANALYSIS_DESIGN));

const ANALYSIS_TEMPLATE_META_KEY = "analysis:window-template:v1";

async function loadPersistedAnalysisDesign(): Promise<AnalysisDesignTemplate | null> {
  try {
    const row = await db.meta.get(ANALYSIS_TEMPLATE_META_KEY);
    if (!row || !row.value || typeof row.value !== "object") return null;
    return row.value as AnalysisDesignTemplate;
  } catch {
    return null;
  }
}

async function persistAnalysisDesign(): Promise<void> {
  try {
    await db.meta.put({
      key: ANALYSIS_TEMPLATE_META_KEY,
      value: analysisDesign,
      updatedAt: Date.now()
    });
  } catch {
    // ignore persistence issues
  }
}

function replaceAnalysisDesign(next: AnalysisDesignTemplate): void {
  analysisDesign = next && typeof next === "object" ? next : JSON.parse(JSON.stringify(DEFAULT_ANALYSIS_DESIGN));
  rebuildSectionTemplateCache();
}

function getDesignDefaultTheme(): AnalysisTheme {
  const fromWindow = analysisDesign.window?.appearance?.defaults?.theme;
  if (fromWindow === "dark" || fromWindow === "light") return fromWindow;
  const fromRoot = analysisDesign.appearance?.defaultTheme;
  if (fromRoot === "dark" || fromRoot === "light") return fromRoot;
  return "dark";
}

function getDesignDefaultAccent(): string {
  const fromWindow = analysisDesign.window?.appearance?.defaults?.accent;
  if (typeof fromWindow === "string") return fromWindow;
  const fromRoot = analysisDesign.appearance?.defaultAccent;
  if (typeof fromRoot === "string") return fromRoot;
  return "#66a8ff";
}

function getDesignDefaultVisibleFilters(): Record<FilterKey, boolean> {
  const visible = (analysisDesign.window as unknown as { filters?: { visible?: Partial<Record<FilterKey, boolean>> } } | undefined)?.filters?.visible;
  return {
    date: visible?.date !== false,
    mode: visible?.mode !== false,
    movement: visible?.movement !== false,
    teammate: visible?.teammate !== false,
    country: visible?.country !== false
  };
}

function normalizeSectionTemplate(
  raw: DesignSectionTemplate & {
    tocTitle?: string;
    layout?: DesignSectionLayout & {
      boxes?: Array<{
        title?: string;
        lines?: Array<{ label?: string }>;
      }>;
      single?: Array<{ label?: string }>;
      order?: Array<{ kind?: string; id?: string }>;
    };
    objects?: {
      singles?: Array<{ id?: string; label?: string }>;
      boxes?: Array<{ id?: string; title?: string; lines?: Array<{ label?: string }> }>;
      graphs?: Array<DesignGraphTemplate & { id?: string }>;
    };
    requiredFilters?: {
      teammate?: { enabled?: boolean; default?: string; label?: string };
      country?: { enabled?: boolean; default?: string; label?: string };
    };
  }
): DesignSectionTemplate {
  const normalizeGraphTemplate = (graphRaw: DesignGraphTemplate | undefined): DesignGraphTemplate | undefined => {
    if (!graphRaw || typeof graphRaw !== "object") return undefined;
    const type = graphRaw.type;
    const defaultSort = graphRaw.defaultSort;
    const metrics = Array.isArray(graphRaw.metrics)
      ? graphRaw.metrics.map((m) => (typeof m === "string" ? m.trim() : "")).filter((m) => m.length > 0)
      : undefined;
    const sorts = Array.isArray(graphRaw.sorts)
      ? graphRaw.sorts.filter((s): s is "chronological" | "desc" | "asc" => s === "chronological" || s === "desc" || s === "asc")
      : undefined;
    const mappedType =
      type === "line" || type === "selectableBar" || type === "selectableLine"
        ? type
        : type === "bar" || type === "verticalBar" || type === "horizontalBar"
          ? "bar"
          : undefined;
    const mappedOrientation =
      type === "horizontalBar"
        ? "horizontal"
        : type === "verticalBar"
          ? "vertical"
          : graphRaw.orientation === "vertical" || graphRaw.orientation === "horizontal"
            ? graphRaw.orientation
            : undefined;
    const drilldownType = graphRaw.drilldownType;
    const toStringList = (v: unknown): string[] | undefined =>
      Array.isArray(v)
        ? v.map((x) => (typeof x === "string" ? x.trim() : "")).filter((x) => x.length > 0)
        : undefined;
    return {
      type: mappedType,
      title: typeof graphRaw.title === "string" ? graphRaw.title : undefined,
      yLabel: typeof graphRaw.yLabel === "string" ? graphRaw.yLabel : undefined,
      content: typeof graphRaw.content === "string" ? graphRaw.content : undefined,
      hoverable: typeof graphRaw.hoverable === "boolean" ? graphRaw.hoverable : undefined,
      clickable: typeof graphRaw.clickable === "boolean" ? graphRaw.clickable : undefined,
      metrics,
      defaultMetric: typeof graphRaw.defaultMetric === "string" ? graphRaw.defaultMetric : undefined,
      defaultSort: defaultSort === "chronological" || defaultSort === "desc" || defaultSort === "asc" ? defaultSort : undefined,
      sorts: sorts && sorts.length > 0 ? sorts : undefined,
      orientation: mappedOrientation,
      sortable: typeof graphRaw.sortable === "boolean" ? graphRaw.sortable : undefined,
      allowSort: typeof graphRaw.allowSort === "boolean" ? graphRaw.allowSort : undefined,
      initialBars: typeof graphRaw.initialBars === "number" || graphRaw.initialBars === "max" ? graphRaw.initialBars : undefined,
      expandable: typeof graphRaw.expandable === "boolean" ? graphRaw.expandable : undefined,
      maxCompare: typeof graphRaw.maxCompare === "number" ? graphRaw.maxCompare : undefined
      ,
      drilldownType: drilldownType === "players" || drilldownType === "rounds" ? drilldownType : undefined,
      drilldownColumns: toStringList(graphRaw.drilldownColumns),
      drilldownColored: toStringList(graphRaw.drilldownColored),
      drilldownClickable: toStringList(graphRaw.drilldownClickable)
    };
  };
  const normalizeGraphTemplates = (items: Array<DesignGraphTemplate | undefined> | undefined): DesignGraphTemplate[] | undefined => {
    if (!Array.isArray(items) || items.length === 0) return undefined;
    const list = items.map(normalizeGraphTemplate).filter((g): g is DesignGraphTemplate => !!g);
    return list.length > 0 ? list : undefined;
  };

  const base: DesignSectionTemplate = {
    id: raw.id,
    sourceSectionId: typeof raw.sourceSectionId === "string" ? raw.sourceSectionId : undefined,
    tocLabel: raw.tocLabel ?? raw.tocTitle,
    icon: raw.icon,
    tocIcon: raw.tocIcon && typeof raw.tocIcon === "object"
      ? {
          enabled: typeof raw.tocIcon.enabled === "boolean" ? raw.tocIcon.enabled : undefined,
          key:
            raw.tocIcon.key === "overview" ||
            raw.tocIcon.key === "time_patterns" ||
            raw.tocIcon.key === "sessions" ||
            raw.tocIcon.key === "tempo" ||
            raw.tocIcon.key === "scores" ||
            raw.tocIcon.key === "rounds" ||
            raw.tocIcon.key === "countries" ||
            raw.tocIcon.key === "opponents" ||
            raw.tocIcon.key === "rating" ||
            raw.tocIcon.key === "team" ||
            raw.tocIcon.key === "spotlight" ||
            raw.tocIcon.key === "records" ||
            raw.tocIcon.key === "default"
              ? raw.tocIcon.key
              : undefined,
          svg: typeof raw.tocIcon.svg === "string" ? raw.tocIcon.svg : undefined
        }
      : undefined,
    titleTemplate: typeof raw.titleTemplate === "string" ? raw.titleTemplate : undefined,
    title: typeof raw.title === "string" ? raw.title : undefined,
    group: raw.group,
    appliesFilters: raw.appliesFilters,
    static: raw.static,
    render: raw.render,
    graphTemplates: normalizeGraphTemplates(raw.graphTemplates),
    objects: undefined
    ,
    requiredFilters: raw.requiredFilters && typeof raw.requiredFilters === "object"
      ? {
          teammate: raw.requiredFilters.teammate && typeof raw.requiredFilters.teammate === "object"
            ? {
                enabled: typeof raw.requiredFilters.teammate.enabled === "boolean" ? raw.requiredFilters.teammate.enabled : undefined,
                default: raw.requiredFilters.teammate.default === "top_games" ? "top_games" : undefined,
                label: typeof raw.requiredFilters.teammate.label === "string" ? raw.requiredFilters.teammate.label : undefined
              }
            : undefined,
          country: raw.requiredFilters.country && typeof raw.requiredFilters.country === "object"
            ? {
                enabled: typeof raw.requiredFilters.country.enabled === "boolean" ? raw.requiredFilters.country.enabled : undefined,
                default: raw.requiredFilters.country.default === "top_rounds" ? "top_rounds" : undefined,
                label: typeof raw.requiredFilters.country.label === "string" ? raw.requiredFilters.country.label : undefined
              }
            : undefined
        }
      : undefined
  };
  const rawLayout = raw.layout as
    | (DesignSectionLayout & {
        boxes?: Array<{
          title?: string;
          lines?: Array<{ label?: string }>;
        }>;
        single?: Array<{ label?: string }>;
      })
    | undefined;
  const rawObjects = raw.objects;
  if (rawObjects) {
    const singles = (rawObjects.singles || [])
      .map((s) => ({
        id: typeof s?.id === "string" ? s.id : "",
        label: typeof s?.label === "string" ? s.label : "",
        type: typeof s?.type === "string" ? s.type : undefined,
        sourceSectionId: typeof s?.sourceSectionId === "string" ? s.sourceSectionId : undefined
      }))
      .filter((s) => s.id && s.label);
    const boxes = (rawObjects.boxes || [])
      .map((b) => ({
        id: typeof b?.id === "string" ? b.id : "",
        title: typeof b?.title === "string" ? b.title : "",
        lines: (b?.lines || [])
          .map((l) => ({
            label: typeof l?.label === "string" ? l.label : "",
            type: typeof l?.type === "string" ? l.type : undefined,
            sourceSectionId: typeof l?.sourceSectionId === "string" ? l.sourceSectionId : undefined
          }))
          .filter((l) => l.label)
      }))
      .filter((b) => b.id && b.title);
    const graphs = normalizeGraphTemplates(rawObjects.graphs)?.map((g, idx) => ({
      id: typeof rawObjects.graphs?.[idx]?.id === "string" ? (rawObjects.graphs?.[idx]?.id as string) : "",
      ...g
    })).filter((g) => g.id) as Array<DesignGraphTemplate & { id: string }> | undefined;
    base.objects = {
      singles,
      boxes,
      graphs
    };
  }

  if (rawLayout?.mode) {
    if (rawLayout.mode === "header_blocks") {
      base.layout = {
        mode: "header_blocks",
        headers: rawLayout.headers || [],
        preserveUnmatched: rawLayout.preserveUnmatched,
        boxes: (rawLayout.boxes || [])
          .map((b) => ({
            title: typeof b?.title === "string" ? b.title : "",
            lines: (b?.lines || [])
              .map((l) => ({ label: typeof l?.label === "string" ? l.label : "" }))
              .filter((l) => l.label)
          }))
          .filter((b) => b.title),
        single: (rawLayout.single || [])
          .map((s) => ({ label: typeof s?.label === "string" ? s.label : "" }))
          .filter((s) => s.label),
        graphs: normalizeGraphTemplates(rawLayout.graphs)
      };
    } else if (rawLayout.mode === "object_order") {
      const order = (rawLayout.order || [])
        .map((item) => ({
          kind: item?.kind === "single" || item?.kind === "box" || item?.kind === "graph" ? item.kind : undefined,
          id: typeof item?.id === "string" ? item.id : ""
        }))
        .filter((item): item is { kind: "single" | "box" | "graph"; id: string } => !!item.kind && !!item.id);
      base.layout = {
        mode: "object_order",
        order,
        preserveUnmatched: rawLayout.preserveUnmatched
      };
    } else {
      base.layout = { mode: "legacy_colon" };
    }
    if (!base.graphTemplates && base.layout.mode === "header_blocks") {
      const headerLayout = base.layout as Extract<DesignSectionLayout, { mode: "header_blocks" }>;
      base.graphTemplates = headerLayout.graphs;
    }
    return base;
  }
  if (base.objects) {
    const order: Array<{ kind: "single" | "box" | "graph"; id: string }> = [];
    for (const s of base.objects.singles || []) order.push({ kind: "single", id: s.id });
    for (const b of base.objects.boxes || []) order.push({ kind: "box", id: b.id });
    for (const g of base.objects.graphs || []) order.push({ kind: "graph", id: g.id });
    base.layout = { mode: "object_order", order, preserveUnmatched: true };
    if (!base.graphTemplates && base.objects.graphs) base.graphTemplates = base.objects.graphs;
    return base;
  }
  base.layout = { mode: "legacy_colon" };
  if (!base.graphTemplates) base.graphTemplates = normalizeGraphTemplates(rawLayout?.graphs);
  return base;
}

let sectionTemplateById = new Map<string, DesignSectionTemplate>();
function rebuildSectionTemplateCache(): void {
  sectionTemplateById = new Map(
    (analysisDesign.sections || []).map((s) => [s.id, normalizeSectionTemplate(s)])
  );
}
rebuildSectionTemplateCache();

function getSectionTemplate(section: AnalysisSection): DesignSectionTemplate | undefined {
  return sectionTemplateById.get(section.id);
}

function getLineLabel(line: string): string {
  const idx = line.indexOf(":");
  if (idx > 0) return line.slice(0, idx).trim();
  return line.trim();
}

function matchesLineLabel(line: string, label: string): boolean {
  const want = label.trim().toLowerCase();
  if (!want) return false;
  return getLineLabel(line).toLowerCase() === want;
}

type DesignResolvedLine = {
  label: string;
  value: string;
  drilldown?: AnalysisDrilldownItem[];
  link?: string;
};

type DesignSourceLineRef = {
  line: string;
  label: string;
  value: string;
  drilldown?: AnalysisDrilldownItem[];
  link?: string;
};

type DesignSourceLineLookup = Map<string, Map<string, DesignSourceLineRef>>;

function buildDesignSourceLineLookup(sections: AnalysisSection[]): DesignSourceLineLookup {
  const lookup: DesignSourceLineLookup = new Map();
  for (const section of sections) {
    const drillByLabel = new Map((section.lineDrilldowns || []).map((d) => [d.lineLabel.toLowerCase(), d.items]));
    const linkByLabel = new Map((section.lineLinks || []).map((d) => [d.lineLabel.toLowerCase(), d.url]));
    const byLabel: Map<string, DesignSourceLineRef> = new Map();
    for (const line of section.lines || []) {
      const sep = line.indexOf(":");
      const label = (sep > 0 ? line.slice(0, sep) : line).trim();
      const value = sep > 0 ? line.slice(sep + 1).trim() : "";
      byLabel.set(label.toLowerCase(), {
        line,
        label,
        value,
        drilldown: drillByLabel.get(label.toLowerCase()),
        link: linkByLabel.get(label.toLowerCase())
      });
    }
    lookup.set(section.id, byLabel);
  }
  return lookup;
}

function materializeSections(data: AnalysisWindowData): AnalysisSection[] {
  const source = data.sections || [];
  const sourceById = new Map(source.map((s) => [s.id, s]));
  const sectionOrder = Array.isArray(analysisDesign.section_layout?.order)
    ? analysisDesign.section_layout?.order?.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim())
    : [];
  const templateList = analysisDesign.sections || [];
  const templateById = new Map(templateList.map((t) => [t.id, t]));
  const orderedTemplates = sectionOrder.length > 0
    ? [
        ...sectionOrder.map((id) => templateById.get(id)).filter((t): t is (typeof templateList)[number] => !!t),
        ...templateList.filter((t) => !sectionOrder.includes(t.id))
      ]
    : templateList;
  if (orderedTemplates.length === 0) return source;

  const out: AnalysisSection[] = [];
  const usedSourceIds = new Set<string>();

  const cloneSection = (section: AnalysisSection): AnalysisSection => ({
    ...section,
    lines: section.lines.slice(),
    lineDrilldowns: section.lineDrilldowns ? section.lineDrilldowns.map((d) => ({ lineLabel: d.lineLabel, items: d.items.slice() })) : undefined,
    lineLinks: section.lineLinks ? section.lineLinks.map((d) => ({ lineLabel: d.lineLabel, url: d.url })) : undefined,
    charts: section.charts ? section.charts.slice() : undefined
  });

  for (const templRaw of orderedTemplates) {
    const templ = normalizeSectionTemplate(templRaw as DesignSectionTemplate & { tocTitle?: string });
    const sourceId = templ.sourceSectionId || templ.id;
    const src = sourceById.get(sourceId);
    if (!src) {
      if (templ.static?.lines && templ.static.lines.length > 0) {
        out.push({
          id: templ.id,
          title: templ.title || templ.id,
          group: templ.group,
          appliesFilters: templ.appliesFilters,
          lines: templ.static.lines.slice()
        });
      }
      continue;
    }
    usedSourceIds.add(sourceId);
    const next = cloneSection(src);
    next.id = templ.id;
    if (templ.title) next.title = templ.title;
    if (templ.group) next.group = templ.group;
    if (templ.appliesFilters) next.appliesFilters = templ.appliesFilters;

    const includeLabels = templ.render?.includeLineLabels || [];
    const excludeLabels = templ.render?.excludeLineLabels || [];
    if (includeLabels.length > 0 || excludeLabels.length > 0) {
      const includeSet = includeLabels.map((l) => l.trim().toLowerCase()).filter(Boolean);
      const excludeSet = new Set(excludeLabels.map((l) => l.trim().toLowerCase()).filter(Boolean));
      next.lines = next.lines.filter((line) => {
        const label = getLineLabel(line).toLowerCase();
        if (excludeSet.has(label)) return false;
        if (includeSet.length > 0) return includeSet.includes(label);
        return true;
      });
      const keepLabel = (label: string) => next.lines.some((line) => matchesLineLabel(line, label));
      if (next.lineDrilldowns) next.lineDrilldowns = next.lineDrilldowns.filter((d) => keepLabel(d.lineLabel));
      if (next.lineLinks) next.lineLinks = next.lineLinks.filter((d) => keepLabel(d.lineLabel));
    }

    const allCharts = next.charts ? next.charts.slice() : next.chart ? [next.chart] : [];
    if (templ.render?.chartIndices && templ.render.chartIndices.length > 0) {
      const picked = templ.render.chartIndices
        .map((idx) => allCharts[idx])
        .filter((c): c is AnalysisChart => !!c);
      next.charts = picked;
      if (picked.length === 1) next.chart = picked[0];
      else next.chart = undefined;
    } else if (templ.render?.chartTitles && templ.render.chartTitles.length > 0) {
      const wanted = new Set(templ.render.chartTitles.map((t) => t.toLowerCase()));
      const picked = allCharts.filter((c) => {
        const yl = ("yLabel" in c && typeof c.yLabel === "string" ? c.yLabel : "") || "";
        return wanted.has(yl.toLowerCase());
      });
      next.charts = picked;
      if (picked.length === 1) next.chart = picked[0];
      else next.chart = undefined;
    }

    out.push(next);
  }

  const appendUnspecified = analysisDesign.section_layout?.appendUnspecified !== false;
  if (appendUnspecified) {
    for (const src of source) {
      if (usedSourceIds.has(src.id)) continue;
      out.push(src);
    }
  }
  return out;
}

function getSectionTocLabel(section: AnalysisSection): string {
  const templ = getSectionTemplate(section);
  if (templ?.tocLabel) return templ.tocLabel;
  const override = analysisDesign.window?.toc?.labelOverrides?.[section.id];
  if (typeof override === "string" && override.trim()) return override.trim();
  if (section.id === "teammate_battle") return "Team";
  if (section.id === "country_spotlight") return "Country Spotlight";
  return section.title;
}

function getSectionTemplateVars(section: AnalysisSection): Record<string, string> {
  const vars: Record<string, string> = {};
  if (section.id === "teammate_battle") {
    const m = /^Team:\s*You\s*\+\s*(.+)$/i.exec(section.title.trim());
    if (m?.[1]) vars.mateName = m[1].trim();
  }
  if (section.id === "country_spotlight") {
    const m = /^Country Spotlight:\s*(.+)$/i.exec(section.title.trim());
    if (m?.[1]) vars.countryName = m[1].trim();
  }
  return vars;
}

function applyTemplate(input: string, vars: Record<string, string>): string {
  return input.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_full, key: string) => vars[key] ?? "");
}

function getGraphContentDefinition(content: string | undefined): GraphContentDefinition | undefined {
  if (!content) return undefined;
  return analysisDesign.graphContentDefinitions?.[content];
}

function getSectionRenderTitle(section: AnalysisSection): string {
  const templ = getSectionTemplate(section);
  if (!templ?.titleTemplate) return section.title;
  const rendered = applyTemplate(templ.titleTemplate, getSectionTemplateVars(section)).trim();
  return rendered || section.title;
}

function applyGraphTemplateToChart(
  chart: AnalysisChart,
  template: DesignGraphTemplate | undefined
): { chart: AnalysisChart; title?: string } {
  if (!template) return { chart };
  const contentDef = getGraphContentDefinition(template.content);
  if (template.type && template.type !== chart.type) return { chart };
  if (template.yLabel && chart.yLabel && template.yLabel !== chart.yLabel) return { chart };

  if (chart.type === "bar") {
    const next: Extract<AnalysisChart, { type: "bar" }> = {
      ...chart,
      orientation: template.orientation || chart.orientation,
      initialBars: typeof template.initialBars === "number" ? template.initialBars : chart.initialBars
    };
    return { chart: next, title: template.title };
  }

  if (chart.type === "selectableBar") {
    const sourceOptions = chart.options.slice();
    let options = sourceOptions;
    const desiredMetricKeys = template.metrics && template.metrics.length > 0 ? template.metrics : contentDef?.metrics;
    if (desiredMetricKeys && desiredMetricKeys.length > 0) {
      const byKey = new Map(sourceOptions.map((o) => [o.key, o]));
      const picked = desiredMetricKeys.map((k) => byKey.get(k)).filter((o): o is (typeof sourceOptions)[number] => !!o);
      if (picked.length > 0) options = picked;
    }
    const wantedDefaultMetric = template.defaultMetric || contentDef?.defaultMetric;
    const hasDefaultMetric = wantedDefaultMetric && options.some((o) => o.key === wantedDefaultMetric);
    const next: Extract<AnalysisChart, { type: "selectableBar" }> = {
      ...chart,
      options,
      orientation: template.orientation || chart.orientation,
      initialBars: typeof template.initialBars === "number" ? template.initialBars : chart.initialBars,
      allowSort:
        typeof template.sortable === "boolean"
          ? template.sortable
          : typeof template.allowSort === "boolean"
            ? template.allowSort
            : chart.allowSort,
      defaultSort: template.defaultSort || contentDef?.defaultSort || chart.defaultSort,
      defaultMetricKey: hasDefaultMetric ? wantedDefaultMetric : chart.defaultMetricKey
    };
    (next as unknown as { sorts?: Array<"chronological" | "desc" | "asc"> }).sorts = template.sorts || contentDef?.sorts;
    return { chart: next, title: template.title };
  }

  if (chart.type === "selectableLine") {
    const sourceOptions = chart.options.slice();
    let options = sourceOptions;
    const desiredMetricKeys = template.metrics && template.metrics.length > 0 ? template.metrics : contentDef?.metrics;
    if (desiredMetricKeys && desiredMetricKeys.length > 0) {
      const byKey = new Map(sourceOptions.map((o) => [o.key, o]));
      const picked = desiredMetricKeys.map((k) => byKey.get(k)).filter((o): o is (typeof sourceOptions)[number] => !!o);
      if (picked.length > 0) options = picked;
    }
    const wantedDefaultMetric = template.defaultMetric || contentDef?.defaultMetric;
    const hasDefaultMetric = wantedDefaultMetric && options.some((o) => o.key === wantedDefaultMetric);
    const next: Extract<AnalysisChart, { type: "selectableLine" }> = {
      ...chart,
      options,
      maxCompare: typeof template.maxCompare === "number" ? template.maxCompare : chart.maxCompare,
      defaultMetricKey: hasDefaultMetric ? wantedDefaultMetric : chart.defaultMetricKey
    };
    return { chart: next, title: template.title };
  }

  return { chart, title: template.title };
}

function getWindowRenderTitle(data: AnalysisWindowData): string {
  const tpl = analysisDesign.window?.titleTemplate;
  if (typeof tpl === "string" && tpl.trim()) {
    const rendered = applyTemplate(tpl, { playerName: data.playerName || "" }).trim();
    if (rendered) return rendered;
  }
  return data.playerName
    ? `GeoAnalyzr - Full Analysis for ${data.playerName}`
    : "GeoAnalyzr - Full Analysis";
}

function resolveTypedLine(
  type: string | undefined,
  currentSectionId: string,
  sourceSectionId: string | undefined,
  fallbackLabel: string,
  lookup: DesignSourceLineLookup
): DesignResolvedLine | undefined {
  if (!type) return undefined;
  const sectionId = sourceSectionId || currentSectionId;
  const label = fallbackLabel;
  if (!sectionId || !label) return undefined;
  const byLabel = lookup.get(sectionId);
  const ref = byLabel?.get(label.toLowerCase());
  if (!ref) return undefined;
  return {
    label: fallbackLabel || ref.label,
    value: ref.value,
    drilldown: ref.drilldown,
    link: ref.link
  };
}

const ANALYSIS_SETTINGS_STORAGE_KEY = "geoanalyzr:analysis:settings:v1";
const ANALYSIS_UI_SETTINGS_META_KEY = "analysis:window-ui-settings:v1";
const defaultAnalysisSettings: AnalysisSettings = {
  theme: getDesignDefaultTheme(),
  accent: normalizeAccent(getDesignDefaultAccent()),
  visibleFilters: getDesignDefaultVisibleFilters()
};

function normalizeAccent(value: unknown): string {
  if (typeof value !== "string") return "#66a8ff";
  const v = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : "#66a8ff";
}

function loadAnalysisSettings(): AnalysisSettings {
  const designVisible = (analysisDesign.window as unknown as { filters?: { visible?: Partial<Record<FilterKey, boolean>> } } | undefined)?.filters?.visible;
  try {
    const raw = localStorage.getItem(ANALYSIS_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...defaultAnalysisSettings };
    const parsed = JSON.parse(raw) as Partial<AnalysisSettings>;
    const theme: AnalysisTheme = parsed.theme === "light" ? "light" : "dark";
    const accent = normalizeAccent(parsed.accent);
    const visibleFilters = {
      date: parsed.visibleFilters?.date ?? designVisible?.date ?? true,
      mode: parsed.visibleFilters?.mode ?? designVisible?.mode ?? true,
      movement: parsed.visibleFilters?.movement ?? designVisible?.movement ?? true,
      teammate: parsed.visibleFilters?.teammate ?? designVisible?.teammate ?? true,
      country: parsed.visibleFilters?.country ?? designVisible?.country ?? true
    };
    return { theme, accent, visibleFilters };
  } catch {
    return { ...defaultAnalysisSettings };
  }
}

function saveAnalysisSettings(): void {
  try {
    localStorage.setItem(ANALYSIS_SETTINGS_STORAGE_KEY, JSON.stringify(analysisSettings));
  } catch {
    // ignore persistence issues
  }
  void db.meta.put({
    key: ANALYSIS_UI_SETTINGS_META_KEY,
    value: analysisSettings,
    updatedAt: Date.now()
  }).catch(() => {
    // ignore DB persistence issues
  });
}

const analysisSettings: AnalysisSettings = loadAnalysisSettings();

function getThemePalette(): ThemePalette {
  if (analysisSettings.theme === "light") {
    return {
      bg: "#f3f6fb",
      text: "#111827",
      panel: "#ffffff",
      panelAlt: "#eef2f8",
      border: "#d0d9e6",
      axis: "#9aa8bf",
      textMuted: "#4b5a73",
      buttonBg: "#edf1f7",
      buttonText: "#1e2a40",
      chipBg: "#e7edf8",
      chipText: "#2a466e"
    };
  }
  return {
    bg: "#111",
    text: "#fff",
    panel: "#171717",
    panelAlt: "#121212",
    border: "#2d2d2d",
    axis: "#3a3a3a",
    textMuted: "#aaa",
    buttonBg: "#303030",
    buttonText: "#fff",
    chipBg: "#1f3452",
    chipText: "#bcd7ff"
  };
}

function gameModeSelectLabel(mode: string): string {
  const normalized = mode.trim().toLowerCase();
  if (normalized === "all") return "all";
  if (normalized === "duels" || normalized === "duel") return "Duel";
  if (normalized === "teamduels" || normalized === "team duel" || normalized === "team_duels" || normalized === "teamduel") return "Team Duel";
  return mode;
}

export interface UIHandle {
  setVisible: (visible: boolean) => void;
  setStatus: (msg: string) => void;
  setCounts: (counts: {
    games: number;
    rounds: number;
    detailsOk: number;
    detailsError: number;
    detailsMissing: number;
  }) => void;
  setAnalysisWindowData: (data: AnalysisWindowData) => void;
  onUpdateClick: (fn: () => void) => void;
  onResetClick: (fn: () => void) => void;
  onExportClick: (fn: () => void) => void;
  onTokenClick: (fn: () => void) => void;
  openNcfaManager: (options: {
    initialToken?: string;
    helpText: string;
    repoUrl: string;
    onSave: (token: string) => Promise<{ saved: boolean; token?: string; message: string }>;
    onAutoDetect: () => Promise<{ detected: boolean; token?: string; source?: "stored" | "cookie" | "session" | "none"; message: string }>;
  }) => void;
  onOpenAnalysisClick: (fn: () => void) => void;
  onRefreshAnalysisClick: (
    fn: (filter: {
      fromTs?: number;
      toTs?: number;
      gameMode?: string;
      movementType?: "all" | "moving" | "no_move" | "nmpz" | "unknown";
      teammateId?: string;
      country?: string;
    }) => void
  ) => void;
}

function isoDateLocal(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateInput(v: string, endOfDay = false): number | undefined {
  if (!v) return undefined;
  const d = new Date(`${v}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  const t = d.getTime();
  return Number.isFinite(t) ? t : undefined;
}

function sanitizeFileName(input: string): string {
  return input.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/\s+/g, "_").slice(0, 80);
}

function escapeSvgText(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function prepareSvgForExport(svg: SVGSVGElement): { text: string; width: number; height: number } {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (!clone.getAttribute("xmlns:xlink")) clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");

  let width = parseFloat(clone.getAttribute("width") || "");
  let height = parseFloat(clone.getAttribute("height") || "");
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    const vb = (clone.getAttribute("viewBox") || "").trim().split(/\s+/).map(Number);
    if (vb.length === 4 && Number.isFinite(vb[2]) && Number.isFinite(vb[3]) && vb[2] > 0 && vb[3] > 0) {
      width = vb[2];
      height = vb[3];
    }
  }
  if (!Number.isFinite(width) || width <= 0) width = 1200;
  if (!Number.isFinite(height) || height <= 0) height = 420;

  clone.setAttribute("width", String(Math.round(width)));
  clone.setAttribute("height", String(Math.round(height)));

  const text = new XMLSerializer().serializeToString(clone);
  return { text, width: Math.round(width), height: Math.round(height) };
}

async function downloadSvg(svg: SVGSVGElement, title: string): Promise<void> {
  const svgText = prepareSvgForExport(svg).text;
  const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  triggerDownload(blob, `${sanitizeFileName(title)}.svg`);
}

async function downloadPng(svg: SVGSVGElement, title: string): Promise<void> {
  const prepared = prepareSvgForExport(svg);
  const svgText = prepared.text;
  const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("SVG image load failed"));
      img.src = svgUrl;
    });

    const width = Math.max(1200, img.width || prepared.width || 1200);
    const height = Math.max(420, img.height || prepared.height || 420);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context not available");
    ctx.fillStyle = "#101010";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (blob) {
      triggerDownload(blob, `${sanitizeFileName(title)}.png`);
      return;
    }
    const dataUrl = canvas.toDataURL("image/png");
    const fallbackBlob = await (await fetch(dataUrl)).blob();
    triggerDownload(fallbackBlob, `${sanitizeFileName(title)}.png`);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function openChartInNewTab(svg: SVGSVGElement, title: string, hostWindow: Window = window): void {
  const win = hostWindow.open("about:blank", "_blank");
  if (!win) return;
  const svgMarkup = svg.outerHTML;
  const safeTitle = title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  win.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${safeTitle}</title>
    <style>
      body { margin: 0; background: #101010; color: #fff; font-family: system-ui, sans-serif; }
      .wrap { padding: 20px; }
      h1 { margin: 0 0 14px; font-size: 18px; }
      .chart { border: 1px solid #2a2a2a; border-radius: 10px; padding: 8px; background: #141414; }
      svg { width: 100%; height: auto; min-height: 420px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>${safeTitle}</h1>
      <div class="chart">${svgMarkup}</div>
    </div>
  </body>
</html>`);
  win.document.close();
}

function openZoomOverlay(svg: SVGSVGElement, title: string): void {
  const doc = svg.ownerDocument;
  const hostWindow = doc.defaultView ?? window;
  const overlay = doc.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,0.82)";
  overlay.style.zIndex = "1000005";
  overlay.style.display = "grid";
  overlay.style.placeItems = "center";
  overlay.style.padding = "20px";

  const card = doc.createElement("div");
  card.style.width = "min(1500px, 96vw)";
  card.style.maxHeight = "92vh";
  card.style.overflow = "auto";
  card.style.background = "#111";
  card.style.border = "1px solid #2a2a2a";
  card.style.borderRadius = "12px";
  card.style.padding = "12px";

  const header = doc.createElement("div");
  header.style.display = "flex";
  header.style.justifyContent = "space-between";
  header.style.alignItems = "center";
  header.style.marginBottom = "8px";
  header.innerHTML = `<div style="font-size:14px;font-weight:700;color:#fff">${title}</div>`;
  const closeBtn = doc.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.style.background = "#303030";
  closeBtn.style.color = "#fff";
  closeBtn.style.border = "1px solid #444";
  closeBtn.style.borderRadius = "6px";
  closeBtn.style.padding = "4px 8px";
  closeBtn.style.cursor = "pointer";
  header.appendChild(closeBtn);

  const svgClone = svg.cloneNode(true) as SVGSVGElement;
  svgClone.setAttribute("width", "100%");
  svgClone.setAttribute("height", "640");

  const chartWrap = doc.createElement("div");
  chartWrap.style.border = "1px solid #2a2a2a";
  chartWrap.style.borderRadius = "10px";
  chartWrap.style.background = "#121212";
  chartWrap.style.padding = "8px";
  chartWrap.appendChild(svgClone);

  const actions = doc.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "8px";
  actions.style.marginBottom = "10px";

  function mkAction(label: string, onClick: () => void): HTMLButtonElement {
    const b = doc.createElement("button");
    b.textContent = label;
    b.style.background = "#214a78";
    b.style.color = "white";
    b.style.border = "1px solid #2f6096";
    b.style.borderRadius = "6px";
    b.style.padding = "5px 9px";
    b.style.cursor = "pointer";
    b.addEventListener("click", onClick);
    return b;
  }

  actions.appendChild(mkAction("New Tab", () => openChartInNewTab(svgClone, title, hostWindow)));
  actions.appendChild(mkAction("Save SVG", () => void downloadSvg(svgClone, title)));
  actions.appendChild(mkAction("Save PNG", () => void downloadPng(svgClone, title)));

  closeBtn.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) overlay.remove();
  });

  card.appendChild(header);
  card.appendChild(actions);
  card.appendChild(chartWrap);
  overlay.appendChild(card);
  doc.body.appendChild(overlay);
}

function formatDrilldownDate(ts?: number): string {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return "-";
  const d = new Date(ts);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} ${hh}:${mm}`;
}

function formatGuessDuration(sec?: number): string {
  if (typeof sec !== "number" || !Number.isFinite(sec)) return "-";
  return `${sec.toFixed(1)}s`;
}

function formatDamageValue(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  const rounded = Math.round(value);
  return `${rounded >= 0 ? "+" : ""}${rounded}`;
}

const regionNameDisplay =
  typeof Intl !== "undefined" && "DisplayNames" in Intl && typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;

function countryNameFromCode(code?: string): string {
  if (typeof code !== "string") return "-";
  const normalized = code.trim().toLowerCase();
  if (!normalized) return "-";
  if (normalized.length === 2 && regionNameDisplay) {
    try {
      const label = regionNameDisplay.of(normalized.toUpperCase());
      if (typeof label === "string" && label.trim()) return label;
    } catch {
      // fallback below
    }
  }
  return normalized.toUpperCase();
}

function shortGameId(gameId: string): string {
  if (gameId.length <= 14) return gameId;
  return `${gameId.slice(0, 8)}...`;
}

type DrilldownOverlayOptions = {
  drilldownType?: "rounds" | "players";
  columns?: string[];
  colored?: string[];
  clickable?: string[];
  sortable?: boolean;
};

function openDrilldownOverlay(
  doc: Document,
  title: string,
  subtitle: string,
  drilldown: AnalysisDrilldownItem[],
  options?: DrilldownOverlayOptions
): void {
  if (drilldown.length === 0) return;
  const palette = getThemePalette();
  const overlay = doc.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,0.66)";
  overlay.style.zIndex = "2147483647";
  overlay.style.display = "flex";
  overlay.style.justifyContent = "center";
  overlay.style.alignItems = "flex-start";
  overlay.style.padding = "28px 16px";

  const card = doc.createElement("div");
  card.style.width = "min(1840px, 99vw)";
  card.style.maxHeight = "90vh";
  card.style.overflow = "auto";
  card.style.background = palette.panel;
  card.style.color = palette.text;
  card.style.border = `1px solid ${palette.border}`;
  card.style.borderRadius = "10px";
  card.style.boxShadow = "0 10px 30px rgba(0,0,0,.4)";
  card.style.padding = "10px 10px 12px";

  const header = doc.createElement("div");
  header.style.display = "flex";
  header.style.justifyContent = "space-between";
  header.style.alignItems = "center";
  header.style.marginBottom = "8px";
  const headTitle = doc.createElement("div");
  headTitle.style.fontWeight = "800";
  headTitle.style.fontSize = "14px";
  headTitle.textContent = `${title} - ${subtitle} (${drilldown.length})`;
  header.appendChild(headTitle);

  const closeBtn = doc.createElement("button");
  closeBtn.textContent = "x";
  closeBtn.style.background = "transparent";
  closeBtn.style.color = palette.textMuted;
  closeBtn.style.border = "none";
  closeBtn.style.fontSize = "18px";
  closeBtn.style.cursor = "pointer";
  closeBtn.style.lineHeight = "1";
  closeBtn.style.padding = "0 4px";
  closeBtn.addEventListener("click", () => overlay.remove());
  header.appendChild(closeBtn);
  card.appendChild(header);

  const table = doc.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";
  table.style.fontSize = "12px";
  card.appendChild(table);

  type SortKey = "date" | "round" | "score" | "country" | "result" | "duration" | "damage" | "movement" | "game_mode" | "mate";
  type SortDir = "asc" | "desc";
  const defaultSortDir: Record<SortKey, SortDir> = {
    date: "desc",
    round: "desc",
    score: "desc",
    country: "asc",
    result: "desc",
    duration: "desc",
    damage: "desc",
    movement: "asc",
    game_mode: "asc",
    mate: "asc"
  };
  const sortLabel = (label: string, active: boolean, dir: SortDir): string => (active ? `${label} ${dir === "asc" ? "^" : "v"}` : label);
  let sortKey: SortKey = "date";
  let sortDir: SortDir = "desc";
  const sortable = options?.sortable !== false;
  const selectedColumns = new Set((options?.columns || []).map((x) => x.trim().toLowerCase()).filter(Boolean));
  const selectedColored = new Set((options?.colored || []).map((x) => x.trim().toLowerCase()).filter(Boolean));
  const selectedClickable = new Set((options?.clickable || []).map((x) => x.trim().toLowerCase()).filter(Boolean));

  const hasOpponentItems = options?.drilldownType
    ? options.drilldownType === "players"
    : drilldown.some((d) => typeof d.opponentId === "string" || typeof d.opponentName === "string");
  const movementValues = [...new Set(drilldown.map((d) => d.movement).filter((x): x is string => typeof x === "string" && x.trim().length > 0))];
  const modeValues = [...new Set(drilldown.map((d) => d.gameMode).filter((x): x is string => typeof x === "string" && x.trim().length > 0))];
  const showMovement = movementValues.length > 1;
  const showGameMode = modeValues.length > 1;
  const showMate = drilldown.some((d) => typeof d.teammate === "string" && d.teammate.trim().length > 0);
  const showDuration = drilldown.some((d) => typeof d.guessDurationSec === "number" && Number.isFinite(d.guessDurationSec));
  const showDamage = drilldown.some((d) => typeof d.damage === "number" && Number.isFinite(d.damage));
  const showGuessMaps = drilldown.some((d) => typeof d.googleMapsUrl === "string" && d.googleMapsUrl.length > 0);
  const showStreetView = drilldown.some((d) => typeof d.streetViewUrl === "string" && d.streetViewUrl.length > 0);

  type DrillColumn = {
    key: string;
    label: string;
    sortKey?: SortKey;
    width?: string;
    muted?: boolean;
    render: (item: AnalysisDrilldownItem) => HTMLElement;
  };

  const mkTextCell = (text: string, muted = false): HTMLElement => {
    const span = doc.createElement("span");
    span.textContent = text;
    if (muted) span.style.color = palette.textMuted;
    return span;
  };

  const mkLinkCell = (url?: string): HTMLElement => {
    if (!url) return mkTextCell("-", true);
    const a = doc.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "Open";
    a.style.color = analysisSettings.accent;
    return a;
  };

  const columns: DrillColumn[] = [{ key: "date", label: "Date", sortKey: sortable ? "date" : undefined, width: "150px", render: (item) => mkTextCell(formatDrilldownDate(item.ts)) }];
  if (hasOpponentItems) {
    columns.push({
      key: "opponent",
      label: "Opponent",
      width: "180px",
      render: (item) => {
        const name = item.opponentName || (item.opponentId ? shortGameId(item.opponentId) : "-");
        const canClickOpponent = selectedClickable.size === 0 || selectedClickable.has("opponent") || selectedClickable.has("player");
        if (canClickOpponent && item.opponentProfileUrl) {
          const a = doc.createElement("a");
          a.href = item.opponentProfileUrl;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = name;
          a.style.color = analysisSettings.accent;
          return a;
        }
        return mkTextCell(name, !item.opponentName);
      }
    });
    columns.push({
      key: "result",
      label: "Result",
      sortKey: sortable ? "result" : undefined,
      width: "80px",
      render: (item) => {
        const span = mkTextCell(item.result === "W" ? "Win" : item.result === "L" ? "Loss" : item.result === "T" ? "Tie" : "-", !item.result);
        if (selectedColored.has("result")) {
          const val = item.result;
          if (val === "W") span.style.color = "#22c55e";
          else if (val === "L") span.style.color = "#ef4444";
          else if (val === "T") span.style.color = palette.textMuted;
        }
        return span;
      }
    });
    columns.push({
      key: "matchups",
      label: "Match-ups",
      width: "90px",
      render: (item) => mkTextCell(typeof item.matchups === "number" ? String(item.matchups) : "-", typeof item.matchups !== "number")
    });
    columns.push({
      key: "country",
      label: "Country",
      sortKey: sortable ? "country" : undefined,
      width: "160px",
      render: (item) => mkTextCell(item.opponentCountry || countryNameFromCode(item.trueCountry))
    });
    if (showGameMode) columns.push({ key: "game_mode", label: "Game Mode", sortKey: sortable ? "game_mode" : undefined, width: "110px", render: (item) => mkTextCell(item.gameMode || "-", !item.gameMode) });
  } else {
    columns.push({
      key: "result",
      label: "Result",
      sortKey: sortable ? "result" : undefined,
      width: "80px",
      render: (item) => {
        const span = mkTextCell(item.result === "W" ? "Win" : item.result === "L" ? "Loss" : item.result === "T" ? "Tie" : "-", !item.result);
        if (selectedColored.has("result")) {
          const val = item.result;
          if (val === "W") span.style.color = "#22c55e";
          else if (val === "L") span.style.color = "#ef4444";
          else if (val === "T") span.style.color = palette.textMuted;
        }
        return span;
      }
    });
    columns.push({ key: "round", label: "Round", sortKey: sortable ? "round" : undefined, width: "70px", render: (item) => mkTextCell(String(item.roundNumber)) });
    columns.push({
      key: "score",
      label: "Score",
      sortKey: sortable ? "score" : undefined,
      width: "80px",
      render: (item) => {
        const span = mkTextCell(typeof item.score === "number" ? String(Math.round(item.score)) : "-");
        if (selectedColored.has("score") && typeof item.score === "number") {
          span.style.color = item.score >= 4500 ? "#22c55e" : item.score < 500 ? "#ef4444" : palette.text;
          span.style.fontWeight = "700";
        }
        return span;
      }
    });
    columns.push({ key: "country", label: "Country", sortKey: sortable ? "country" : undefined, width: "160px", render: (item) => mkTextCell(countryNameFromCode(item.trueCountry)) });
    if (showDuration) columns.push({ key: "duration", label: "Guess Duration", sortKey: sortable ? "duration" : undefined, width: "120px", render: (item) => mkTextCell(formatGuessDuration(item.guessDurationSec)) });
    if (showDamage) {
      columns.push({
        key: "damage",
        label: "Damage",
        sortKey: sortable ? "damage" : undefined,
        width: "90px",
        render: (item) => {
          const span = mkTextCell(formatDamageValue(item.damage), typeof item.damage !== "number");
          if (typeof item.damage === "number" && Number.isFinite(item.damage)) {
            span.style.fontWeight = "700";
            span.style.color = item.damage > 0 ? "#22c55e" : item.damage < 0 ? "#ef4444" : palette.textMuted;
          }
          return span;
        }
      });
    }
    if (showMovement) columns.push({ key: "movement", label: "Movement", sortKey: sortable ? "movement" : undefined, width: "110px", render: (item) => mkTextCell(item.movement || "-", !item.movement) });
    if (showGameMode) columns.push({ key: "game_mode", label: "Game Mode", sortKey: sortable ? "game_mode" : undefined, width: "110px", render: (item) => mkTextCell(item.gameMode || "-", !item.gameMode) });
    if (showMate) columns.push({ key: "mate", label: "Mate", sortKey: sortable ? "mate" : undefined, width: "130px", render: (item) => mkTextCell(item.teammate || "-", !item.teammate) });
  }
  columns.push({
    key: "game",
    label: "Game",
    width: "120px",
    muted: true,
    render: (item) => {
      const span = mkTextCell(shortGameId(item.gameId), true);
      span.title = item.gameId;
      return span;
    }
  });
  if (!hasOpponentItems && showGuessMaps) columns.push({ key: "guess_maps", label: "Guess Maps", width: "110px", render: (item) => mkLinkCell(item.googleMapsUrl) });
  if (!hasOpponentItems && showStreetView) columns.push({ key: "street_view", label: "True Street View", width: "130px", render: (item) => mkLinkCell(item.streetViewUrl) });
  const visibleColumns = selectedColumns.size > 0 ? columns.filter((c) => selectedColumns.has(c.key.toLowerCase())) : columns;

  const thead = doc.createElement("thead");
  const headRow = doc.createElement("tr");
  const thBySort = new Map<SortKey, HTMLTableCellElement>();
  for (const col of visibleColumns) {
    const th = doc.createElement("th");
    th.textContent = col.label;
    th.style.textAlign = "left";
    th.style.padding = "7px 8px";
    th.style.borderBottom = `1px solid ${palette.border}`;
    th.style.color = palette.textMuted;
    th.style.position = "sticky";
    th.style.top = "0";
    th.style.background = palette.panel;
    if (col.width) th.style.minWidth = col.width;
    if (col.sortKey && sortable) {
      th.style.cursor = "pointer";
      th.style.userSelect = "none";
      const colSortKey = col.sortKey;
      thBySort.set(colSortKey, th);
      th.addEventListener("click", () => {
        if (sortKey === colSortKey) {
          sortDir = sortDir === "asc" ? "desc" : "asc";
        } else {
          sortKey = colSortKey;
          sortDir = defaultSortDir[colSortKey];
        }
        shown = 0;
        renderRows(true);
      });
    }
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = doc.createElement("tbody");
  table.appendChild(tbody);
  const getSortedItems = (): AnalysisDrilldownItem[] => {
    const items = drilldown.slice();
    items.sort((a, b) => {
      if (sortKey === "date") {
        const av = typeof a.ts === "number" ? a.ts : Number.NEGATIVE_INFINITY;
        const bv = typeof b.ts === "number" ? b.ts : Number.NEGATIVE_INFINITY;
        return sortDir === "asc" ? av - bv : bv - av;
      }
      if (sortKey === "round") {
        const av = Number.isFinite(a.roundNumber) ? a.roundNumber : Number.NEGATIVE_INFINITY;
        const bv = Number.isFinite(b.roundNumber) ? b.roundNumber : Number.NEGATIVE_INFINITY;
        return sortDir === "asc" ? av - bv : bv - av;
      }
      if (sortKey === "score") {
        const av = typeof a.score === "number" ? a.score : Number.NEGATIVE_INFINITY;
        const bv = typeof b.score === "number" ? b.score : Number.NEGATIVE_INFINITY;
        return sortDir === "asc" ? av - bv : bv - av;
      }
      if (sortKey === "result") {
        const rv = (r?: AnalysisDrilldownItem["result"]) => (r === "W" ? 3 : r === "T" ? 2 : r === "L" ? 1 : 0);
        const av = rv(a.result);
        const bv = rv(b.result);
        return sortDir === "asc" ? av - bv : bv - av;
      }
      if (sortKey === "duration") {
        const av = typeof a.guessDurationSec === "number" ? a.guessDurationSec : Number.NEGATIVE_INFINITY;
        const bv = typeof b.guessDurationSec === "number" ? b.guessDurationSec : Number.NEGATIVE_INFINITY;
        return sortDir === "asc" ? av - bv : bv - av;
      }
      if (sortKey === "damage") {
        const av = typeof a.damage === "number" ? a.damage : Number.NEGATIVE_INFINITY;
        const bv = typeof b.damage === "number" ? b.damage : Number.NEGATIVE_INFINITY;
        return sortDir === "asc" ? av - bv : bv - av;
      }
      if (sortKey === "movement") {
        const av = (a.movement || "").toLowerCase();
        const bv = (b.movement || "").toLowerCase();
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      if (sortKey === "game_mode") {
        const av = (a.gameMode || "").toLowerCase();
        const bv = (b.gameMode || "").toLowerCase();
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      if (sortKey === "mate") {
        const av = (a.teammate || "").toLowerCase();
        const bv = (b.teammate || "").toLowerCase();
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const av = (a.opponentCountry || countryNameFromCode(a.trueCountry)).toLowerCase();
      const bv = (b.opponentCountry || countryNameFromCode(b.trueCountry)).toLowerCase();
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    return items;
  };
  const updateHeaderLabels = () => {
    const dateTh = thBySort.get("date");
    const roundTh = thBySort.get("round");
    const scoreTh = thBySort.get("score");
    const countryTh = thBySort.get("country");
    const resultTh = thBySort.get("result");
    const durationTh = thBySort.get("duration");
    const damageTh = thBySort.get("damage");
    const movementTh = thBySort.get("movement");
    const gameModeTh = thBySort.get("game_mode");
    const mateTh = thBySort.get("mate");
    if (dateTh) dateTh.textContent = sortLabel("Date", sortKey === "date", sortDir);
    if (roundTh) roundTh.textContent = sortLabel("Round", sortKey === "round", sortDir);
    if (scoreTh) scoreTh.textContent = sortLabel("Score", sortKey === "score", sortDir);
    if (countryTh) countryTh.textContent = sortLabel("Country", sortKey === "country", sortDir);
    if (resultTh) resultTh.textContent = sortLabel("Result", sortKey === "result", sortDir);
    if (durationTh) durationTh.textContent = sortLabel("Guess Duration", sortKey === "duration", sortDir);
    if (damageTh) damageTh.textContent = sortLabel("Damage", sortKey === "damage", sortDir);
    if (movementTh) movementTh.textContent = sortLabel("Movement", sortKey === "movement", sortDir);
    if (gameModeTh) gameModeTh.textContent = sortLabel("Game Mode", sortKey === "game_mode", sortDir);
    if (mateTh) mateTh.textContent = sortLabel("Mate", sortKey === "mate", sortDir);
  };
  let shown = 0;
  const pageSize = 60;
  const renderRows = (resetBody = false) => {
    const sorted = getSortedItems();
    if (resetBody) tbody.innerHTML = "";
    const next = Math.min(sorted.length, shown + pageSize);
    for (let i = shown; i < next; i++) {
      const item = sorted[i];
      const tr = doc.createElement("tr");
      const nextItem = sorted[i + 1];
      tr.style.borderBottom = nextItem && nextItem.gameId === item.gameId ? "none" : `1px solid ${palette.border}`;
      for (const col of visibleColumns) {
        const td = doc.createElement("td");
        td.style.padding = "6px 8px";
        if (col.width) td.style.minWidth = col.width;
        if (col.muted) td.style.color = palette.textMuted;
        td.appendChild(col.render(item));
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    shown = next;
    if (shown >= sorted.length) {
      moreBtn.remove();
    } else {
      if (!moreBtn.isConnected) card.appendChild(moreBtn);
      moreBtn.textContent = `Show more (${sorted.length - shown} left)`;
    }
    updateHeaderLabels();
  };
  const moreBtn = doc.createElement("button");
  moreBtn.textContent = "";
  moreBtn.style.marginTop = "10px";
  moreBtn.style.background = palette.buttonBg;
  moreBtn.style.color = palette.buttonText;
  moreBtn.style.border = `1px solid ${palette.border}`;
  moreBtn.style.borderRadius = "6px";
  moreBtn.style.padding = "5px 10px";
  moreBtn.style.cursor = "pointer";
  moreBtn.style.fontSize = "12px";
  moreBtn.addEventListener("click", () => renderRows(false));
  card.appendChild(moreBtn);
  renderRows(true);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) overlay.remove();
  });
  overlay.appendChild(card);
  doc.body.appendChild(overlay);
}
function openBarDrilldownOverlay(
  doc: Document,
  title: string,
  barLabel: string,
  bars: AnalysisBarPoint[],
  barIndex: number,
  options?: DrilldownOverlayOptions
): void {
  const bar = bars[barIndex];
  const drilldown = bar?.drilldown || [];
  if (!bar || drilldown.length === 0) return;
  openDrilldownOverlay(doc, title, barLabel, drilldown, options);
}

function createChartActions(svg: SVGSVGElement, title: string): HTMLElement {
  const palette = getThemePalette();
  const doc = svg.ownerDocument;
  const hostWindow = doc.defaultView ?? window;
  const row = doc.createElement("div");
  row.style.display = "flex";
  row.style.justifyContent = "flex-end";
  row.style.gap = "6px";
  row.style.marginBottom = "6px";

  function mkBtn(label: string, onClick: () => void): HTMLButtonElement {
    const b = doc.createElement("button");
    b.textContent = label;
    b.style.background = palette.buttonBg;
    b.style.color = palette.buttonText;
    b.style.border = `1px solid ${palette.border}`;
    b.style.borderRadius = "6px";
    b.style.padding = "3px 7px";
    b.style.fontSize = "11px";
    b.style.cursor = "pointer";
    b.addEventListener("click", onClick);
    return b;
  }

  row.appendChild(mkBtn("Zoom", () => openZoomOverlay(svg, title)));
  row.appendChild(mkBtn("New Tab", () => openChartInNewTab(svg, title, hostWindow)));
  row.appendChild(mkBtn("Save SVG", () => void downloadSvg(svg, title)));
  row.appendChild(mkBtn("Save PNG", () => void downloadPng(svg, title)));
  return row;
}

function aggregateLinePoints(points: Array<{ x: number; y: number; label?: string }>): Array<{ x: number; y: number; label?: string }> {
  if (points.length <= 120) return points;
  const sorted = points.slice().sort((a, b) => a.x - b.x);
  const span = Math.max(1, sorted[sorted.length - 1].x - sorted[0].x);
  const spanDays = span / (24 * 60 * 60 * 1000);
  let bucketMs = 24 * 60 * 60 * 1000;
  if (spanDays > 365 * 2) bucketMs = 30 * 24 * 60 * 60 * 1000;
  else if (spanDays > 365) bucketMs = 14 * 24 * 60 * 60 * 1000;
  else if (spanDays > 120) bucketMs = 7 * 24 * 60 * 60 * 1000;
  else if (spanDays > 31) bucketMs = 2 * 24 * 60 * 60 * 1000;

  const buckets = new Map<number, { sumY: number; n: number; x: number; label?: string }>();
  for (const p of sorted) {
    const key = Math.floor(p.x / bucketMs) * bucketMs;
    const cur = buckets.get(key) || { sumY: 0, n: 0, x: p.x, label: p.label };
    cur.sumY += p.y;
    cur.n += 1;
    cur.x = p.x;
    cur.label = p.label;
    buckets.set(key, cur);
  }

  let out: Array<{ x: number; y: number; label?: string }> = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) =>
      v.label !== undefined ? { x: v.x, y: v.sumY / Math.max(1, v.n), label: v.label } : { x: v.x, y: v.sumY / Math.max(1, v.n) }
    );

  const hardLimit = 180;
  if (out.length > hardLimit) {
    const stride = Math.ceil(out.length / hardLimit);
    const compressed: Array<{ x: number; y: number; label?: string }> = [];
    for (let i = 0; i < out.length; i += stride) {
      const chunk = out.slice(i, i + stride);
      const avgY = chunk.reduce((acc, p) => acc + p.y, 0) / Math.max(1, chunk.length);
      const last = chunk[chunk.length - 1];
      compressed.push(last.label !== undefined ? { x: last.x, y: avgY, label: last.label } : { x: last.x, y: avgY });
    }
    out = compressed;
  }
  return out.length > 1 ? out : points;
}

function renderLineChart(
  chart: Extract<AnalysisChart, { type: "line" }>,
  title: string,
  doc: Document,
  graphCfg?: DesignGraphTemplate
): HTMLElement {
  const palette = getThemePalette();
  const chartWrap = doc.createElement("div");
  chartWrap.style.marginBottom = "8px";
  chartWrap.style.border = `1px solid ${palette.border}`;
  chartWrap.style.borderRadius = "8px";
  chartWrap.style.background = palette.panelAlt;
  chartWrap.style.padding = "6px";
  const chartHeading = doc.createElement("div");
  chartHeading.textContent = title;
  chartHeading.style.fontSize = "12px";
  chartHeading.style.color = palette.textMuted;
  chartHeading.style.margin = "2px 4px 6px";
  chartWrap.appendChild(chartHeading);

  const colorPalette = [
    analysisSettings.accent,
    "#ff6b6b",
    "#22c55e",
    "#f59e0b",
    "#a78bfa",
    "#06b6d4",
    "#f97316",
    "#84cc16",
    "#e879f9",
    "#60a5fa"
  ];
  const baseSeries =
    chart.series && chart.series.length > 0
      ? chart.series
      : [{ key: "main", label: chart.yLabel || title, points: chart.points }];
  const series = baseSeries
    .map((s, idx) => ({
      ...s,
      color: colorPalette[idx % colorPalette.length],
      points: aggregateLinePoints(s.points)
    }))
    .filter((s) => s.points.length > 1);
  if (series.length === 0) return chartWrap;

  const allPoints = series.flatMap((s) => s.points);
  const w = 1500;
  const h = 300;
  const ml = 60;
  const mr = 20;
  const mt = 16;
  const mb = 42;
  const minX = Math.min(...allPoints.map((p) => p.x));
  const maxX = Math.max(...allPoints.map((p) => p.x));
  const minY = Math.min(...allPoints.map((p) => p.y));
  const maxY = Math.max(...allPoints.map((p) => p.y));
  const xSpan = Math.max(1, maxX - minX);
  const ySpan = Math.max(1, maxY - minY);
  const mapX = (x: number) => ml + ((x - minX) / xSpan) * (w - ml - mr);
  const mapY = (y: number) => h - mb - ((y - minY) / ySpan) * (h - mt - mb);

  let lineMarkup = "";
  let pointMarkup = "";
  for (let i = 0; i < series.length; i++) {
    const s = series[i];
    const poly = s.points.map((p) => `${mapX(p.x).toFixed(2)},${mapY(p.y).toFixed(2)}`).join(" ");
    lineMarkup += `<polyline class="ga-line-main ga-line-${i}" fill="none" stroke="${s.color}" stroke-width="${
      series.length > 1 ? 2.4 : 3
    }" points="${poly}"><title>${escapeSvgText(`${s.label} (${title})`)}</title></polyline>`;
    pointMarkup += s.points
      .map((p) => {
        const x = mapX(p.x).toFixed(2);
        const y = mapY(p.y).toFixed(2);
        const label = p.label ? `${p.label} - ` : "";
        const value = Number.isFinite(p.y) ? (Math.abs(p.y) >= 100 ? p.y.toFixed(1) : p.y.toFixed(2)) : String(p.y);
        const tip = escapeSvgText(`${s.label}: ${label}${value}`);
        return `<circle class="ga-line-point ga-line-point-${i}" cx="${x}" cy="${y}" r="${
          series.length > 1 ? 2 : 2.5
        }" fill="${s.color}"><title>${tip}</title></circle>`;
      })
      .join("");
  }

  const yMid = (minY + maxY) / 2;
  const startCandidates = allPoints.filter((p) => p.x === minX);
  const endCandidates = allPoints.filter((p) => p.x === maxX);
  const xStartLabel = startCandidates.find((p) => p.label)?.label || "";
  const xEndLabel = endCandidates.find((p) => p.label)?.label || "";
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "300");
  const lineHoverCss = graphCfg?.hoverable === false ? "" : `.ga-line-main:hover { stroke-width: 4; opacity: 1; }`;
  const pointHoverCss = graphCfg?.hoverable === false ? "" : `.ga-line-point:hover { r: 5; opacity: 1; }`;
  svg.innerHTML = `
    <style>
      .ga-line-main { transition: stroke-width .12s ease, opacity .12s ease; }
      ${lineHoverCss}
      .ga-line-point { transition: r .12s ease, opacity .12s ease; opacity: .72; }
      ${pointHoverCss}
    </style>
    <line x1="${ml}" y1="${h - mb}" x2="${w - mr}" y2="${h - mb}" stroke="${palette.axis}" stroke-width="1"/>
    <line x1="${ml}" y1="${mt}" x2="${ml}" y2="${h - mb}" stroke="${palette.axis}" stroke-width="1"/>
    ${lineMarkup}
    ${pointMarkup}
    <text x="${ml - 6}" y="${mapY(maxY) + 4}" text-anchor="end" font-size="10" fill="${palette.textMuted}">${Math.round(maxY)}</text>
    <text x="${ml - 6}" y="${mapY(yMid) + 4}" text-anchor="end" font-size="10" fill="${palette.textMuted}">${Math.round(yMid)}</text>
    <text x="${ml - 6}" y="${mapY(minY) + 4}" text-anchor="end" font-size="10" fill="${palette.textMuted}">${Math.round(minY)}</text>
    <text x="${ml}" y="${h - 8}" text-anchor="start" font-size="12" fill="${palette.textMuted}">${xStartLabel}</text>
    <text x="${w - mr}" y="${h - 8}" text-anchor="end" font-size="12" fill="${palette.textMuted}">${xEndLabel}</text>
  `;
  chartWrap.appendChild(createChartActions(svg, title));
  chartWrap.appendChild(svg);
  if (series.length > 1) {
    const legend = doc.createElement("div");
    legend.style.display = "flex";
    legend.style.flexWrap = "wrap";
    legend.style.gap = "8px 12px";
    legend.style.margin = "6px 4px 2px";
    for (const s of series) {
      const item = doc.createElement("div");
      item.style.display = "inline-flex";
      item.style.alignItems = "center";
      item.style.gap = "6px";
      item.style.fontSize = "11px";
      item.style.color = palette.textMuted;
      const swatch = doc.createElement("span");
      swatch.style.width = "10px";
      swatch.style.height = "10px";
      swatch.style.borderRadius = "2px";
      swatch.style.background = s.color;
      item.appendChild(swatch);
      item.appendChild(doc.createTextNode(s.label));
      legend.appendChild(item);
    }
    chartWrap.appendChild(legend);
  }
  return chartWrap;
}

function renderBarChart(
  chart: Extract<AnalysisChart, { type: "bar" }>,
  title: string,
  doc: Document,
  graphCfg?: DesignGraphTemplate
): HTMLElement {
  const palette = getThemePalette();
  const chartWrap = doc.createElement("div");
  chartWrap.style.marginBottom = "8px";
  chartWrap.style.border = `1px solid ${palette.border}`;
  chartWrap.style.borderRadius = "8px";
  chartWrap.style.background = palette.panelAlt;
  chartWrap.style.padding = "6px";
  const chartHeading = doc.createElement("div");
  chartHeading.textContent = title;
  chartHeading.style.fontSize = "12px";
  chartHeading.style.color = palette.textMuted;
  chartHeading.style.margin = "2px 4px 6px";
  chartWrap.appendChild(chartHeading);

  const allBars = chart.bars.slice(0, 240);
  const isScoreDistribution = /score distribution/i.test(title);
  const requestedInitial = graphCfg?.initialBars === "max" ? allBars.length : graphCfg?.initialBars;
  const initialBars = Math.max(1, Math.min((typeof requestedInitial === "number" ? requestedInitial : chart.initialBars) ?? 40, allBars.length || 1));
  let expanded = isScoreDistribution ? true : allBars.length <= initialBars;
  if (graphCfg?.expandable === false) expanded = true;
  const content = doc.createElement("div");
  chartWrap.appendChild(content);

  const render = () => {
    content.innerHTML = "";
    const bars = expanded ? allBars : allBars.slice(0, initialBars);
    const horizontal = chart.orientation === "horizontal" || /avg score by country/i.test(title);
    const w = 1700;
    const accent = analysisSettings.accent;
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "100%");
    if (horizontal) {
      const rowH = 16;
      const barH = 14;
      const ml = 250;
      const mr = 22;
      const mt = 6;
      const mb = 10;
      const contentHeight = mt + mb + bars.length * rowH;
      const defaultMinHeight = Math.max(80, contentHeight);
      const requestedMinHeight = (chart as Extract<AnalysisChart, { type: "bar" }>).minHeight;
      const h = Math.max(typeof requestedMinHeight === "number" ? requestedMinHeight : defaultMinHeight, contentHeight);
      const maxY = Math.max(1, ...bars.map((b) => b.value));
      const innerW = w - ml - mr;
      const rects = bars
        .map((b, i) => {
          const y = mt + i * rowH + (rowH - barH) / 2;
          const bw = (b.value / maxY) * innerW;
          const label = b.label.length > 34 ? `${b.label.slice(0, 34)}..` : b.label;
          const tip = escapeSvgText(`${b.label}: ${Number.isFinite(b.value) ? b.value.toFixed(2) : b.value}`);
          return `
            <text x="${ml - 8}" y="${(y + barH / 2 + 3).toFixed(2)}" text-anchor="end" font-size="11" fill="${palette.textMuted}">${label}</text>
            <rect class="ga-bar" data-bar-index="${i}" x="${ml}" y="${y.toFixed(2)}" width="${bw.toFixed(2)}" height="${barH}" fill="${accent}" opacity="0.85">
              <title>${tip}</title>
            </rect>
          `;
        })
        .join("");
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      svg.setAttribute("height", `${h}`);
      const hoverCss = graphCfg?.hoverable === false ? "" : `.ga-bar:hover { opacity: 1; filter: brightness(1.15); }`;
      svg.innerHTML = `
        <style>
          .ga-bar { transition: opacity .12s ease, filter .12s ease; }
          ${hoverCss}
        </style>
        <line x1="${ml}" y1="${mt}" x2="${ml}" y2="${h - mb}" stroke="${palette.axis}" stroke-width="1"/>
        <line x1="${ml}" y1="${h - mb}" x2="${w - mr}" y2="${h - mb}" stroke="${palette.axis}" stroke-width="1"/>
        <text x="${ml}" y="${h - 4}" text-anchor="start" font-size="10" fill="${palette.textMuted}">0</text>
        <text x="${w - mr}" y="${h - 4}" text-anchor="end" font-size="10" fill="${palette.textMuted}">${Math.round(maxY)}</text>
        ${rects}
      `;
    } else {
      const h = 320;
      const ml = 52;
      const mr = 16;
      const mt = 14;
      const mb = 80;
      const maxY = Math.max(1, ...bars.map((b) => b.value));
      const innerW = w - ml - mr;
      const innerH = h - mt - mb;
      const step = bars.length > 0 ? innerW / bars.length : innerW;
      const bw = Math.max(4, step * 0.66);
      const rects = bars
        .map((b, i) => {
          const x = ml + i * step + (step - bw) / 2;
          const bh = (b.value / maxY) * innerH;
          const y = mt + innerH - bh;
          const label = isScoreDistribution ? (i === 0 ? "0" : i === bars.length - 1 ? "5000" : "") : b.label.length > 14 ? `${b.label.slice(0, 14)}..` : b.label;
          const tip = escapeSvgText(`${b.label}: ${Number.isFinite(b.value) ? b.value.toFixed(2) : b.value}`);
          return `
            <rect class="ga-bar" data-bar-index="${i}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${bw.toFixed(2)}" height="${bh.toFixed(2)}" fill="${accent}" opacity="0.85">
              <title>${tip}</title>
            </rect>
            <text x="${(x + bw / 2).toFixed(2)}" y="${h - mb + 16}" text-anchor="middle" font-size="11" fill="${palette.textMuted}">${label}</text>
          `;
        })
        .join("");
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      svg.setAttribute("height", "320");
      const hoverCss = graphCfg?.hoverable === false ? "" : `.ga-bar:hover { opacity: 1; filter: brightness(1.15); }`;
      svg.innerHTML = `
        <style>
          .ga-bar { transition: opacity .12s ease, filter .12s ease; }
          ${hoverCss}
        </style>
        <line x1="${ml}" y1="${h - mb}" x2="${w - mr}" y2="${h - mb}" stroke="${palette.axis}" stroke-width="1"/>
        <line x1="${ml}" y1="${mt}" x2="${ml}" y2="${h - mb}" stroke="${palette.axis}" stroke-width="1"/>
        <text x="${ml - 5}" y="${mt + 4}" text-anchor="end" font-size="10" fill="${palette.textMuted}">${Math.round(maxY)}</text>
        <text x="${ml - 5}" y="${h - mb + 4}" text-anchor="end" font-size="10" fill="${palette.textMuted}">0</text>
        ${rects}
      `;
    }
    content.appendChild(createChartActions(svg, title));
    if (!isScoreDistribution && graphCfg?.expandable !== false && allBars.length > initialBars) {
      const toggle = doc.createElement("button");
      toggle.textContent = expanded ? "Show less" : `Show all (${allBars.length})`;
      toggle.style.background = palette.buttonBg;
      toggle.style.color = palette.buttonText;
      toggle.style.border = `1px solid ${palette.border}`;
      toggle.style.borderRadius = "6px";
      toggle.style.padding = "3px 8px";
      toggle.style.fontSize = "11px";
      toggle.style.cursor = "pointer";
      toggle.style.marginBottom = "6px";
      toggle.addEventListener("click", () => {
        expanded = !expanded;
        render();
      });
      content.appendChild(toggle);
    }
    content.appendChild(svg);
    const clickableBars = svg.querySelectorAll<SVGRectElement>(".ga-bar[data-bar-index]");
    clickableBars.forEach((rect) => {
      const idx = Number(rect.getAttribute("data-bar-index"));
      const bar = bars[idx];
      if (!Number.isFinite(idx) || !bar || !bar.drilldown || bar.drilldown.length === 0) return;
      if (graphCfg?.clickable === false) return;
      rect.style.cursor = "pointer";
      rect.addEventListener("click", () =>
        openBarDrilldownOverlay(doc, title, bar.label, bars, idx, {
          drilldownType: graphCfg?.drilldownType,
          columns: graphCfg?.drilldownColumns,
          colored: graphCfg?.drilldownColored,
          clickable: graphCfg?.drilldownClickable,
          sortable: graphCfg?.sortable !== false
        })
      );
    });
  };
  render();
  return chartWrap;
}

function renderSelectableBarChart(
  chart: Extract<AnalysisChart, { type: "selectableBar" }>,
  title: string,
  doc: Document,
  graphCfg?: DesignGraphTemplate
): HTMLElement {
  const palette = getThemePalette();
  const allowSort = graphCfg?.sortable !== false && chart.allowSort !== false;
  const configuredSorts = Array.isArray((chart as unknown as { sorts?: string[] }).sorts)
    ? ((chart as unknown as { sorts?: string[] }).sorts as string[])
        .filter((s): s is "chronological" | "desc" | "asc" => s === "chronological" || s === "desc" || s === "asc")
    : ["chronological", "desc", "asc"];
  const selectableSorts = configuredSorts.length > 0 ? configuredSorts : ["chronological", "desc", "asc"];
  const wrap = doc.createElement("div");
  wrap.style.marginBottom = "8px";
  wrap.style.border = `1px solid ${palette.border}`;
  wrap.style.borderRadius = "8px";
  wrap.style.background = palette.panelAlt;
  wrap.style.padding = "6px";

  const head = doc.createElement("div");
  head.style.display = "flex";
  head.style.flexWrap = "wrap";
  head.style.alignItems = "center";
  head.style.gap = "8px";
  head.style.margin = "2px 4px 6px";
  wrap.appendChild(head);

  const heading = doc.createElement("div");
  heading.textContent = title;
  heading.style.fontSize = "12px";
  heading.style.fontWeight = "700";
  heading.style.color = palette.textMuted;
  head.appendChild(heading);

  const metricSelect = doc.createElement("select");
  metricSelect.style.background = palette.buttonBg;
  metricSelect.style.color = palette.buttonText;
  metricSelect.style.border = `1px solid ${palette.border}`;
  metricSelect.style.borderRadius = "7px";
  metricSelect.style.padding = "2px 6px";
  metricSelect.style.fontSize = "11px";
  for (const o of chart.options) {
    const opt = doc.createElement("option");
    opt.value = o.key;
    opt.textContent = o.label;
    metricSelect.appendChild(opt);
  }
  metricSelect.value = chart.defaultMetricKey && chart.options.some((o) => o.key === chart.defaultMetricKey) ? chart.defaultMetricKey : chart.options[0]?.key || "";
  head.appendChild(metricSelect);

  let sortSelect: HTMLSelectElement | null = null;
  if (allowSort) {
    sortSelect = doc.createElement("select");
    sortSelect.style.background = palette.buttonBg;
    sortSelect.style.color = palette.buttonText;
    sortSelect.style.border = `1px solid ${palette.border}`;
    sortSelect.style.borderRadius = "7px";
    sortSelect.style.padding = "2px 6px";
    sortSelect.style.fontSize = "11px";
    for (const key of selectableSorts) {
      const opt = doc.createElement("option");
      opt.value = key;
      opt.textContent = key === "chronological" ? "Chronological" : key === "desc" ? "Descending" : "Ascending";
      sortSelect.appendChild(opt);
    }
    sortSelect.value = chart.defaultSort || "chronological";
    head.appendChild(sortSelect);
  }

  const content = doc.createElement("div");
  wrap.appendChild(content);

  const render = () => {
    content.innerHTML = "";
    const selected = chart.options.find((o) => o.key === metricSelect.value) || chart.options[0];
    if (!selected) return;
    let bars = selected.bars.slice();
    if (allowSort && sortSelect?.value === "desc") bars.sort((a, b) => b.value - a.value);
    else if (allowSort && sortSelect?.value === "asc") bars.sort((a, b) => a.value - b.value);
    const barChart: Extract<AnalysisChart, { type: "bar" }> = {
      type: "bar",
      yLabel: selected.label,
      initialBars: (graphCfg?.initialBars as number | undefined) ?? chart.initialBars ?? 10,
      orientation: graphCfg?.orientation || chart.orientation || "horizontal",
      minHeight: chart.minHeight,
      bars
    };
    content.appendChild(renderBarChart(barChart, `${title} - ${selected.label}`, doc, graphCfg));
  };

  metricSelect.addEventListener("change", render);
  if (sortSelect) sortSelect.addEventListener("change", render);
  render();
  return wrap;
}

function renderSelectableLineChart(
  chart: Extract<AnalysisChart, { type: "selectableLine" }>,
  title: string,
  doc: Document,
  graphCfg?: DesignGraphTemplate
): HTMLElement {
  const palette = getThemePalette();
  const maxCompare = Math.max(1, Math.min(chart.maxCompare ?? 4, 4));
  const wrap = doc.createElement("div");
  wrap.style.marginBottom = "8px";
  wrap.style.border = `1px solid ${palette.border}`;
  wrap.style.borderRadius = "8px";
  wrap.style.background = palette.panelAlt;
  wrap.style.padding = "6px";

  const head = doc.createElement("div");
  head.style.display = "flex";
  head.style.flexWrap = "wrap";
  head.style.alignItems = "center";
  head.style.gap = "8px";
  head.style.margin = "2px 4px 6px";
  wrap.appendChild(head);

  const heading = doc.createElement("div");
  heading.textContent = title;
  heading.style.fontSize = "12px";
  heading.style.fontWeight = "700";
  heading.style.color = palette.textMuted;
  head.appendChild(heading);

  const metricSelect = doc.createElement("select");
  metricSelect.style.background = palette.buttonBg;
  metricSelect.style.color = palette.buttonText;
  metricSelect.style.border = `1px solid ${palette.border}`;
  metricSelect.style.borderRadius = "7px";
  metricSelect.style.padding = "2px 6px";
  metricSelect.style.fontSize = "11px";
  for (const o of chart.options) {
    const opt = doc.createElement("option");
    opt.value = o.key;
    opt.textContent = o.label;
    metricSelect.appendChild(opt);
  }
  metricSelect.value = chart.defaultMetricKey && chart.options.some((o) => o.key === chart.defaultMetricKey) ? chart.defaultMetricKey : chart.options[0]?.key || "";
  head.appendChild(metricSelect);

  const compareSelectors: HTMLSelectElement[] = [];
  const defaultCompare = (chart.defaultCompareKeys || []).slice(0, maxCompare);
  for (let i = 0; i < maxCompare; i++) {
    const sel = doc.createElement("select");
    sel.style.background = palette.buttonBg;
    sel.style.color = palette.buttonText;
    sel.style.border = `1px solid ${palette.border}`;
    sel.style.borderRadius = "7px";
    sel.style.padding = "2px 6px";
    sel.style.fontSize = "11px";
    const noneOpt = doc.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = i === 0 ? "Compare country" : `Compare country ${i + 1}`;
    sel.appendChild(noneOpt);
    for (const c of chart.compareCandidates) {
      const opt = doc.createElement("option");
      opt.value = c.key;
      opt.textContent = c.label;
      sel.appendChild(opt);
    }
    sel.value = defaultCompare[i] || "";
    compareSelectors.push(sel);
    head.appendChild(sel);
  }

  const content = doc.createElement("div");
  wrap.appendChild(content);

  const render = () => {
    content.innerHTML = "";
    const selectedMetric = chart.options.find((o) => o.key === metricSelect.value) || chart.options[0];
    if (!selectedMetric) return;
    const keyOrder = [chart.primaryKey, ...compareSelectors.map((s) => s.value).filter((v) => v !== "")];
    const uniqueKeys: string[] = [];
    for (const key of keyOrder) {
      if (!uniqueKeys.includes(key)) uniqueKeys.push(key);
    }
    const series = uniqueKeys
      .map((key) => selectedMetric.series.find((s) => s.key === key))
      .filter((s): s is NonNullable<typeof s> => !!s);
    if (series.length === 0) return;
    const lineChart: Extract<AnalysisChart, { type: "line" }> = {
      type: "line",
      yLabel: selectedMetric.label,
      points: series[0].points,
      series
    };
    content.appendChild(renderLineChart(lineChart, `${title} - ${selectedMetric.label}`, doc, graphCfg));
  };

  metricSelect.addEventListener("change", render);
  for (const sel of compareSelectors) sel.addEventListener("change", render);
  render();
  return wrap;
}

export function createUI(): UIHandle {
  const iconBtn = document.createElement("button");
  iconBtn.title = "GeoAnalyzr";
  iconBtn.style.position = "fixed";
  iconBtn.style.left = "16px";
  iconBtn.style.bottom = "16px";
  iconBtn.style.zIndex = "999999";
  iconBtn.style.width = "44px";
  iconBtn.style.height = "44px";
  iconBtn.style.borderRadius = "999px";
  iconBtn.style.border = "1px solid rgba(255,255,255,0.25)";
  iconBtn.style.background = "rgba(20,20,20,0.95)";
  iconBtn.style.color = "white";
  iconBtn.style.cursor = "pointer";
  iconBtn.style.display = "flex";
  iconBtn.style.alignItems = "center";
  iconBtn.style.justifyContent = "center";
  iconBtn.style.boxShadow = "0 6px 20px rgba(0,0,0,0.35)";
  iconBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">' +
    '<polyline points="3,16 9,10 14,15 21,8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></polyline>' +
    '<polyline points="16,8 21,8 21,13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></polyline>' +
    "</svg>";

  const panel = document.createElement("div");
  panel.style.position = "fixed";
  panel.style.left = "16px";
  panel.style.bottom = "68px";
  panel.style.zIndex = "999999";
  panel.style.width = "360px";
  panel.style.maxWidth = "calc(100vw - 32px)";
  panel.style.borderRadius = "14px";
  panel.style.border = "1px solid rgba(255,255,255,0.2)";
  panel.style.background = "rgba(20,20,20,0.92)";
  panel.style.color = "white";
  panel.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial";
  panel.style.boxShadow = "0 10px 30px rgba(0,0,0,0.45)";
  panel.style.padding = "10px";
  panel.style.display = "none";

  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.justifyContent = "space-between";
  header.style.alignItems = "center";
  header.style.marginBottom = "8px";

  const title = document.createElement("div");
  title.textContent = "GeoAnalyzr";
  title.style.fontWeight = "700";
  title.style.fontSize = "14px";

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "x";
  closeBtn.style.border = "none";
  closeBtn.style.background = "transparent";
  closeBtn.style.color = "white";
  closeBtn.style.cursor = "pointer";
  closeBtn.style.fontSize = "18px";

  header.appendChild(title);
  header.appendChild(closeBtn);

  const status = document.createElement("div");
  status.textContent = "Ready.";
  status.style.fontSize = "12px";
  status.style.opacity = "0.95";
  status.style.whiteSpace = "pre-wrap";
  status.style.marginBottom = "10px";

  function mkBtn(label: string, bg: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.width = "100%";
    b.style.padding = "10px 12px";
    b.style.borderRadius = "12px";
    b.style.border = "1px solid rgba(255,255,255,0.25)";
    b.style.background = bg;
    b.style.color = "white";
    b.style.cursor = "pointer";
    b.style.fontWeight = "600";
    b.style.marginTop = "8px";
    return b;
  }

  const updateBtn = mkBtn("Fetch Data", "rgba(255,255,255,0.10)");
  const analysisBtn = mkBtn("Open Analysis Window", "rgba(35,95,160,0.28)");
  const tokenBtn = mkBtn("Set NCFA Token", "rgba(95,95,30,0.35)");
  const exportBtn = mkBtn("Export Excel", "rgba(40,120,50,0.35)");
  const resetBtn = mkBtn("Reset Database", "rgba(160,35,35,0.35)");

  const counts = document.createElement("div");
  counts.style.marginTop = "10px";
  counts.style.fontSize = "12px";
  counts.style.opacity = "0.92";
  counts.style.whiteSpace = "normal";
  counts.textContent = "Data: 0 games, 0 rounds.";

  panel.appendChild(header);
  panel.appendChild(status);
  panel.appendChild(updateBtn);
  panel.appendChild(analysisBtn);
  panel.appendChild(tokenBtn);
  panel.appendChild(exportBtn);
  panel.appendChild(resetBtn);
  panel.appendChild(counts);

  type AnalysisWindowRefs = {
    win: Window;
    doc: Document;
    shell: HTMLDivElement;
    modalTitle: HTMLDivElement;
    controls: HTMLDivElement;
    filterControlWrappers: Record<FilterKey, HTMLSpanElement>;
    fromInput: HTMLInputElement;
    toInput: HTMLInputElement;
    modeSelect: HTMLSelectElement;
    movementSelect: HTMLSelectElement;
    teammateSelect: HTMLSelectElement;
    countrySelect: HTMLSelectElement;
    settingsBtn: HTMLButtonElement;
    tocWrap: HTMLDivElement;
    modalBody: HTMLDivElement;
    settingsOverlay: HTMLDivElement;
  };

  const ANALYSIS_ROOT_ID = "geoanalyzr-analysis-root";
  let analysisWindow: AnalysisWindowRefs | null = null;
  let lastAnalysisData: AnalysisWindowData | null = null;
  let designSourceLineLookup: DesignSourceLineLookup = new Map();

  loadPersistedAnalysisDesign().then((persisted) => {
    if (!persisted) return;
    replaceAnalysisDesign(persisted);
    if (lastAnalysisData) populateAnalysisWindow(lastAnalysisData);
  }).catch(() => {
    // ignore load errors
  });
  db.meta.get(ANALYSIS_UI_SETTINGS_META_KEY).then((row) => {
    if (!row || !row.value || typeof row.value !== "object") return;
    const parsed = row.value as Partial<AnalysisSettings>;
    analysisSettings.theme = parsed.theme === "light" ? "light" : "dark";
    analysisSettings.accent = normalizeAccent(parsed.accent);
    analysisSettings.visibleFilters = {
      date: parsed.visibleFilters?.date !== false,
      mode: parsed.visibleFilters?.mode !== false,
      movement: parsed.visibleFilters?.movement !== false,
      teammate: parsed.visibleFilters?.teammate !== false,
      country: parsed.visibleFilters?.country !== false
    };
    if (analysisWindow) {
      applyThemeToWindow(analysisWindow);
      applyFilterVisibility(analysisWindow);
      if (lastAnalysisData) populateAnalysisWindow(lastAnalysisData);
    }
  }).catch(() => {
    // ignore load errors
  });

  function styleInput(el: HTMLInputElement | HTMLSelectElement) {
    const palette = getThemePalette();
    el.style.background = palette.panelAlt;
    el.style.color = palette.text;
    el.style.border = `1px solid ${palette.border}`;
    el.style.borderRadius = "8px";
    el.style.padding = "6px 8px";
  }

  function applyThemeToWindow(refs: AnalysisWindowRefs) {
    const palette = getThemePalette();
    refs.doc.body.style.background = palette.bg;
    refs.doc.body.style.color = palette.text;
    refs.shell.style.background = palette.bg;
    refs.controls.style.background = palette.bg;
    refs.controls.style.borderBottom = `1px solid ${palette.border}`;
    refs.tocWrap.style.background = palette.panelAlt;
    refs.tocWrap.style.borderBottom = `1px solid ${palette.border}`;
    styleInput(refs.fromInput);
    styleInput(refs.toInput);
    styleInput(refs.modeSelect);
    styleInput(refs.movementSelect);
    styleInput(refs.teammateSelect);
    styleInput(refs.countrySelect);
    refs.settingsBtn.style.background = palette.buttonBg;
    refs.settingsBtn.style.color = palette.buttonText;
    refs.settingsBtn.style.border = `1px solid ${palette.border}`;
  }

  function applyFilterVisibility(refs: AnalysisWindowRefs): void {
    const visible = analysisSettings.visibleFilters;
    refs.filterControlWrappers.date.style.display = visible.date ? "inline-flex" : "none";
    refs.filterControlWrappers.mode.style.display = visible.mode ? "inline-flex" : "none";
    refs.filterControlWrappers.movement.style.display = visible.movement ? "inline-flex" : "none";
    refs.filterControlWrappers.teammate.style.display = visible.teammate ? "inline-flex" : "none";
    refs.filterControlWrappers.country.style.display = visible.country ? "inline-flex" : "none";
  }

  function getActiveFilterPayload(refs: AnalysisWindowRefs): {
    fromTs?: number;
    toTs?: number;
    gameMode?: string;
    movementType?: "all" | "moving" | "no_move" | "nmpz" | "unknown";
    teammateId?: string;
    country?: string;
  } {
    const movement =
      refs.movementSelect.value === "moving" ||
      refs.movementSelect.value === "no_move" ||
      refs.movementSelect.value === "nmpz" ||
      refs.movementSelect.value === "unknown"
        ? refs.movementSelect.value
        : "all";
    return {
      fromTs: parseDateInput(refs.fromInput.value, false),
      toTs: parseDateInput(refs.toInput.value, true),
      gameMode: refs.modeSelect.value || "all",
      movementType: movement,
      teammateId: refs.teammateSelect.value || "all",
      country: refs.countrySelect.value || "all"
    };
  }

  function downloadJsonFile(doc: Document, value: unknown, fileName: string): void {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = doc.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function openSettingsOverlay(refs: AnalysisWindowRefs): void {
    const doc = refs.doc;
    const palette = getThemePalette();
    const overlay = refs.settingsOverlay;
    overlay.innerHTML = "";
    overlay.style.display = "flex";

    const modal = doc.createElement("div");
    modal.style.width = "min(1200px, 96vw)";
    modal.style.maxHeight = "88vh";
    modal.style.overflow = "auto";
    modal.style.background = palette.panel;
    modal.style.border = `1px solid ${palette.border}`;
    modal.style.borderRadius = "12px";
    modal.style.boxShadow = "0 14px 45px rgba(0,0,0,0.45)";

    const head = doc.createElement("div");
    head.style.display = "flex";
    head.style.alignItems = "center";
    head.style.justifyContent = "space-between";
    head.style.padding = "10px 12px";
    head.style.borderBottom = `1px solid ${palette.border}`;
    const title = doc.createElement("div");
    title.textContent = "Analysis Settings";
    title.style.fontWeight = "700";
    const closeBtn = doc.createElement("button");
    closeBtn.textContent = "Close";
    closeBtn.style.background = palette.buttonBg;
    closeBtn.style.color = palette.buttonText;
    closeBtn.style.border = `1px solid ${palette.border}`;
    closeBtn.style.borderRadius = "8px";
    closeBtn.style.padding = "5px 10px";
    closeBtn.style.cursor = "pointer";
    closeBtn.addEventListener("click", () => {
      overlay.style.display = "none";
    });
    head.appendChild(title);
    head.appendChild(closeBtn);

    const tabBar = doc.createElement("div");
    tabBar.style.display = "flex";
    tabBar.style.gap = "8px";
    tabBar.style.flexWrap = "wrap";
    tabBar.style.padding = "10px 12px";
    tabBar.style.borderBottom = `1px solid ${palette.border}`;

    const body = doc.createElement("div");
    body.style.padding = "12px";
    body.style.display = "grid";
    body.style.gap = "12px";

    const mkTabButton = (label: string): HTMLButtonElement => {
      const b = doc.createElement("button");
      b.textContent = label;
      b.style.background = palette.buttonBg;
      b.style.color = palette.buttonText;
      b.style.border = `1px solid ${palette.border}`;
      b.style.borderRadius = "999px";
      b.style.padding = "5px 10px";
      b.style.cursor = "pointer";
      return b;
    };

    const appearanceBtn = mkTabButton("Appearance");
    const filterBtn = mkTabButton("Filter");
    const layoutBtn = mkTabButton("Layout");
    const templateBtn = mkTabButton("Template");
    tabBar.append(appearanceBtn, filterBtn, layoutBtn, templateBtn);

    const tabContent = doc.createElement("div");
    body.appendChild(tabContent);

    const rerenderAll = () => {
      saveAnalysisSettings();
      applyThemeToWindow(refs);
      applyFilterVisibility(refs);
      if (lastAnalysisData) populateAnalysisWindow(lastAnalysisData);
    };

    const mkFieldWrap = (labelText: string): HTMLLabelElement => {
      const wrap = doc.createElement("label");
      wrap.style.display = "grid";
      wrap.style.gap = "6px";
      const lbl = doc.createElement("span");
      lbl.textContent = labelText;
      lbl.style.fontSize = "12px";
      lbl.style.color = palette.textMuted;
      wrap.appendChild(lbl);
      return wrap;
    };

    const ensureSectionContainer = (sectionId: string): DesignSectionTemplate => {
      let section = (analysisDesign.sections || []).find((s) => s.id === sectionId);
      if (!section) {
        section = {
          id: sectionId,
          sourceSectionId: sectionId,
          title: sectionId,
          tocLabel: sectionId,
          objects: { singles: [], boxes: [], graphs: [] },
          layout: { mode: "object_order", order: [], preserveUnmatched: false }
        };
        analysisDesign.sections = [...(analysisDesign.sections || []), section];
      }
      if (!section.objects) section.objects = { singles: [], boxes: [], graphs: [] };
      if (!section.objects.singles) section.objects.singles = [];
      if (!section.objects.boxes) section.objects.boxes = [];
      if (!section.objects.graphs) section.objects.graphs = [];
      if (!section.layout || section.layout.mode !== "object_order") {
        section.layout = { mode: "object_order", order: [], preserveUnmatched: false };
      }
      return section;
    };

    const renderAppearanceTab = () => {
      tabContent.innerHTML = "";
      const grid = doc.createElement("div");
      grid.style.display = "grid";
      grid.style.gridTemplateColumns = "repeat(auto-fit,minmax(220px,1fr))";
      grid.style.gap = "10px";

      const themeWrap = mkFieldWrap("Theme");
      const themeSelect = doc.createElement("select");
      styleInput(themeSelect);
      themeSelect.innerHTML = `<option value="dark">Dark</option><option value="light">Light</option>`;
      themeSelect.value = analysisSettings.theme;
      themeSelect.addEventListener("change", () => {
        analysisSettings.theme = themeSelect.value === "light" ? "light" : "dark";
        if (!analysisDesign.window) analysisDesign.window = {};
        if (!analysisDesign.window.appearance) analysisDesign.window.appearance = {};
        if (!analysisDesign.window.appearance.defaults) analysisDesign.window.appearance.defaults = {};
        analysisDesign.window.appearance.defaults.theme = analysisSettings.theme;
        persistAnalysisDesign();
        rerenderAll();
      });
      themeWrap.appendChild(themeSelect);

      const accentWrap = mkFieldWrap("Graph accent");
      const accentInput = doc.createElement("input");
      accentInput.type = "color";
      accentInput.value = analysisSettings.accent;
      accentInput.style.width = "56px";
      accentInput.style.height = "34px";
      accentInput.style.borderRadius = "8px";
      accentInput.style.border = `1px solid ${palette.border}`;
      accentInput.style.cursor = "pointer";
      accentInput.addEventListener("input", () => {
        analysisSettings.accent = normalizeAccent(accentInput.value);
        if (!analysisDesign.window) analysisDesign.window = {};
        if (!analysisDesign.window.appearance) analysisDesign.window.appearance = {};
        if (!analysisDesign.window.appearance.defaults) analysisDesign.window.appearance.defaults = {};
        analysisDesign.window.appearance.defaults.accent = analysisSettings.accent;
        persistAnalysisDesign();
        rerenderAll();
      });
      accentWrap.appendChild(accentInput);

      grid.append(themeWrap, accentWrap);
      tabContent.appendChild(grid);
    };

    const renderFilterTab = () => {
      tabContent.innerHTML = "";
      const keys: Array<{ key: FilterKey; label: string }> = [
        { key: "date", label: "Date (From/To)" },
        { key: "mode", label: "Game mode" },
        { key: "movement", label: "Movement" },
        { key: "teammate", label: "Teammate" },
        { key: "country", label: "Country" }
      ];
      const box = doc.createElement("div");
      box.style.display = "grid";
      box.style.gap = "8px";
      for (const item of keys) {
        const row = doc.createElement("label");
        row.style.display = "inline-flex";
        row.style.alignItems = "center";
        row.style.gap = "8px";
        row.style.fontSize = "14px";
        const input = doc.createElement("input");
        input.type = "checkbox";
        input.checked = analysisSettings.visibleFilters[item.key];
        input.addEventListener("change", () => {
          analysisSettings.visibleFilters[item.key] = input.checked;
          if (!analysisDesign.window) analysisDesign.window = {};
          const winAny = analysisDesign.window as unknown as { filters?: { visible?: Record<FilterKey, boolean> } };
          if (!winAny.filters) winAny.filters = {};
          winAny.filters.visible = { ...analysisSettings.visibleFilters };
          persistAnalysisDesign();
          rerenderAll();
        });
        const text = doc.createElement("span");
        text.textContent = item.label;
        row.append(input, text);
        box.appendChild(row);
      }
      tabContent.appendChild(box);
    };

    const renderLayoutTab = () => {
      tabContent.innerHTML = "";
      const wrapper = doc.createElement("div");
      wrapper.style.display = "grid";
      wrapper.style.gap = "14px";
      const styleActionBtn = (b: HTMLButtonElement) => {
        b.style.background = palette.buttonBg;
        b.style.color = palette.buttonText;
        b.style.border = `1px solid ${palette.border}`;
        b.style.borderRadius = "8px";
        b.style.padding = "5px 10px";
        b.style.cursor = "pointer";
      };
      const parseCsv = (value: string): string[] =>
        value
          .split(",")
          .map((v) => v.trim())
          .filter((v) => v.length > 0);

      const sections = analysisDesign.sections || [];
      const currentOrder = Array.isArray(analysisDesign.section_layout?.order)
        ? analysisDesign.section_layout!.order!.slice()
        : sections.map((s) => s.id);
      if (!analysisDesign.section_layout) analysisDesign.section_layout = {};
      if (!analysisDesign.section_layout.order || analysisDesign.section_layout.order.length === 0) {
        analysisDesign.section_layout.order = currentOrder.slice();
      }

      const orderTitle = doc.createElement("div");
      orderTitle.textContent = "Sections order";
      orderTitle.style.fontWeight = "700";
      wrapper.appendChild(orderTitle);

      const resetLayoutBtn = doc.createElement("button");
      resetLayoutBtn.textContent = "Reset Layout";
      styleActionBtn(resetLayoutBtn);
      resetLayoutBtn.addEventListener("click", () => {
        analysisDesign.sections = JSON.parse(JSON.stringify(DEFAULT_ANALYSIS_DESIGN.sections || []));
        analysisDesign.section_layout = JSON.parse(JSON.stringify(DEFAULT_ANALYSIS_DESIGN.section_layout || {}));
        rebuildSectionTemplateCache();
        persistAnalysisDesign();
        renderLayoutTab();
        if (lastAnalysisData) populateAnalysisWindow(lastAnalysisData);
      });
      wrapper.appendChild(resetLayoutBtn);

      const orderList = doc.createElement("div");
      orderList.style.display = "grid";
      orderList.style.gap = "6px";
      wrapper.appendChild(orderList);

      const renderSectionOrderRows = () => {
        orderList.innerHTML = "";
        const order = analysisDesign.section_layout?.order || [];
        for (let i = 0; i < order.length; i++) {
          const sectionId = order[i];
          const row = doc.createElement("div");
          row.style.display = "grid";
          row.style.gridTemplateColumns = "1fr auto auto auto";
          row.style.gap = "6px";
          row.style.alignItems = "center";
          row.style.background = palette.panelAlt;
          row.style.border = `1px solid ${palette.border}`;
          row.style.borderRadius = "8px";
          row.style.padding = "6px 8px";
          const label = doc.createElement("div");
          const section = sections.find((s) => s.id === sectionId);
          label.textContent = section?.title || sectionId;
          label.style.fontSize = "13px";
          label.style.fontWeight = "600";
          label.style.color = palette.text;
          const upBtn = doc.createElement("button");
          upBtn.textContent = "Up";
          upBtn.disabled = i === 0;
          const downBtn = doc.createElement("button");
          downBtn.textContent = "Down";
          downBtn.disabled = i === order.length - 1;
          const removeBtn = doc.createElement("button");
          removeBtn.textContent = "Hide";
          for (const b of [upBtn, downBtn, removeBtn]) {
            b.style.background = palette.buttonBg;
            b.style.color = palette.buttonText;
            b.style.border = `1px solid ${palette.border}`;
            b.style.borderRadius = "6px";
            b.style.padding = "3px 8px";
            b.style.cursor = "pointer";
          }
          upBtn.addEventListener("click", () => {
            const arr = analysisDesign.section_layout?.order || [];
            [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
            rebuildSectionTemplateCache();
            persistAnalysisDesign();
            renderSectionOrderRows();
            if (lastAnalysisData) populateAnalysisWindow(lastAnalysisData);
          });
          downBtn.addEventListener("click", () => {
            const arr = analysisDesign.section_layout?.order || [];
            [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
            rebuildSectionTemplateCache();
            persistAnalysisDesign();
            renderSectionOrderRows();
            if (lastAnalysisData) populateAnalysisWindow(lastAnalysisData);
          });
          removeBtn.addEventListener("click", () => {
            analysisDesign.section_layout!.order = (analysisDesign.section_layout!.order || []).filter((x) => x !== sectionId);
            rebuildSectionTemplateCache();
            persistAnalysisDesign();
            renderSectionOrderRows();
            if (lastAnalysisData) populateAnalysisWindow(lastAnalysisData);
          });
          row.append(label, upBtn, downBtn, removeBtn);
          orderList.appendChild(row);
        }
      };

      renderSectionOrderRows();

      const addWrap = doc.createElement("div");
      addWrap.style.display = "inline-flex";
      addWrap.style.gap = "8px";
      addWrap.style.alignItems = "center";
      const addSelect = doc.createElement("select");
      styleInput(addSelect);
      const hidden = sections.filter((s) => !(analysisDesign.section_layout?.order || []).includes(s.id));
      for (const s of hidden) {
        const opt = doc.createElement("option");
        opt.value = s.id;
        opt.textContent = s.title || s.id;
        addSelect.appendChild(opt);
      }
      const addBtn = doc.createElement("button");
      addBtn.textContent = "Add section";
      addBtn.style.background = palette.buttonBg;
      addBtn.style.color = palette.buttonText;
      addBtn.style.border = `1px solid ${palette.border}`;
      addBtn.style.borderRadius = "8px";
      addBtn.style.padding = "5px 10px";
      addBtn.style.cursor = "pointer";
      addBtn.addEventListener("click", () => {
        const id = addSelect.value;
        if (!id) return;
        const order = analysisDesign.section_layout?.order || [];
        if (!order.includes(id)) order.push(id);
        analysisDesign.section_layout!.order = order;
        rebuildSectionTemplateCache();
        persistAnalysisDesign();
        renderLayoutTab();
        if (lastAnalysisData) populateAnalysisWindow(lastAnalysisData);
      });
      addWrap.append(addSelect, addBtn);
      wrapper.appendChild(addWrap);

      const createWrap = doc.createElement("div");
      createWrap.style.display = "inline-flex";
      createWrap.style.flexWrap = "wrap";
      createWrap.style.gap = "8px";
      createWrap.style.alignItems = "center";
      const newId = doc.createElement("input");
      newId.placeholder = "new_section_id";
      styleInput(newId);
      const newTitle = doc.createElement("input");
      newTitle.placeholder = "Section title";
      styleInput(newTitle);
      const sourceSelect = doc.createElement("select");
      styleInput(sourceSelect);
      const srcDefault = doc.createElement("option");
      srcDefault.value = "";
      srcDefault.textContent = "Source section (optional)";
      sourceSelect.appendChild(srcDefault);
      for (const s of sections) {
        const opt = doc.createElement("option");
        opt.value = s.id;
        opt.textContent = s.title || s.id;
        sourceSelect.appendChild(opt);
      }
      const createBtn = doc.createElement("button");
      createBtn.textContent = "Create section";
      createBtn.style.background = palette.buttonBg;
      createBtn.style.color = palette.buttonText;
      createBtn.style.border = `1px solid ${palette.border}`;
      createBtn.style.borderRadius = "8px";
      createBtn.style.padding = "5px 10px";
      createBtn.style.cursor = "pointer";
      createBtn.addEventListener("click", () => {
        const id = newId.value.trim();
        if (!id) return;
        if ((analysisDesign.sections || []).some((s) => s.id === id)) return;
        const created: DesignSectionTemplate = {
          id,
          sourceSectionId: sourceSelect.value || undefined,
          title: newTitle.value.trim() || id,
          tocLabel: newTitle.value.trim() || id,
          objects: { singles: [], boxes: [], graphs: [] },
          layout: { mode: "object_order", order: [], preserveUnmatched: false }
        };
        analysisDesign.sections = [...(analysisDesign.sections || []), created];
        const order = analysisDesign.section_layout?.order || [];
        order.push(id);
        if (!analysisDesign.section_layout) analysisDesign.section_layout = {};
        analysisDesign.section_layout.order = order;
        newId.value = "";
        newTitle.value = "";
        sourceSelect.value = "";
        rebuildSectionTemplateCache();
        persistAnalysisDesign();
        renderLayoutTab();
        if (lastAnalysisData) populateAnalysisWindow(lastAnalysisData);
      });
      createWrap.append(newId, newTitle, sourceSelect, createBtn);
      wrapper.appendChild(createWrap);

      const compTitle = doc.createElement("div");
      compTitle.textContent = "Components by section";
      compTitle.style.fontWeight = "700";
      wrapper.appendChild(compTitle);

      const detailsWrap = doc.createElement("div");
      detailsWrap.style.display = "grid";
      detailsWrap.style.gap = "8px";
      wrapper.appendChild(detailsWrap);

      for (const sectionId of analysisDesign.section_layout?.order || []) {
        const section = ensureSectionContainer(sectionId);
        const details = doc.createElement("details");
        details.style.border = `1px solid ${palette.border}`;
        details.style.borderRadius = "8px";
        details.style.background = palette.panelAlt;
        const summary = doc.createElement("summary");
        summary.textContent = section.title || section.id;
        summary.style.cursor = "pointer";
        summary.style.padding = "8px";
        summary.style.fontWeight = "600";
        details.appendChild(summary);

        const list = doc.createElement("div");
        list.style.display = "grid";
        list.style.gap = "6px";
        list.style.padding = "8px";
        details.appendChild(list);

        const order = section.layout?.mode === "object_order" ? section.layout.order : [];
        const renderComponentRows = () => {
          list.innerHTML = "";
          for (let i = 0; i < order.length; i++) {
            const entry = order[i];
            const row = doc.createElement("div");
            row.style.display = "grid";
            row.style.gridTemplateColumns = "1fr auto auto auto auto";
            row.style.gap = "6px";
            row.style.alignItems = "center";
            row.style.background = palette.panel;
            row.style.border = `1px solid ${palette.border}`;
            row.style.borderRadius = "6px";
            row.style.padding = "6px 8px";
            const label = doc.createElement("div");
            label.textContent = `${entry.kind}: ${entry.id}`;
            label.style.fontSize = "12px";
            label.style.fontWeight = "600";
            const upBtn = doc.createElement("button");
            upBtn.textContent = "Up";
            upBtn.disabled = i === 0;
            const downBtn = doc.createElement("button");
            downBtn.textContent = "Down";
            downBtn.disabled = i === order.length - 1;
            const editBtn = doc.createElement("button");
            editBtn.textContent = "Edit";
            const delBtn = doc.createElement("button");
            delBtn.textContent = "Remove";
            for (const b of [upBtn, downBtn, editBtn, delBtn]) {
              styleActionBtn(b);
              b.style.padding = "3px 8px";
            }
            upBtn.addEventListener("click", () => {
              [order[i - 1], order[i]] = [order[i], order[i - 1]];
              rebuildSectionTemplateCache();
              persistAnalysisDesign();
              renderComponentRows();
              if (lastAnalysisData) populateAnalysisWindow(lastAnalysisData);
            });
            downBtn.addEventListener("click", () => {
              [order[i + 1], order[i]] = [order[i], order[i + 1]];
              rebuildSectionTemplateCache();
              persistAnalysisDesign();
              renderComponentRows();
              if (lastAnalysisData) populateAnalysisWindow(lastAnalysisData);
            });
            delBtn.addEventListener("click", () => {
              order.splice(i, 1);
              if (entry.kind === "single") section.objects!.singles = (section.objects!.singles || []).filter((x) => x.id !== entry.id);
              if (entry.kind === "box") section.objects!.boxes = (section.objects!.boxes || []).filter((x) => x.id !== entry.id);
              if (entry.kind === "graph") section.objects!.graphs = (section.objects!.graphs || []).filter((x) => x.id !== entry.id);
              rebuildSectionTemplateCache();
              persistAnalysisDesign();
              renderComponentRows();
              if (lastAnalysisData) populateAnalysisWindow(lastAnalysisData);
            });
            row.append(label, upBtn, downBtn, editBtn, delBtn);
            list.appendChild(row);

            const findSingle = () => (section.objects?.singles || []).find((x) => x.id === entry.id);
            const findBox = () => (section.objects?.boxes || []).find((x) => x.id === entry.id);
            const findGraph = () => (section.objects?.graphs || []).find((x) => x.id === entry.id);

            const editor = doc.createElement("div");
            editor.style.display = "none";
            editor.style.background = palette.panelAlt;
            editor.style.border = `1px solid ${palette.border}`;
            editor.style.borderRadius = "8px";
            editor.style.padding = "8px";
            editor.style.marginTop = "-2px";
            editor.style.marginBottom = "6px";
            editor.style.display = "none";
            editor.style.gap = "8px";
            editor.style.gridTemplateColumns = "minmax(180px, 1fr) minmax(180px, 1fr)";
            list.appendChild(editor);

            const closeEditor = () => {
              editor.style.display = "none";
              editor.innerHTML = "";
            };

            const saveAndRefresh = () => {
              rebuildSectionTemplateCache();
              persistAnalysisDesign();
              renderComponentRows();
              if (lastAnalysisData) populateAnalysisWindow(lastAnalysisData);
            };

            editBtn.addEventListener("click", () => {
              if (editor.style.display !== "none") {
                closeEditor();
                return;
              }
              editor.innerHTML = "";
              editor.style.display = "grid";
              const title = doc.createElement("div");
              title.textContent = `Edit ${entry.kind}: ${entry.id}`;
              title.style.gridColumn = "1 / -1";
              title.style.fontWeight = "700";
              editor.appendChild(title);

              const mkField = (name: string, input: HTMLInputElement | HTMLSelectElement, colSpan = false) => {
                const wrap = doc.createElement("label");
                wrap.style.display = "grid";
                wrap.style.gap = "4px";
                if (colSpan) wrap.style.gridColumn = "1 / -1";
                const n = doc.createElement("span");
                n.textContent = name;
                n.style.fontSize = "12px";
                n.style.color = palette.textMuted;
                wrap.append(n, input);
                editor.appendChild(wrap);
              };

              if (entry.kind === "single") {
                const single = findSingle();
                if (!single) return;
                const labelInput = doc.createElement("input");
                labelInput.value = single.label || "";
                styleInput(labelInput);
                mkField("Label", labelInput, true);
                const saveBtn = doc.createElement("button");
                saveBtn.textContent = "Save";
                styleActionBtn(saveBtn);
                saveBtn.style.gridColumn = "1 / -1";
                saveBtn.addEventListener("click", () => {
                  single.label = labelInput.value.trim() || single.id;
                  saveAndRefresh();
                });
                editor.appendChild(saveBtn);
                return;
              }

              if (entry.kind === "box") {
                const boxObj = findBox();
                if (!boxObj) return;
                const titleInput = doc.createElement("input");
                titleInput.value = boxObj.title || "";
                styleInput(titleInput);
                mkField("Box title", titleInput, true);
                const linesWrap = doc.createElement("div");
                linesWrap.style.gridColumn = "1 / -1";
                linesWrap.style.display = "grid";
                linesWrap.style.gap = "6px";
                const linesTitle = doc.createElement("div");
                linesTitle.textContent = "Lines";
                linesTitle.style.fontWeight = "600";
                linesWrap.appendChild(linesTitle);
                const lines = boxObj.lines || [];
                const renderLines = () => {
                  while (linesWrap.children.length > 1) linesWrap.removeChild(linesWrap.lastChild!);
                  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
                    const line = lines[lineIdx];
                    const row2 = doc.createElement("div");
                    row2.style.display = "grid";
                    row2.style.gridTemplateColumns = "1fr auto";
                    row2.style.gap = "6px";
                    const input = doc.createElement("input");
                    input.value = line.label || "";
                    styleInput(input);
                    input.addEventListener("input", () => {
                      line.label = input.value;
                    });
                    const rm = doc.createElement("button");
                    rm.textContent = "Remove";
                    styleActionBtn(rm);
                    rm.addEventListener("click", () => {
                      lines.splice(lineIdx, 1);
                      renderLines();
                    });
                    row2.append(input, rm);
                    linesWrap.appendChild(row2);
                  }
                  const addLineBtn = doc.createElement("button");
                  addLineBtn.textContent = "Add line";
                  styleActionBtn(addLineBtn);
                  addLineBtn.addEventListener("click", () => {
                    lines.push({ label: "New line" });
                    renderLines();
                  });
                  linesWrap.appendChild(addLineBtn);
                };
                renderLines();
                editor.appendChild(linesWrap);
                const saveBtn = doc.createElement("button");
                saveBtn.textContent = "Save";
                styleActionBtn(saveBtn);
                saveBtn.style.gridColumn = "1 / -1";
                saveBtn.addEventListener("click", () => {
                  boxObj.title = titleInput.value.trim() || boxObj.id;
                  for (const ln of lines) ln.label = (ln.label || "").trim() || "Line";
                  boxObj.lines = lines;
                  saveAndRefresh();
                });
                editor.appendChild(saveBtn);
                return;
              }

              const graphObj = findGraph();
              if (!graphObj) return;
              const titleInput = doc.createElement("input");
              titleInput.value = graphObj.title || "";
              styleInput(titleInput);
              mkField("Title", titleInput, true);

              const contentInput = doc.createElement("input");
              contentInput.value = graphObj.content || "";
              styleInput(contentInput);
              mkField("Content key", contentInput);

              const typeSelect = doc.createElement("select");
              typeSelect.innerHTML = `
                <option value="">(auto)</option>
                <option value="line">line</option>
                <option value="bar">bar</option>
                <option value="selectableLine">selectableLine</option>
                <option value="selectableBar">selectableBar</option>
                <option value="horizontalBar">horizontalBar</option>
                <option value="verticalBar">verticalBar</option>`;
              typeSelect.value = graphObj.type || "";
              styleInput(typeSelect);
              mkField("Type", typeSelect);

              const orientationSelect = doc.createElement("select");
              orientationSelect.innerHTML = `<option value="">(auto)</option><option value="horizontal">horizontal</option><option value="vertical">vertical</option>`;
              orientationSelect.value = graphObj.orientation || "";
              styleInput(orientationSelect);
              mkField("Orientation", orientationSelect);

              const defaultMetricInput = doc.createElement("input");
              defaultMetricInput.value = graphObj.defaultMetric || "";
              styleInput(defaultMetricInput);
              mkField("Default metric", defaultMetricInput);

              const metricsInput = doc.createElement("input");
              metricsInput.value = (graphObj.metrics || []).join(", ");
              styleInput(metricsInput);
              mkField("Metrics (csv)", metricsInput, true);

              const defaultSortSelect = doc.createElement("select");
              defaultSortSelect.innerHTML = `<option value="">(auto)</option><option value="chronological">chronological</option><option value="desc">descending</option><option value="asc">ascending</option>`;
              defaultSortSelect.value = graphObj.defaultSort || "";
              styleInput(defaultSortSelect);
              mkField("Default sort", defaultSortSelect);

              const sortsInput = doc.createElement("input");
              sortsInput.value = (graphObj.sorts || []).join(", ");
              styleInput(sortsInput);
              mkField("Sorts (csv)", sortsInput);

              const defaultInitialBars = graphObj.initialBars === "max" ? "max" : String(graphObj.initialBars ?? "");
              const initialBarsInput = doc.createElement("input");
              initialBarsInput.value = defaultInitialBars;
              initialBarsInput.placeholder = "number | max";
              styleInput(initialBarsInput);
              mkField("Initial bars", initialBarsInput);

              const drilldownTypeSelect = doc.createElement("select");
              drilldownTypeSelect.innerHTML = `<option value="">(none)</option><option value="rounds">rounds</option><option value="players">players</option>`;
              drilldownTypeSelect.value = graphObj.drilldownType || "";
              styleInput(drilldownTypeSelect);
              mkField("Drilldown type", drilldownTypeSelect);

              const drilldownColsInput = doc.createElement("input");
              drilldownColsInput.value = (graphObj.drilldownColumns || []).join(", ");
              styleInput(drilldownColsInput);
              mkField("Drilldown columns (csv)", drilldownColsInput, true);

              const drilldownColoredInput = doc.createElement("input");
              drilldownColoredInput.value = (graphObj.drilldownColored || []).join(", ");
              styleInput(drilldownColoredInput);
              mkField("Colored columns (csv)", drilldownColoredInput);

              const drilldownClickableInput = doc.createElement("input");
              drilldownClickableInput.value = (graphObj.drilldownClickable || []).join(", ");
              styleInput(drilldownClickableInput);
              mkField("Clickable columns (csv)", drilldownClickableInput);

              const mkCheck = (labelText: string, checked: boolean) => {
                const wrap = doc.createElement("label");
                wrap.style.display = "inline-flex";
                wrap.style.alignItems = "center";
                wrap.style.gap = "6px";
                const cb = doc.createElement("input");
                cb.type = "checkbox";
                cb.checked = checked;
                const t = doc.createElement("span");
                t.textContent = labelText;
                wrap.append(cb, t);
                return { wrap, cb };
              };
              const clickable = mkCheck("clickable", !!graphObj.clickable);
              const hoverable = mkCheck("hoverable", !!graphObj.hoverable);
              const sortable = mkCheck("sortable", graphObj.sortable !== false);
              const expandable = mkCheck("expandable", !!graphObj.expandable);
              for (const w of [clickable.wrap, hoverable.wrap, sortable.wrap, expandable.wrap]) {
                w.style.fontSize = "12px";
                editor.appendChild(w);
              }

              const saveBtn = doc.createElement("button");
              saveBtn.textContent = "Save";
              styleActionBtn(saveBtn);
              saveBtn.style.gridColumn = "1 / -1";
              saveBtn.addEventListener("click", () => {
                graphObj.title = titleInput.value.trim() || graphObj.id;
                graphObj.content = contentInput.value.trim() || undefined;
                graphObj.type = (typeSelect.value || undefined) as DesignGraphTemplate["type"];
                graphObj.orientation = (orientationSelect.value || undefined) as DesignGraphTemplate["orientation"];
                graphObj.defaultMetric = defaultMetricInput.value.trim() || undefined;
                graphObj.metrics = parseCsv(metricsInput.value);
                graphObj.defaultSort = (defaultSortSelect.value || undefined) as DesignGraphTemplate["defaultSort"];
                graphObj.sorts = parseCsv(sortsInput.value).filter(
                  (s): s is "chronological" | "desc" | "asc" => s === "chronological" || s === "desc" || s === "asc"
                );
                const ibRaw = initialBarsInput.value.trim().toLowerCase();
                if (!ibRaw) graphObj.initialBars = undefined;
                else if (ibRaw === "max") graphObj.initialBars = "max";
                else {
                  const n = Number.parseInt(ibRaw, 10);
                  graphObj.initialBars = Number.isFinite(n) ? n : undefined;
                }
                graphObj.drilldownType = (drilldownTypeSelect.value || undefined) as DesignGraphTemplate["drilldownType"];
                graphObj.drilldownColumns = parseCsv(drilldownColsInput.value);
                graphObj.drilldownColored = parseCsv(drilldownColoredInput.value);
                graphObj.drilldownClickable = parseCsv(drilldownClickableInput.value);
                graphObj.clickable = clickable.cb.checked;
                graphObj.hoverable = hoverable.cb.checked;
                graphObj.sortable = sortable.cb.checked;
                graphObj.expandable = expandable.cb.checked;
                saveAndRefresh();
              });
              editor.appendChild(saveBtn);
            });
          }
        };

        renderComponentRows();

        const addRow = doc.createElement("div");
        addRow.style.display = "inline-flex";
        addRow.style.flexWrap = "wrap";
        addRow.style.gap = "8px";
        addRow.style.padding = "8px";
        const kindSelect = doc.createElement("select");
        kindSelect.innerHTML = `<option value="single">Single</option><option value="box">Box</option><option value="graph">Graph</option>`;
        styleInput(kindSelect);
        const idInput = doc.createElement("input");
        idInput.placeholder = "component_id";
        styleInput(idInput);
        const labelInput = doc.createElement("input");
        labelInput.placeholder = "label / title";
        styleInput(labelInput);
        const typeInput = doc.createElement("input");
        typeInput.placeholder = "type (optional)";
        styleInput(typeInput);
        const addCompBtn = doc.createElement("button");
        addCompBtn.textContent = "Add component";
        addCompBtn.style.background = palette.buttonBg;
        addCompBtn.style.color = palette.buttonText;
        addCompBtn.style.border = `1px solid ${palette.border}`;
        addCompBtn.style.borderRadius = "8px";
        addCompBtn.style.padding = "5px 10px";
        addCompBtn.style.cursor = "pointer";
        addCompBtn.addEventListener("click", () => {
          const kind = (kindSelect.value || "single") as "single" | "box" | "graph";
          const id = idInput.value.trim();
          if (!id) return;
          const label = labelInput.value.trim() || id;
          const type = typeInput.value.trim();
          if (kind === "single") {
            section.objects!.singles!.push({ id, label, type: type || undefined });
          } else if (kind === "box") {
            section.objects!.boxes!.push({ id, title: label, lines: [] });
          } else {
            section.objects!.graphs!.push({ id, title: label, type: type as AnalysisChart["type"] | "horizontalBar" | "verticalBar" | undefined });
          }
          order.push({ kind, id });
          idInput.value = "";
          labelInput.value = "";
          typeInput.value = "";
          rebuildSectionTemplateCache();
          persistAnalysisDesign();
          renderComponentRows();
          if (lastAnalysisData) populateAnalysisWindow(lastAnalysisData);
        });
        addRow.append(kindSelect, idInput, labelInput, typeInput, addCompBtn);
        details.appendChild(addRow);

        detailsWrap.appendChild(details);
      }

      tabContent.appendChild(wrapper);
    };

    const renderTemplateTab = () => {
      tabContent.innerHTML = "";
      const box = doc.createElement("div");
      box.style.display = "grid";
      box.style.gap = "10px";

      const downloadTemplateBtn = doc.createElement("button");
      downloadTemplateBtn.textContent = "Download Current Template";
      const downloadSchemaBtn = doc.createElement("button");
      downloadSchemaBtn.textContent = "Download Schema";
      const uploadWrap = doc.createElement("label");
      uploadWrap.textContent = "Upload Template JSON";
      uploadWrap.style.display = "grid";
      uploadWrap.style.gap = "6px";
      const uploadInput = doc.createElement("input");
      uploadInput.type = "file";
      uploadInput.accept = ".json,application/json";
      uploadWrap.appendChild(uploadInput);

      for (const b of [downloadTemplateBtn, downloadSchemaBtn]) {
        b.style.background = palette.buttonBg;
        b.style.color = palette.buttonText;
        b.style.border = `1px solid ${palette.border}`;
        b.style.borderRadius = "8px";
        b.style.padding = "7px 10px";
        b.style.cursor = "pointer";
        b.style.width = "fit-content";
      }

      downloadTemplateBtn.addEventListener("click", () => {
        const exportTemplate = {
          ...analysisDesign,
          $schema: "https://raw.githubusercontent.com/JonasLmbt/GeoAnalyzr/master/design.schema.json"
        };
        downloadJsonFile(doc, exportTemplate, "analysis-template.json");
      });
      downloadSchemaBtn.addEventListener("click", () => {
        downloadJsonFile(doc, designSchemaJson, "analysis-template.schema.json");
      });
      uploadInput.addEventListener("change", async () => {
        const file = uploadInput.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          const parsed = JSON.parse(text) as AnalysisDesignTemplate;
          replaceAnalysisDesign(parsed);
          await persistAnalysisDesign();
          if (lastAnalysisData) populateAnalysisWindow(lastAnalysisData);
          renderLayoutTab();
        } catch (err) {
          console.error("[GeoAnalyzr] Template import failed", err);
        } finally {
          uploadInput.value = "";
        }
      });

      box.append(downloadTemplateBtn, downloadSchemaBtn, uploadWrap);
      tabContent.appendChild(box);
    };

    const tabs: Array<{ button: HTMLButtonElement; render: () => void }> = [
      { button: appearanceBtn, render: renderAppearanceTab },
      { button: filterBtn, render: renderFilterTab },
      { button: layoutBtn, render: renderLayoutTab },
      { button: templateBtn, render: renderTemplateTab }
    ];
    const activateTab = (target: HTMLButtonElement, render: () => void) => {
      for (const tab of tabs) {
        tab.button.style.outline = "none";
        tab.button.style.boxShadow = "none";
      }
      target.style.boxShadow = `inset 0 0 0 2px ${analysisSettings.accent}`;
      render();
    };
    for (const tab of tabs) {
      tab.button.addEventListener("click", () => activateTab(tab.button, tab.render));
    }
    activateTab(appearanceBtn, renderAppearanceTab);

    modal.append(head, tabBar, body);
    overlay.appendChild(modal);
  }

  function resolveSectionIconKey(section: AnalysisSection): DesignIconKey {
    const templ = getSectionTemplate(section);
    if (templ?.tocIcon?.key) return templ.tocIcon.key;
    if (templ?.icon) return templ.icon;
    const title = section.title.toLowerCase();
    if (title.includes("overview")) return "overview";
    if (title.includes("sessions")) return "sessions";
    if (title.includes("time patterns")) return "time_patterns";
    if (title.includes("tempo")) return "tempo";
    if (title.includes("scores")) return "scores";
    if (title.includes("rounds")) return "rounds";
    if (title.includes("countries") || title.includes("country spotlight")) return "countries";
    if (title.includes("opponents")) return "opponents";
    if (title === "rating" || title.includes("rating")) return "rating";
    if (title.includes("team")) return "team";
    if (title.includes("personal records")) return "records";
    return "default";
  }

  function createSectionIcon(section: AnalysisSection, doc: Document): HTMLElement | null {
    const templ = getSectionTemplate(section);
    if (templ?.tocIcon?.enabled === false) return null;
    const palette = getThemePalette();
    const wrap = doc.createElement("span");
    wrap.style.display = "inline-flex";
    wrap.style.alignItems = "center";
    wrap.style.justifyContent = "center";
    wrap.style.width = "14px";
    wrap.style.height = "14px";
    wrap.style.flex = "0 0 auto";
    const stroke = palette.buttonText;
    if (templ?.tocIcon?.svg && templ.tocIcon.svg.trim()) {
      wrap.innerHTML = templ.tocIcon.svg;
      return wrap;
    }
    const iconKey = resolveSectionIconKey(section);
    const svgBase = (paths: string) =>
      `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
    if (iconKey === "overview") wrap.innerHTML = svgBase('<path d="M3 12l9-9 9 9"/><path d="M9 21V9h6v12"/>');
    else if (iconKey === "sessions") wrap.innerHTML = svgBase('<circle cx="12" cy="12" r="8"/><path d="M12 8v5"/><path d="M12 12l3 2"/>');
    else if (iconKey === "time_patterns") wrap.innerHTML = svgBase('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4"/><path d="M16 3v4"/><path d="M4 10h16"/>');
    else if (iconKey === "tempo") wrap.innerHTML = svgBase('<path d="M4 14a8 8 0 1 1 16 0"/><path d="M12 14l4-4"/><path d="M12 14h0"/>');
    else if (iconKey === "scores") wrap.innerHTML = svgBase('<path d="M4 20V8"/><path d="M10 20V4"/><path d="M16 20v-9"/><path d="M22 20v-6"/>');
    else if (iconKey === "rounds") wrap.innerHTML = svgBase('<path d="M4 12h16"/><path d="M4 7h16"/><path d="M4 17h16"/><circle cx="7" cy="7" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="17" cy="17" r="1"/>');
    else if (iconKey === "countries" || iconKey === "spotlight") wrap.innerHTML = svgBase('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/>');
    else if (iconKey === "opponents") wrap.innerHTML = svgBase('<circle cx="8" cy="9" r="2.5"/><circle cx="16" cy="9" r="2.5"/><path d="M3 18c.8-2.5 2.8-4 5-4s4.2 1.5 5 4"/><path d="M11 18c.8-2.5 2.8-4 5-4s4.2 1.5 5 4"/>');
    else if (iconKey === "rating") wrap.innerHTML = svgBase('<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.4 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>');
    else if (iconKey === "team") wrap.innerHTML = svgBase('<circle cx="9" cy="8" r="2.5"/><circle cx="15" cy="8" r="2.5"/><path d="M4 18c1-3 3-4.5 5-4.5s4 1.5 5 4.5"/><path d="M10 18c1-3 3-4.5 5-4.5s4 1.5 5 4.5"/>');
    else if (iconKey === "records") wrap.innerHTML = svgBase('<path d="M8 4h8v4a4 4 0 0 1-8 0z"/><path d="M10 14h4"/><path d="M9 18h6"/>');
    else wrap.innerHTML = svgBase('<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><circle cx="12" cy="16" r="1"/>');
    return wrap;
  }

  function populateAnalysisWindow(data: AnalysisWindowData) {
    const refs = analysisWindow;
    if (!refs || refs.win.closed) return;
    const palette = getThemePalette();
    const windowTitle = getWindowRenderTitle(data);
    refs.doc.title = windowTitle;
    refs.modalTitle.textContent = windowTitle;
    designSourceLineLookup = buildDesignSourceLineLookup(data.sections || []);

    const { fromInput, toInput, modeSelect, movementSelect, teammateSelect, countrySelect, modalBody, tocWrap, doc } = refs;
    if (!fromInput.value && data.minPlayedAt) fromInput.value = isoDateLocal(data.minPlayedAt);
    if (!toInput.value && data.maxPlayedAt) toInput.value = isoDateLocal(data.maxPlayedAt);

    const prevMode = modeSelect.value || "all";
    const prevMovement = movementSelect.value || "all";
    const prevTeammate = teammateSelect.value || "all";
    const prevCountry = countrySelect.value || "all";

    modeSelect.innerHTML = "";
    for (const mode of data.availableGameModes) {
      const opt = doc.createElement("option");
      opt.value = mode;
      opt.textContent = gameModeSelectLabel(mode);
      modeSelect.appendChild(opt);
    }
    if ([...modeSelect.options].some((o) => o.value === prevMode)) modeSelect.value = prevMode;

    movementSelect.innerHTML = "";
    for (const movement of data.availableMovementTypes) {
      const opt = doc.createElement("option");
      opt.value = movement.key;
      opt.textContent = movement.label;
      movementSelect.appendChild(opt);
    }
    if ([...movementSelect.options].some((o) => o.value === prevMovement)) movementSelect.value = prevMovement;

    teammateSelect.innerHTML = "";
    for (const teammate of data.availableTeammates) {
      const opt = doc.createElement("option");
      opt.value = teammate.id;
      opt.textContent = teammate.label;
      teammateSelect.appendChild(opt);
    }
    if ([...teammateSelect.options].some((o) => o.value === prevTeammate)) teammateSelect.value = prevTeammate;

    countrySelect.innerHTML = "";
    for (const country of data.availableCountries) {
      const opt = doc.createElement("option");
      opt.value = country.code;
      opt.textContent = country.label;
      countrySelect.appendChild(opt);
    }
    if ([...countrySelect.options].some((o) => o.value === prevCountry)) countrySelect.value = prevCountry;

    const renderSections = materializeSections(data);
    tocWrap.innerHTML = "";
    for (const section of renderSections) {
      const b = doc.createElement("button");
      b.style.background = palette.buttonBg;
      b.style.color = palette.buttonText;
      b.style.border = `1px solid ${palette.border}`;
      b.style.borderRadius = "999px";
      b.style.padding = "4px 9px";
      b.style.cursor = "pointer";
      b.style.fontSize = "11px";
      b.style.fontWeight = "700";
      b.style.display = "inline-flex";
      b.style.alignItems = "center";
      b.style.gap = "6px";
      const iconEl = createSectionIcon(section, doc);
      if (iconEl) b.appendChild(iconEl);
      const label = doc.createElement("span");
      label.textContent = getSectionTocLabel(section);
      b.appendChild(label);
      b.addEventListener("click", () => {
        const id = `section-${section.id}`;
        const node = doc.getElementById(id);
        if (node) node.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      tocWrap.appendChild(b);
    }

    modalBody.innerHTML = "";
    for (const s of renderSections) modalBody.appendChild(renderSection(s, doc, getSectionRenderTitle(s)));
  }

  function canAccessWindow(win: Window | null): win is Window {
    if (!win) return false;
    try {
      void win.closed;
      void win.location.href;
      void win.document;
      return true;
    } catch {
      return false;
    }
  }

  function hasAnalysisShell(refs: AnalysisWindowRefs): boolean {
    try {
      return !!refs.doc.getElementById(ANALYSIS_ROOT_ID);
    } catch {
      return false;
    }
  }

  function ensureAnalysisWindow(): AnalysisWindowRefs | null {
    if (analysisWindow && !analysisWindow.win.closed && canAccessWindow(analysisWindow.win)) {
      if (hasAnalysisShell(analysisWindow)) {
        analysisWindow.win.focus();
        return analysisWindow;
      }
      try {
        analysisWindow.win.close();
      } catch {
      }
      analysisWindow = null;
    }

    let win = window.open("about:blank", "_blank");
    if (!canAccessWindow(win)) return null;
    const doc = win.document;
    doc.open();
    doc.write("<!doctype html><html><head><meta charset=\"utf-8\"><title>GeoAnalyzr - Full Analysis</title></head><body></body></html>");
    doc.close();
    if (!doc.body) return null;
    const palette = getThemePalette();
    doc.title = getWindowRenderTitle({ sections: [], availableGameModes: [], availableMovementTypes: [], availableTeammates: [], availableCountries: [] });
    doc.body.innerHTML = "";
    doc.body.style.margin = "0";
    doc.body.style.background = palette.bg;
    doc.body.style.color = palette.text;
    doc.body.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial";

    const shell = doc.createElement("div");
    shell.id = ANALYSIS_ROOT_ID;
    shell.style.display = "grid";
    shell.style.gridTemplateRows = "auto auto auto 1fr";
    shell.style.height = "100vh";

    const modalHead = doc.createElement("div");
    modalHead.style.display = "flex";
    modalHead.style.justifyContent = "space-between";
    modalHead.style.alignItems = "center";
    modalHead.style.padding = "12px 14px";
    modalHead.style.borderBottom = `1px solid ${palette.border}`;
    const modalTitle = doc.createElement("div");
    modalTitle.style.fontWeight = "700";
    modalTitle.textContent = doc.title;
    modalHead.appendChild(modalTitle);
    const modalClose = doc.createElement("button");
    modalClose.textContent = "x";
    modalClose.style.background = "transparent";
    modalClose.style.color = palette.text;
    modalClose.style.border = "none";
    modalClose.style.cursor = "pointer";
    modalClose.style.fontSize = "18px";
    modalHead.appendChild(modalClose);

    const controls = doc.createElement("div");
    controls.style.display = "flex";
    controls.style.gap = "10px";
    controls.style.alignItems = "center";
    controls.style.padding = "10px 14px";
    controls.style.borderBottom = `1px solid ${palette.border}`;
    controls.style.flexWrap = "nowrap";
    controls.style.whiteSpace = "nowrap";
    controls.style.overflowX = "auto";
    controls.style.overflowY = "hidden";
    controls.style.background = palette.bg;

    const fromInput = doc.createElement("input");
    fromInput.type = "date";
    styleInput(fromInput);

    const toInput = doc.createElement("input");
    toInput.type = "date";
    styleInput(toInput);

    const modeSelect = doc.createElement("select");
    styleInput(modeSelect);

    const movementSelect = doc.createElement("select");
    styleInput(movementSelect);

    const teammateSelect = doc.createElement("select");
    styleInput(teammateSelect);

    const countrySelect = doc.createElement("select");
    styleInput(countrySelect);

    const applyBtn = doc.createElement("button");
    applyBtn.textContent = "Apply Filter";
    applyBtn.style.background = "#214a78";
    applyBtn.style.color = "white";
    applyBtn.style.border = "1px solid #2f6096";
    applyBtn.style.borderRadius = "8px";
    applyBtn.style.padding = "6px 10px";
    applyBtn.style.cursor = "pointer";

    const resetFilterBtn = doc.createElement("button");
    resetFilterBtn.textContent = "Reset Filter";
    resetFilterBtn.style.background = "#303030";
    resetFilterBtn.style.color = "white";
    resetFilterBtn.style.border = "1px solid #444";
    resetFilterBtn.style.borderRadius = "8px";
    resetFilterBtn.style.padding = "6px 10px";
    resetFilterBtn.style.cursor = "pointer";

    const settingsBtn = doc.createElement("button");
    settingsBtn.textContent = "\u2699";
    settingsBtn.title = "Analysis settings";
    settingsBtn.style.borderRadius = "8px";
    settingsBtn.style.padding = "5px 10px";
    settingsBtn.style.cursor = "pointer";
    settingsBtn.style.fontSize = "18px";
    settingsBtn.style.lineHeight = "1";

    const mkFilterControl = (
      key: FilterKey,
      labelText: string,
      inputEl: HTMLInputElement | HTMLSelectElement,
      extra?: Array<{ label: string; input: HTMLInputElement | HTMLSelectElement }>
    ): HTMLSpanElement => {
      const wrap = doc.createElement("span");
      wrap.dataset.filterKey = key;
      wrap.style.display = "inline-flex";
      wrap.style.alignItems = "center";
      wrap.style.gap = "6px";
      const label = doc.createElement("span");
      label.textContent = labelText;
      wrap.append(label, inputEl);
      for (const e of extra || []) {
        const l = doc.createElement("span");
        l.textContent = e.label;
        wrap.append(l, e.input);
      }
      return wrap;
    };
    const filterControlWrappers: Record<FilterKey, HTMLSpanElement> = {
      date: mkFilterControl("date", "From:", fromInput, [{ label: "To:", input: toInput }]),
      mode: mkFilterControl("mode", "Game Mode:", modeSelect),
      movement: mkFilterControl("movement", "Movement:", movementSelect),
      teammate: mkFilterControl("teammate", "Teammate:", teammateSelect),
      country: mkFilterControl("country", "Country:", countrySelect)
    };

    controls.appendChild(filterControlWrappers.date);
    controls.appendChild(filterControlWrappers.mode);
    controls.appendChild(filterControlWrappers.movement);
    controls.appendChild(filterControlWrappers.teammate);
    controls.appendChild(filterControlWrappers.country);
    controls.appendChild(applyBtn);
    controls.appendChild(resetFilterBtn);
    controls.appendChild(settingsBtn);

    const tocWrap = doc.createElement("div");
    tocWrap.style.display = "flex";
    tocWrap.style.flexWrap = "wrap";
    tocWrap.style.gap = "6px";
    tocWrap.style.padding = "6px 12px 8px";
    tocWrap.style.borderBottom = `1px solid ${palette.border}`;
    tocWrap.style.background = palette.panelAlt;
    tocWrap.style.position = "sticky";
    tocWrap.style.top = "0";
    tocWrap.style.zIndex = "5";

    const modalBody = doc.createElement("div");
    modalBody.style.overflow = "auto";
    modalBody.style.padding = "16px";
    modalBody.style.display = "grid";
    modalBody.style.gridTemplateColumns = "minmax(0, 1fr)";
    modalBody.style.gap = "14px";
    modalBody.style.maxWidth = "1800px";
    modalBody.style.width = "100%";
    modalBody.style.margin = "0 auto";

    const settingsOverlay = doc.createElement("div");
    settingsOverlay.style.position = "fixed";
    settingsOverlay.style.inset = "0";
    settingsOverlay.style.background = "rgba(0,0,0,0.45)";
    settingsOverlay.style.display = "none";
    settingsOverlay.style.alignItems = "center";
    settingsOverlay.style.justifyContent = "center";
    settingsOverlay.style.padding = "18px";
    settingsOverlay.style.zIndex = "50";
    settingsOverlay.addEventListener("click", (ev) => {
      if (ev.target === settingsOverlay) settingsOverlay.style.display = "none";
    });

    shell.appendChild(modalHead);
    shell.appendChild(controls);
    shell.appendChild(tocWrap);
    shell.appendChild(modalBody);
    doc.body.appendChild(shell);
    doc.body.appendChild(settingsOverlay);

    modalClose.addEventListener("click", () => win.close());
    const toMovementType = (value: string): "all" | "moving" | "no_move" | "nmpz" | "unknown" => {
      if (value === "moving" || value === "no_move" || value === "nmpz" || value === "unknown" || value === "all") {
        return value;
      }
      return "all";
    };

    applyBtn.addEventListener("click", () => {
      refreshAnalysisHandler?.({
        fromTs: parseDateInput(fromInput.value, false),
        toTs: parseDateInput(toInput.value, true),
        gameMode: modeSelect.value || "all",
        movementType: toMovementType(movementSelect.value || "all"),
        teammateId: teammateSelect.value || "all",
        country: countrySelect.value || "all"
      });
    });
    resetFilterBtn.addEventListener("click", () => {
      fromInput.value = "";
      toInput.value = "";
      modeSelect.value = "all";
      movementSelect.value = "all";
      teammateSelect.value = "all";
      countrySelect.value = "all";
      refreshAnalysisHandler?.({ gameMode: "all", movementType: "all", teammateId: "all", country: "all" });
    });

    settingsBtn.addEventListener("click", () => {
      if (analysisWindow) openSettingsOverlay(analysisWindow);
    });
    analysisWindow = {
      win,
      doc,
      shell,
      modalTitle,
      controls,
      filterControlWrappers,
      fromInput,
      toInput,
      modeSelect,
      movementSelect,
      teammateSelect,
      countrySelect,
      settingsBtn,
      tocWrap,
      modalBody,
      settingsOverlay
    };
    applyThemeToWindow(analysisWindow);
    applyFilterVisibility(analysisWindow);
    if (lastAnalysisData) populateAnalysisWindow(lastAnalysisData);
    return analysisWindow;
  }

  document.body.appendChild(iconBtn);
  document.body.appendChild(panel);

  let open = false;
  function setOpen(v: boolean) {
    open = v;
    panel.style.display = open ? "block" : "none";
  }

  iconBtn.addEventListener("click", () => setOpen(!open));
  closeBtn.addEventListener("click", () => setOpen(false));

  let updateHandler: (() => void) | null = null;
  let resetHandler: (() => void) | null = null;
  let exportHandler: (() => void) | null = null;
  let tokenHandler: (() => void) | null = null;
  let openAnalysisHandler: (() => void) | null = null;
  let refreshAnalysisHandler: ((
    filter: {
      fromTs?: number;
      toTs?: number;
      gameMode?: string;
      movementType?: "all" | "moving" | "no_move" | "nmpz" | "unknown";
      teammateId?: string;
      country?: string;
    }
  ) => void) | null = null;

  updateBtn.addEventListener("click", () => updateHandler?.());
  tokenBtn.addEventListener("click", () => tokenHandler?.());
  exportBtn.addEventListener("click", () => exportHandler?.());
  resetBtn.addEventListener("click", () => resetHandler?.());
  analysisBtn.addEventListener("click", () => {
    try {
      const win = ensureAnalysisWindow();
      if (!win) {
        status.textContent = "Could not open analysis window (popup blocked?).";
        return;
      }
      openAnalysisHandler?.();
    } catch (e) {
      status.textContent = `Analysis open failed: ${e instanceof Error ? e.message : String(e)}`;
      console.error("[GeoAnalyzr] Failed to open analysis window", e);
    }
  });

  function renderSection(section: AnalysisSection, doc: Document, renderTitle = section.title): HTMLElement {
    const palette = getThemePalette();
    const card = doc.createElement("div");
    card.id = `section-${section.id}`;
    card.style.border = `1px solid ${palette.border}`;
    card.style.borderRadius = "12px";
    card.style.background = palette.panel;
    card.style.padding = "12px";
    card.style.scrollMarginTop = "110px";
    card.style.boxShadow = "0 10px 30px rgba(0,0,0,0.2)";

    const topMeta = doc.createElement("div");
    topMeta.style.display = "flex";
    topMeta.style.gap = "8px";
    topMeta.style.flexWrap = "wrap";
    topMeta.style.marginBottom = "6px";

    if (section.appliesFilters && section.appliesFilters.length > 0) {
      const applies = doc.createElement("span");
      applies.textContent = `Filters: ${section.appliesFilters.join(", ")}`;
      applies.style.background = palette.panelAlt;
      applies.style.color = palette.textMuted;
      applies.style.border = `1px solid ${palette.border}`;
      applies.style.borderRadius = "999px";
      applies.style.padding = "2px 8px";
      applies.style.fontSize = "11px";
      topMeta.appendChild(applies);
    }

    const sectionTemplate = getSectionTemplate(section);
    const requiredFilters = sectionTemplate?.requiredFilters;
    const requiredFilterRow = doc.createElement("div");
    requiredFilterRow.style.display = "flex";
    requiredFilterRow.style.flexWrap = "wrap";
    requiredFilterRow.style.gap = "8px";
    requiredFilterRow.style.alignItems = "center";
    requiredFilterRow.style.marginBottom = "8px";

    const addSectionFilterSelect = (
      labelText: string,
      options: Array<{ value: string; label: string }>,
      selectedValue: string,
      onChange: (nextValue: string) => void
    ) => {
      if (options.length === 0) return;
      const label = doc.createElement("label");
      label.style.display = "inline-flex";
      label.style.alignItems = "center";
      label.style.gap = "6px";
      label.style.fontSize = "12px";
      label.style.color = palette.textMuted;
      label.style.background = palette.panelAlt;
      label.style.border = `1px solid ${palette.border}`;
      label.style.borderRadius = "999px";
      label.style.padding = "3px 8px";
      const text = doc.createElement("span");
      text.textContent = labelText;
      const select = doc.createElement("select");
      select.style.background = palette.buttonBg;
      select.style.color = palette.buttonText;
      select.style.border = `1px solid ${palette.border}`;
      select.style.borderRadius = "999px";
      select.style.padding = "2px 8px";
      select.style.fontSize = "12px";
      for (const optIn of options) {
        const opt = doc.createElement("option");
        opt.value = optIn.value;
        opt.textContent = optIn.label;
        select.appendChild(opt);
      }
      if ([...select.options].some((o) => o.value === selectedValue)) select.value = selectedValue;
      select.addEventListener("change", () => onChange(select.value));
      label.appendChild(text);
      label.appendChild(select);
      requiredFilterRow.appendChild(label);
    };

    const refs = analysisWindow;
    const data = lastAnalysisData;
    if (refs && data && refreshAnalysisHandler) {
      const currentFrom = parseDateInput(refs.fromInput.value, false);
      const currentTo = parseDateInput(refs.toInput.value, true);
      const currentMode = refs.modeSelect.value || "all";
      const currentMovement = (refs.movementSelect.value || "all") as "all" | "moving" | "no_move" | "nmpz" | "unknown";
      const currentTeammate = refs.teammateSelect.value || "all";
      const currentCountry = refs.countrySelect.value || "all";

      if (requiredFilters?.teammate?.enabled && section.id === "teammate_battle") {
        const opts = data.availableTeammates.filter((t) => t.id !== "all");
        const defaultMate = opts[0]?.id;
        const selectedMate = currentTeammate !== "all" ? currentTeammate : defaultMate;
        if (selectedMate) {
          addSectionFilterSelect(
            requiredFilters.teammate.label || "Mate",
            opts.map((t) => ({ value: t.id, label: t.label })),
            selectedMate,
            (nextMate) => {
              if (!nextMate || nextMate === currentTeammate) return;
              refreshAnalysisHandler?.({
                fromTs: currentFrom,
                toTs: currentTo,
                gameMode: currentMode,
                movementType: currentMovement,
                teammateId: nextMate,
                country: currentCountry
              });
            }
          );
        }
      }
      if (requiredFilters?.country?.enabled && section.id === "country_spotlight") {
        const opts = data.availableCountries.filter((c) => c.code !== "all");
        const defaultCountry = opts[0]?.code;
        const selectedCountry = currentCountry !== "all" ? currentCountry : defaultCountry;
        if (selectedCountry) {
          addSectionFilterSelect(
            requiredFilters.country.label || "Country",
            opts.map((c) => ({ value: c.code, label: c.label })),
            selectedCountry,
            (nextCountry) => {
              if (!nextCountry || nextCountry === currentCountry) return;
              refreshAnalysisHandler?.({
                fromTs: currentFrom,
                toTs: currentTo,
                gameMode: currentMode,
                movementType: currentMovement,
                teammateId: currentTeammate,
                country: nextCountry
              });
            }
          );
        }
      }
    }

    const title2 = doc.createElement("div");
    title2.textContent = renderTitle;
    title2.style.fontWeight = "700";
    title2.style.marginBottom = "8px";
    title2.style.fontSize = "19px";
    title2.style.letterSpacing = "0.2px";
    title2.style.color = palette.text;
    const body = doc.createElement("div");
    body.style.display = "grid";
    body.style.gap = "8px";
    body.style.marginBottom = "10px";
    body.style.marginTop = "2px";
    const lineDrillMap = new Map((section.lineDrilldowns || []).map((d) => [d.lineLabel, d.items]));
    const lineLinkMap = new Map((section.lineLinks || []).map((d) => [d.lineLabel, d.url]));
    const layoutMode = sectionTemplate?.layout?.mode || "legacy_colon";
    const createLineRow = (line: string): HTMLDivElement => {
      const row = doc.createElement("div");
      row.style.padding = "9px 11px";
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.justifyContent = "space-between";
      row.style.gap = "12px";

      const sep = line.indexOf(":");
      if (sep > 0 && sep < line.length - 1) {
        const leftLabel = line.slice(0, sep).trim();
        const leftUrl = lineLinkMap.get(leftLabel);
        const left = leftUrl ? doc.createElement("a") : doc.createElement("span");
        left.textContent = leftLabel;
        left.style.fontSize = "13px";
        left.style.fontWeight = "600";
        left.style.color = leftUrl ? analysisSettings.accent : palette.textMuted;
        left.style.letterSpacing = "0.15px";
        if (leftUrl) {
          (left as HTMLAnchorElement).href = leftUrl;
          (left as HTMLAnchorElement).target = "_blank";
          (left as HTMLAnchorElement).rel = "noopener noreferrer";
        }

        const right = doc.createElement("span");
        right.textContent = line.slice(sep + 1).trim();
        right.style.fontSize = "14px";
        right.style.fontWeight = "700";
        right.style.color = palette.text;
        right.style.textAlign = "right";
        right.style.marginLeft = "auto";
        right.style.maxWidth = "68%";
        right.style.padding = "2px 8px";
        right.style.borderRadius = "999px";
        right.style.background = "rgba(255,255,255,0.08)";
        const drillItems = lineDrillMap.get(leftLabel) || [];
        if (drillItems.length > 0) {
          right.style.cursor = "pointer";
          right.style.textDecoration = "underline";
          right.title = `Open ${drillItems.length} matching rounds`;
          right.addEventListener("click", () => openDrilldownOverlay(doc, section.title, leftLabel, drillItems));
        }

        row.appendChild(left);
        row.appendChild(right);
      } else {
        const only = doc.createElement("span");
        only.textContent = line;
        only.style.fontSize = "13px";
        only.style.fontWeight = "600";
        only.style.color = palette.text;
        only.style.letterSpacing = "0.1px";
        row.appendChild(only);
      }
      return row;
    };

    const createStandaloneCard = (line: string): HTMLDivElement => {
      const row = createLineRow(line);
      row.style.border = `1px solid ${palette.border}`;
      row.style.background = palette.panelAlt;
      row.style.borderRadius = "8px";
      row.style.boxShadow = "inset 2px 0 0 rgba(255,255,255,0.08)";
      return row;
    };
    const appendGroupCard = (headerText: string, itemLines: string[]) => {
      if (itemLines.length === 0) return;
      const groupCard = doc.createElement("div");
      groupCard.style.border = `1px solid ${palette.border}`;
      groupCard.style.background = palette.panelAlt;
      groupCard.style.borderRadius = "8px";
      groupCard.style.boxShadow = "inset 2px 0 0 rgba(255,255,255,0.08)";
      groupCard.style.overflow = "hidden";

      const header = doc.createElement("div");
      header.textContent = headerText;
      header.style.padding = "9px 11px";
      header.style.fontSize = "13px";
      header.style.fontWeight = "700";
      header.style.color = palette.text;
      groupCard.appendChild(header);

      for (const itemLine of itemLines) {
        const itemRow = createLineRow(itemLine);
        itemRow.style.borderTop = `1px solid ${palette.border}`;
        groupCard.appendChild(itemRow);
      }
      body.appendChild(groupCard);
    };
    const renderLegacyColonLayout = () => {
      for (let i = 0; i < section.lines.length; i++) {
        const line = section.lines[i];
        const isGroupHeader = /:\s*$/.test(line);
        if (!isGroupHeader || i === section.lines.length - 1) {
          body.appendChild(createStandaloneCard(line));
          continue;
        }

        let end = i + 1;
        while (end < section.lines.length && !/:\s*$/.test(section.lines[end])) {
          end++;
        }
        appendGroupCard(line, section.lines.slice(i + 1, end));
        i = end - 1;
      }
    };

    const charts = section.charts ? section.charts : section.chart ? [section.chart] : [];
    const graphTemplates = sectionTemplate?.graphTemplates || [];
    const renderedChartIndices = new Set<number>();
    const appendChartByIndex = (chartIndex: number, overrideTitle?: string, overrideTemplate?: DesignGraphTemplate) => {
      const srcChart = charts[chartIndex];
      if (!srcChart) return;
      const activeTemplate = overrideTemplate || graphTemplates[chartIndex];
      const configured = applyGraphTemplateToChart(srcChart, activeTemplate);
      const chart = configured.chart;
      const baseChartTitle = chart.yLabel ? `${renderTitle} - ${chart.yLabel}` : `${renderTitle} - Chart ${chartIndex + 1}`;
      const chartTitle = overrideTitle ? `${renderTitle} - ${overrideTitle}` : configured.title ? `${renderTitle} - ${configured.title}` : baseChartTitle;
      if (chart.type === "line" && chart.points.length > 1) {
        body.appendChild(renderLineChart(chart, chartTitle, doc, activeTemplate));
        renderedChartIndices.add(chartIndex);
      }
      if (chart.type === "bar" && chart.bars.length > 0) {
        body.appendChild(renderBarChart(chart, chartTitle, doc, activeTemplate));
        renderedChartIndices.add(chartIndex);
      }
      if (chart.type === "selectableBar" && chart.options.length > 0) {
        body.appendChild(renderSelectableBarChart(chart, chartTitle, doc, activeTemplate));
        renderedChartIndices.add(chartIndex);
      }
      if (chart.type === "selectableLine" && chart.options.length > 0) {
        body.appendChild(renderSelectableLineChart(chart, chartTitle, doc, activeTemplate));
        renderedChartIndices.add(chartIndex);
      }
    };

    if (layoutMode === "object_order") {
      const layout = sectionTemplate?.layout?.mode === "object_order" ? sectionTemplate.layout : undefined;
      const singles = new Map((sectionTemplate?.objects?.singles || []).map((s) => [s.id, s]));
      const boxes = new Map((sectionTemplate?.objects?.boxes || []).map((b) => [b.id, b]));
      const graphs = new Map((sectionTemplate?.objects?.graphs || []).map((g) => [g.id, g]));

      const usedIndices = new Set<number>();
      const consumeLineByLabel = (label: string): string | undefined => {
        for (let i = 0; i < section.lines.length; i++) {
          if (usedIndices.has(i)) continue;
          if (matchesLineLabel(section.lines[i], label)) {
            usedIndices.add(i);
            return section.lines[i];
          }
        }
        return undefined;
      };

      let nextChartIndex = 0;
      const consumeNextChartIndex = (): number | undefined => {
        while (nextChartIndex < charts.length && renderedChartIndices.has(nextChartIndex)) nextChartIndex++;
        if (nextChartIndex >= charts.length) return undefined;
        const idx = nextChartIndex;
        nextChartIndex++;
        return idx;
      };

      for (const item of layout?.order || []) {
        if (item.kind === "single") {
          const single = singles.get(item.id);
          if (!single) continue;
          const typed = resolveTypedLine(single.type, section.id, single.sourceSectionId, single.label, designSourceLineLookup);
          if (typed) {
            consumeLineByLabel(single.label);
            const lineText = `${single.label}: ${typed.value}`;
            if (typed.drilldown) lineDrillMap.set(single.label, typed.drilldown);
            if (typed.link) lineLinkMap.set(single.label, typed.link);
            body.appendChild(createStandaloneCard(lineText));
            continue;
          }
          const line = consumeLineByLabel(single.label);
          if (line) body.appendChild(createStandaloneCard(line));
          continue;
        }
        if (item.kind === "box") {
          const box = boxes.get(item.id);
          if (!box) continue;
          consumeLineByLabel(box.title);
          const itemLines: string[] = [];
          const configuredLines = box.lines || [];
          if (configuredLines.length > 0) {
            for (const l of configuredLines) {
              const typed = resolveTypedLine(l.type, section.id, l.sourceSectionId, l.label, designSourceLineLookup);
              if (typed) {
                consumeLineByLabel(l.label);
                const lineText = `${l.label}: ${typed.value}`;
                if (typed.drilldown) lineDrillMap.set(l.label, typed.drilldown);
                if (typed.link) lineLinkMap.set(l.label, typed.link);
                itemLines.push(lineText);
                continue;
              }
              const line = consumeLineByLabel(l.label);
              if (line) itemLines.push(line);
            }
          } else {
            const headerIdx = section.lines.findIndex((line, i) => !usedIndices.has(i) && matchesLineLabel(line, box.title));
            if (headerIdx >= 0) {
              usedIndices.add(headerIdx);
              let end = headerIdx + 1;
              while (end < section.lines.length) {
                const nextTrim = section.lines[end].trim();
                if (/:\s*$/.test(nextTrim)) break;
                end++;
              }
              for (let i = headerIdx + 1; i < end; i++) {
                if (usedIndices.has(i)) continue;
                usedIndices.add(i);
                itemLines.push(section.lines[i]);
              }
            }
          }
          if (itemLines.length > 0) appendGroupCard(box.title.endsWith(":") ? box.title : `${box.title}:`, itemLines);
          continue;
        }
        if (item.kind === "graph") {
          const graph = graphs.get(item.id);
          const idx = typeof graph?.sourceIndex === "number" ? graph.sourceIndex : consumeNextChartIndex();
          if (typeof idx === "number") appendChartByIndex(idx, graph?.title, graph);
        }
      }

      if (layout?.preserveUnmatched !== false || (sectionTemplate?.render?.preserveUnmatchedLines ?? true)) {
        for (let i = 0; i < section.lines.length; i++) {
          if (usedIndices.has(i)) continue;
          body.appendChild(createStandaloneCard(section.lines[i]));
        }
      }
    } else if (layoutMode === "header_blocks") {
      const layout = sectionTemplate?.layout?.mode === "header_blocks" ? sectionTemplate.layout : undefined;
      const headers = layout?.headers || [];
      const boxes = layout?.boxes || [];
      const singles = layout?.single || [];
      const usedIndices = new Set<number>();
      const consumeLineByLabel = (label: string): string | undefined => {
        for (let i = 0; i < section.lines.length; i++) {
          if (usedIndices.has(i)) continue;
          if (matchesLineLabel(section.lines[i], label)) {
            usedIndices.add(i);
            return section.lines[i];
          }
        }
        return undefined;
      };

      if (boxes.length > 0 || singles.length > 0) {
        for (const s of singles) {
          const line = consumeLineByLabel(s.label);
          if (line) body.appendChild(createStandaloneCard(line));
        }
        for (const b of boxes) {
          const itemLines: string[] = [];
          for (const l of b.lines || []) {
            const line = consumeLineByLabel(l.label);
            if (line) itemLines.push(line);
          }
          if (itemLines.length > 0) appendGroupCard(b.title.endsWith(":") ? b.title : `${b.title}:`, itemLines);
        }
      } else {
        for (let i = 0; i < section.lines.length; i++) {
          if (usedIndices.has(i)) continue;
          const trimmed = section.lines[i].trim();
          if (headers.some((h) => trimmed === `${h}:` || trimmed === h)) break;
          body.appendChild(createStandaloneCard(section.lines[i]));
          usedIndices.add(i);
        }

        for (const header of headers) {
          const idx = section.lines.findIndex((line, i) => !usedIndices.has(i) && (line.trim() === `${header}:` || line.trim() === header));
          if (idx < 0) continue;
          usedIndices.add(idx);
          let end = idx + 1;
          while (end < section.lines.length) {
            const nextTrim = section.lines[end].trim();
            if (headers.some((h) => nextTrim === `${h}:` || nextTrim === h)) break;
            end++;
          }
          const itemLines: string[] = [];
          for (let i = idx + 1; i < end; i++) {
            usedIndices.add(i);
            itemLines.push(section.lines[i]);
          }
          appendGroupCard(section.lines[idx], itemLines);
        }
      }

      if (layout?.preserveUnmatched !== false || (sectionTemplate?.render?.preserveUnmatchedLines ?? true)) {
        for (let i = 0; i < section.lines.length; i++) {
          if (usedIndices.has(i)) continue;
          body.appendChild(createStandaloneCard(section.lines[i]));
        }
      }
    } else {
      renderLegacyColonLayout();
    }
    card.appendChild(topMeta);
    if (requiredFilterRow.childElementCount > 0) card.appendChild(requiredFilterRow);
    card.appendChild(title2);
    card.appendChild(body);

    for (let i = 0; i < charts.length; i++) {
      if (renderedChartIndices.has(i)) continue;
      appendChartByIndex(i);
    }
    return card;
  }

  function showNcfaManagerModal(options: {
    initialToken?: string;
    helpText: string;
    repoUrl: string;
    onSave: (token: string) => Promise<{ saved: boolean; token?: string; message: string }>;
    onAutoDetect: () => Promise<{ detected: boolean; token?: string; source?: "stored" | "cookie" | "session" | "none"; message: string }>;
  }) {
    const dark = {
      panel: "#111827",
      panelAlt: "#0b1220",
      border: "#334155",
      text: "#e5e7eb",
      textMuted: "#93a4bc"
    };
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,0.75)";
    overlay.style.zIndex = "1000006";
    overlay.style.display = "grid";
    overlay.style.placeItems = "center";
    overlay.style.padding = "16px";

    const modal = document.createElement("div");
    modal.style.width = "min(640px, 96vw)";
    modal.style.border = `1px solid ${dark.border}`;
    modal.style.borderRadius = "12px";
    modal.style.background = dark.panel;
    modal.style.color = dark.text;
    modal.style.boxShadow = "0 10px 30px rgba(0,0,0,0.45)";
    modal.style.padding = "14px";

    const head = document.createElement("div");
    head.style.display = "flex";
    head.style.justifyContent = "space-between";
    head.style.alignItems = "center";
    head.style.marginBottom = "10px";
    const headTitle = document.createElement("div");
    headTitle.textContent = "NCFA Token Manager";
    headTitle.style.fontWeight = "700";
    const closeBtn2 = document.createElement("button");
    closeBtn2.textContent = "x";
    closeBtn2.style.background = "transparent";
    closeBtn2.style.border = "none";
    closeBtn2.style.color = dark.text;
    closeBtn2.style.cursor = "pointer";
    closeBtn2.style.fontSize = "18px";
    head.appendChild(headTitle);
    head.appendChild(closeBtn2);

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "_ncfa value";
    input.value = options.initialToken || "";
    input.style.width = "100%";
    input.style.boxSizing = "border-box";
    input.style.background = dark.panelAlt;
    input.style.color = dark.text;
    input.style.border = `1px solid ${dark.border}`;
    input.style.borderRadius = "8px";
    input.style.padding = "8px 10px";
    input.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    input.style.fontSize = "12px";

    const feedback = document.createElement("div");
    feedback.style.marginTop = "8px";
    feedback.style.fontSize = "12px";
    feedback.style.color = dark.textMuted;
    feedback.textContent = "Set manually or use auto-detect.";

    const actions = document.createElement("div");
    actions.style.display = "grid";
    actions.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
    actions.style.gap = "8px";
    actions.style.marginTop = "12px";

    function mkSmallBtn(label: string, bg: string, onClick: () => void) {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.padding = "9px 10px";
      b.style.borderRadius = "8px";
      b.style.border = "1px solid rgba(255,255,255,0.2)";
      b.style.background = bg;
      b.style.color = "#fff";
      b.style.cursor = "pointer";
      b.style.fontWeight = "600";
      b.addEventListener("click", onClick);
      return b;
    }

    const saveBtn = mkSmallBtn("Save Manually", "rgba(95,95,30,0.45)", async () => {
      saveBtn.disabled = true;
      try {
        const res = await options.onSave(input.value);
        input.value = res.token || "";
        feedback.textContent = res.message;
      } catch (e) {
        feedback.textContent = `Save failed: ${e instanceof Error ? e.message : String(e)}`;
      } finally {
        saveBtn.disabled = false;
      }
    });

    const autoBtn = mkSmallBtn("Auto-Detect", "rgba(35,95,160,0.45)", async () => {
      autoBtn.disabled = true;
      try {
        const res = await options.onAutoDetect();
        if (res.token) input.value = res.token;
        feedback.textContent = res.message;
      } catch (e) {
        feedback.textContent = `Auto-detect failed: ${e instanceof Error ? e.message : String(e)}`;
      } finally {
        autoBtn.disabled = false;
      }
    });

    const helpBtn = mkSmallBtn("Show Instructions", "rgba(40,120,50,0.45)", () => {
      window.open(options.repoUrl, "_blank");
    });

    const closeRedBtn = mkSmallBtn("Close", "rgba(160,35,35,0.55)", () => {
      closeModal();
    });

    actions.appendChild(saveBtn);
    actions.appendChild(autoBtn);
    actions.appendChild(helpBtn);
    actions.appendChild(closeRedBtn);

    const hint = document.createElement("div");
    hint.style.marginTop = "10px";
    hint.style.fontSize = "11px";
    hint.style.color = dark.textMuted;
    hint.textContent = "Auto-detect checks stored token, then cookie access, then authenticated session (cookie can be HttpOnly).";

    modal.appendChild(head);
    modal.appendChild(input);
    modal.appendChild(feedback);
    modal.appendChild(actions);
    modal.appendChild(hint);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    function closeModal() {
      overlay.remove();
    }
    closeBtn2.addEventListener("click", closeModal);
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) closeModal();
    });
  }

  return {
    setVisible(visible) {
      iconBtn.style.display = visible ? "flex" : "none";
      if (!visible) {
        panel.style.display = "none";
        if (analysisWindow && !analysisWindow.win.closed) {
          analysisWindow.win.close();
        }
      }
    },
    setStatus(msg) {
      status.textContent = msg;
    },
    setCounts(value) {
      counts.textContent = `Data: ${value.games} games, ${value.rounds} rounds.`;
    },
    setAnalysisWindowData(data) {
      lastAnalysisData = data;
      populateAnalysisWindow(data);
    },
    onUpdateClick(fn) {
      updateHandler = fn;
    },
    onResetClick(fn) {
      resetHandler = fn;
    },
    onExportClick(fn) {
      exportHandler = fn;
    },
    onTokenClick(fn) {
      tokenHandler = fn;
    },
    openNcfaManager(options) {
      showNcfaManagerModal(options);
    },
    onOpenAnalysisClick(fn) {
      openAnalysisHandler = fn;
    },
    onRefreshAnalysisClick(fn) {
      refreshAnalysisHandler = fn;
    }
  };
}

