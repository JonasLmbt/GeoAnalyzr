// src/engine/aggregate.ts
import type { RoundRow } from "../db";
import type { GroupKey } from "./dimensions";

export function groupByKey(
  rows: RoundRow[],
  keyFn: (r: RoundRow) => GroupKey | null
): Map<GroupKey, RoundRow[]> {
  const m = new Map<GroupKey, RoundRow[]>();
  for (const r of rows) {
    const k = keyFn(r);
    if (!k) continue;
    const arr = m.get(k);
    if (arr) arr.push(r);
    else m.set(k, [r]);
  }
  return m;
}
