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
  default: DateRangeValue;
  appliesTo: GlobalFilterGrain[];
};

export type SelectOptionsSpec = "auto_distinct" | "auto_teammates";

export type SelectControlSpec = {
  id: string;
  type: "select";
  label: string;
  dimension: string;
  default: "all" | string;
  options: SelectOptionsSpec;
  appliesTo: GlobalFilterGrain[];
};

export interface DrilldownClickAction {
  type: "drilldown";
  target: "rounds" | "games" | "sessions" | "players";
  columnsPreset: string;
  filterFromPoint?: boolean;
  extraFilters?: FilterClause[];
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

export interface RecordItemDef {
  id: string;
  label: string;
  metric: string;
  groupBy: string;
  extreme: "max" | "min";
}

export interface RecordListSpec {
  records: RecordItemDef[];
}

export interface WidgetDef {
  widgetId: string;
  type: "chart" | "stat_list" | "stat_value" | "breakdown" | "record_list";
  title: string;
  grain: Grain;
  placement?: PlacementDef;
  spec: ChartSpec | StatListSpec | StatValueSpec | BreakdownSpec | RecordListSpec;
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
    globalFilters?: GlobalFiltersSpec;
    sections: SectionDef[];
  };
}
