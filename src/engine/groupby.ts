import { RoundRow } from "../db";

export type DimensionId =
  | "time_day"
  | "weekday"
  | "hour"
  | "country"
  | "score_bucket_0_5000";

export type GroupKey = string;

function playedAt(r: RoundRow): number | undefined {
  return (r as any).playedAt;
}

function scoreOfSelf(r: RoundRow): number | undefined {
  return (r as any).player_self_score;
}

export const DIMENSIONS: Record<DimensionId, (r: RoundRow) => GroupKey | null> = {
  time_day: (r) => {
    const ts = playedAt(r);
    if (typeof ts !== "number") return null;
    const d = new Date(ts);
    // YYYY-MM-DD
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  },

  weekday: (r) => {
    const ts = playedAt(r);
    if (typeof ts !== "number") return null;
    const d = new Date(ts);
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return names[d.getDay()];
  },

  hour: (r) => {
    const ts = playedAt(r);
    if (typeof ts !== "number") return null;
    return String(new Date(ts).getHours()).padStart(2, "0");
  },

  country: (r) => (typeof (r as any).trueCountry === "string" ? (r as any).trueCountry : null),

  score_bucket_0_5000: (r) => {
    const s = scoreOfSelf(r);
    if (typeof s !== "number") return null;
    const bucket = Math.max(0, Math.min(5000, Math.floor(s / 100) * 100));
    // e.g. "4900-4999", "5000"
    if (bucket >= 5000) return "5000";
    return `${bucket}-${bucket + 99}`;
  }
};

export function groupRows(rows: RoundRow[], dim: DimensionId): Map<GroupKey, RoundRow[]> {
  const f = DIMENSIONS[dim];
  const m = new Map<GroupKey, RoundRow[]>();
  for (const r of rows) {
    const k = f(r);
    if (!k) continue;
    const arr = m.get(k) ?? [];
    arr.push(r);
    m.set(k, arr);
  }
  return m;
}
