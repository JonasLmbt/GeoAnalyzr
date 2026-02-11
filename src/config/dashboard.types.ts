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
  limit?: number;
  x: {
    dimension: string;
    selector?: SelectorDef;
  };
  y: {
    measure?: string;
    measures?: string[];
    activeMeasure?: string;
  };
  series?: {
    dimension: string;
    selector: SelectorDef;
  };
  sort?: SortDef;
  actions?: Actions;
}

export interface StatRowDef {
  label: string;
  measure: string;
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
  dimension: string;
  measure: string;
  sort?: SortDef;
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
    sections: SectionDef[];
  };
}
