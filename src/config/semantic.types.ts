export type Grain = "session" | "game" | "round";
export type ChartType = "bar" | "line";
export type SortMode = "chronological" | "asc" | "desc";

export interface DatasetDef {
  primaryKey: string[];
  timeField: string;
}

export interface CardinalityDef {
  policy: "small" | "large";
  maxSeries: number;
  selectorRequired?: boolean;
}

export interface DimensionDef {
  label: string;
  kind: "time" | "category";
  // Dimension can be available at one or multiple grains.
  grain: Grain | Grain[];
  ordered?: boolean;
  allowedCharts: ChartType[];
  sortModes: SortMode[];
  cardinality?: CardinalityDef;
}

export interface MeasureDef {
  label: string;
  unit: string;
  grain: Grain;
  allowedCharts: ChartType[];
  formulaId: string;
}

export interface UnitDef {
  format: "int" | "float" | "percent" | "duration";
  decimals?: number;
}

export interface DrilldownPresetDef {
  entity: Grain;
  columnsPresets: Record<string, DrilldownColumnSpec[]>;
  defaultPreset: string;
}

export type DrilldownColumnSpec = string | DrilldownColumnDef;

export interface DrilldownColumnDef {
  key: string;
  label?: string;
  sortable?: boolean;
  colored?: boolean;
  display?: {
    truncate?: boolean;
    truncateHead?: number;
  };
  type?: "text" | "link";
  link?: {
    kind: "guess_maps" | "street_view";
    label?: string;
  };
}

export interface SemanticRegistry {
  $schema?: string;
  schemaVersion: string;
  grains: Grain[];
  datasets: Record<Grain, DatasetDef>;
  settings?: {
    sessionGapMinutesDefault?: number;
  };
  dimensions: Record<string, DimensionDef>;
  measures: Record<string, MeasureDef>;
  units: Record<string, UnitDef>;
  drilldownPresets: {
    rounds?: DrilldownPresetDef;
    games?: DrilldownPresetDef;
    sessions?: DrilldownPresetDef;
    players?: DrilldownPresetDef;
  };
  columnAliases?: Record<string, string[]>;
  errors?: Record<string, string>;
}
