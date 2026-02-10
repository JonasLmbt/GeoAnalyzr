import type { FilterClause } from "../config/dashboard.types";
import type { RoundRow } from "../db";
import { ROUND_DIMENSION_EXTRACTORS } from "./dimensions";

function evalClause(value: unknown, clause: FilterClause): boolean {
  if (clause.op === "eq") return value === clause.value;
  if (clause.op === "neq") return value !== clause.value;
  if (clause.op === "in") return Array.isArray(clause.values) && clause.values.includes(value);
  if (clause.op === "nin") return Array.isArray(clause.values) && !clause.values.includes(value);
  return true;
}

function evalRowFilter(row: RoundRow, clause: FilterClause): boolean {
  const extractor = ROUND_DIMENSION_EXTRACTORS[clause.dimension];
  if (extractor) {
    return evalClause(extractor(row), clause);
  }
  const direct = (row as any)[clause.dimension];
  return evalClause(direct, clause);
}

export function applyFilters(rows: RoundRow[], clauses: FilterClause[] | undefined): RoundRow[] {
  if (!clauses || clauses.length === 0) return rows;
  return rows.filter((row) => clauses.every((clause) => evalRowFilter(row, clause)));
}
