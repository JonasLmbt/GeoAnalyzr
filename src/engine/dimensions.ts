// src/engine/dimensions.ts
import type { RoundRow } from "../db";
import { getSelfScore, getPlayedAt, getTrueCountry, getMovementType, getDurationSeconds, getTeammateName } from "./fieldAccess";

export type GroupKey = string;

export function scoreBucketKey(r: RoundRow): GroupKey | null {
  const s = getSelfScore(r);
  if (typeof s !== "number") return null;

  // Bucket into 100-point bins; keep 5000 as special
  if (s >= 5000) return "5000";
  const lo = Math.max(0, Math.floor(s / 100) * 100);
  const hi = lo + 99;
  return `${lo}-${hi}`;
}

export function timeDayKey(r: RoundRow): GroupKey | null {
  const ts = getPlayedAt(r);
  if (typeof ts !== "number") return null;
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function weekdayKey(r: RoundRow): GroupKey | null {
  const ts = getPlayedAt(r);
  if (typeof ts !== "number") return null;
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return names[new Date(ts).getDay()];
}

export function hourKey(r: RoundRow): GroupKey | null {
  const ts = getPlayedAt(r);
  if (typeof ts !== "number") return null;
  return String(new Date(ts).getHours()).padStart(2, "0");
}

export function trueCountryKey(r: RoundRow): GroupKey | null {
  const c = getTrueCountry(r);
  return typeof c === "string" && c.length ? c : null;
}

export function movementTypeKey(r: RoundRow): GroupKey | null {
  const v = getMovementType(r);
  return typeof v === "string" && v.length ? v : null;
}

export function durationBucketKey(r: RoundRow): GroupKey | null {
  const s = getDurationSeconds(r);
  if (typeof s !== "number" || !Number.isFinite(s) || s < 0) return null;
  // Keep these buckets aligned with the legacy "tempo" buckets.
  if (s < 20) return "<20 sec";
  if (s < 30) return "20-30 sec";
  if (s < 45) return "30-45 sec";
  if (s < 60) return "45-60 sec";
  if (s < 90) return "60-90 sec";
  if (s < 180) return "90-180 sec";
  return ">180 sec";
}

export function teammateNameKey(r: RoundRow): GroupKey | null {
  const n = getTeammateName(r);
  const v = typeof n === "string" ? n.trim() : "";
  return v.length ? v : null;
}

export const ROUND_DIMENSION_EXTRACTORS: Record<string, (r: RoundRow) => GroupKey | null> = {
  score_bucket: scoreBucketKey,
  time_day: timeDayKey,
  weekday: weekdayKey,
  hour: hourKey,
  true_country: trueCountryKey,
  movement_type: movementTypeKey,
  duration_bucket: durationBucketKey,
  teammate_name: teammateNameKey
};
