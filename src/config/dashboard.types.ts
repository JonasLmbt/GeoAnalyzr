import type { Grain, ChartType, SortMode } from "./semantic.types";

export interface PlacementDef {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SelectorDef {
  mode: "all" | "top_n" | "selected";
  maxSeries?: number;
  n?: number;
  values?: string[];
}

export interface SortDef {
  mode: SortMode;
}

export interface FilterClause {
  dimension: string;
  op: "eq" | "neq" | "in" | "nin";
  value?: unknown;
  values?: unknown[];
}

export type GlobalFilterGrain = Grain;

export type GlobalFiltersSpec = {
  enabled: boolean;
  layout?: {
    variant?: "compact" | "full";
  };
  controls: FilterControlSpec[];
  buttons?: {
    apply?: boolean;
    reset?: boolean;
  };
};

export type FilterControlSpec = DateRangeControlSpec | SelectControlSpec;

export type DateRangeValue = {
  fromTs: number | null;
  toTs: number | null;
};

export type DateRangeControlSpec = {
  id: string;
  type: "date_range";
  label: string;
  // Optional fixed width in CSS px for this control in the global filter bar.
  // If omitted, the control sizes naturally.
  width?: number;
  default: DateRangeValue;
  appliesTo: GlobalFilterGrain[];
};

export type SelectOptionsSpec = "auto_distinct" | "auto_teammates";

export type MapPickerSpec = {
  variant?: "compact" | "wide";
  // Height in CSS px for the map container.
  height?: number;
  // If true, only countries present in the select options are selectable/highlighted.
  restrictToOptions?: boolean;
  // If true, lightly tint selectable countries.
  tintSelectable?: boolean;
};

export type SelectControlSpec = {
  id: string;
  type: "select";
  label: string;
  // Optional fixed width in CSS px for this control in the global filter bar.
  // If omitted, the control sizes naturally.
  width?: number;
  dimension: string;
  // Optional UI hint. Default: dropdown.
  presentation?: "dropdown" | "map";
  map?: MapPickerSpec;
  default: "all" | string;
  options: SelectOptionsSpec;
  appliesTo: GlobalFilterGrain[];
};

export type LocalFiltersSpec = {
  // Default: enabled
  enabled?: boolean;
  controls: LocalFilterControlSpec[];
  buttons?: {
    reset?: boolean;
  };
};

export type LocalSelectOptionsSpec = SelectOptionsSpec;

export type LocalFilterControlSpec = {
  id: string;
  type: "select";
  label: string;
  dimension: string;
  // Optional UI hint. Default: dropdown.
  presentation?: "dropdown" | "map";
  map?: MapPickerSpec;
  // "auto_top" = pick the most frequent option in the current section dataset.
  default: "auto_top" | string;
  options: LocalSelectOptionsSpec;
  appliesTo: GlobalFilterGrain[];
  // If true, there is no "All" option and a value is always selected.
  required?: boolean;
};

export interface DrilldownClickAction {
  type: "drilldown";
  target: "rounds" | "games" | "sessions" | "players";
  columnsPreset: string;
  filterFromPoint?: boolean;
  extraFilters?: FilterClause[];
  initialSort?: { key: string; dir?: "asc" | "desc" };
}

export interface Actions {
  hover?: boolean;
  click?: DrilldownClickAction;
}

export interface ChartSpec {
  type: ChartType;
  color?: string;
  limit?: number;
  // For ordered x-axes (especially time), automatically bucket data down to this many points at most.
  maxPoints?: number;
  x: {
    dimension: string;
    selector?: SelectorDef;
  };
  y: {
    measure?: string;
    measures?: string[];
    activeMeasure?: string;
    // For ordered time axes (e.g. time_day), allow switching between per-period values and cumulative "to date".
    accumulation?: "period" | "to_date";
    accumulations?: Array<"period" | "to_date">;
    activeAccumulation?: "period" | "to_date";
  };
  series?: {
    dimension: string;
    selector: SelectorDef;
  };
  // Single sort (legacy + simplest form).
  sort?: SortDef;
  // Multiple selectable sorts.
  sorts?: SortDef[];
  // Which sort to use by default when using `sorts`.
  activeSort?: SortDef;
  actions?: Actions;
}

export interface StatRowDef {
  label: string;
  measure: string;
  // Optional second measure to show as "(...)" next to the primary value.
  secondaryMeasure?: string;
  // Optional override to compute the row at a different grain than the widget.
  // This allows "overview" stat lists to mix e.g. game and round measures without hardcoding.
  grain?: Grain;
  filters?: FilterClause[];
  actions?: Actions;
}

export interface StatListSpec {
  rows: StatRowDef[];
}

export interface StatValueSpec {
  label: string;
  measure: string;
  actions?: Actions;
}

export interface BreakdownSpec {
  color?: string;
  // If true, allow expanding beyond `limit` to show all rows.
  extendable?: boolean;
  dimension: string;
  // Optional list of dimension keys to hide (case-insensitive match on displayed key).
  excludeKeys?: string[];
  // Single-measure breakdown (legacy + simplest form).
  measure?: string;
  // Multi-measure breakdown. If provided, a select will be shown to switch active measure.
  measures?: string[];
  // Which measure to show by default when using `measures`.
  activeMeasure?: string;
  // Single sort (legacy + simplest form).
  sort?: SortDef;
  // Multiple selectable sorts.
  sorts?: SortDef[];
  // Which sort to use by default when using `sorts`.
  activeSort?: SortDef;
  limit?: number;
  filters?: FilterClause[];
  actions?: Actions;
}

export interface CountryMetricMapSpec {
  dimension: string;
  // Single-measure (legacy + simplest form).
  measure?: string;
  // Multi-measure. If provided, a select will be shown to switch active measure.
  measures?: string[];
  activeMeasure?: string;
  // Optional fixed height in CSS px for the map container.
  mapHeight?: number;
  filters?: FilterClause[];
  actions?: Actions;
}

export interface RegionMetricMapSpec {
  dimension: string;
  geojsonUrl: string;
  // Feature property name used as key (must match the extracted dimension values).
  featureKey: string;
  measure?: string;
  measures?: string[];
  activeMeasure?: string;
  mapHeight?: number;
  filters?: FilterClause[];
  actions?: Actions;
}

export interface MultiViewItemDef {
  id: string;
  label: string;
  type: WidgetDef["type"];
  grain: Grain;
  spec: WidgetDef["spec"];
}

export interface MultiViewSpec {
  views: MultiViewItemDef[];
  activeView?: string;
}

export interface RecordItemDef {
  id: string;
  label: string;
  kind?: "group_extreme" | "overall" | "streak" | "same_value_streak";
  // group_extreme:
  metric?: string;
  groupBy?: string;
  extreme?: "max" | "min";
  // Optional filters applied before computing the record.
  filters?: FilterClause[];
  // streak:
  streakFilters?: FilterClause[];
  // same_value_streak:
  dimension?: string;
  // presentation:
  displayKey?: "group" | "first_ts" | "first_ts_score";
  actions?: Actions;
}

export interface RecordListSpec {
  records: RecordItemDef[];
}

export interface LeaderListRowDef {
  label: string;
  dimension: string;
  // Optional filters applied before computing the leader.
  filters?: FilterClause[];
  // Keys to ignore when computing leader share (e.g. ["Tie"]).
  excludeKeys?: string[];
  // Optional drilldown action when clicking the row.
  actions?: Actions;
}

export interface WidgetDef {
  widgetId: string;
  type: "chart" | "stat_list" | "stat_value" | "breakdown" | "country_map" | "region_map" | "multi_view" | "record_list" | "leader_list";
  title: string;
  grain: Grain;
  placement?: PlacementDef;
  // Optional: only render the widget when a local filter has one of the expected values.
  // Useful for country-specific insight widgets (e.g. Germany-only region breakdowns).
  showIfLocal?: { id: string; in: string[] };
  spec: ChartSpec | StatListSpec | StatValueSpec | BreakdownSpec | CountryMetricMapSpec | RegionMetricMapSpec | MultiViewSpec | RecordListSpec | { rows: LeaderListRowDef[] };
}

export interface CompositeCardDef {
  type: "composite";
  children: WidgetDef[];
}

export interface CardPlacementDef extends PlacementDef {
  cardId: string;
  title: string;
  card: CompositeCardDef;
}

export interface SectionDef {
  id: string;
  title: string;
  // Control which global filter controls apply to this section. Default: all.
  // `include`/`exclude` refer to control ids from dashboard.globalFilters.controls[].id.
  filterScope?: {
    include?: string[];
    exclude?: string[];
  };
  // Section-local filters (rendered inside the tab, above the cards).
  localFilters?: LocalFiltersSpec;
  layout: {
    mode: "grid";
    columns: number;
    cards: CardPlacementDef[];
  };
}

export interface DashboardDoc {
  $schema?: string;
  schemaVersion: string;
  dashboard: {
    id: string;
    title: string;
    // Optional UI title templates (supports {{playerName}} and {{dashboardTitle}}).
    ui?: {
      topbarTitle?: string;
      windowTitle?: string;
    };
    globalFilters?: GlobalFiltersSpec;
    sections: SectionDef[];
  };
}
