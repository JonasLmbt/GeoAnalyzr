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
  grain: Grain;
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
  format: "int" | "float" | "percent";
  decimals?: number;
}

export interface DrilldownPresetDef {
  entity: Grain;
  columnsPresets: Record<string, string[]>;
  defaultPreset: string;
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
