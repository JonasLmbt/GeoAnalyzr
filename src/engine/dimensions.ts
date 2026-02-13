// src/engine/dimensions.ts
import type { RoundRow } from "../db";
import type { Grain } from "../config/semantic.types";
import { getSelfScore, getPlayedAt, getTrueCountry, getMovementType, getDurationSeconds, getTeammateName, getGuessCountrySelf } from "./fieldAccess";

export type GroupKey = string;

function getRowTs(row: any): number | undefined {
  const a = row?.playedAt;
  if (typeof a === "number" && Number.isFinite(a)) return a;
  const b = row?.ts;
  if (typeof b === "number" && Number.isFinite(b)) return b;
  return undefined;
}

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

export function isHitKey(r: RoundRow): GroupKey | null {
  const truth = getTrueCountry(r);
  if (!truth) return null;
  const guess = getGuessCountrySelf(r);
  return typeof guess === "string" && guess === truth ? "true" : "false";
}

export function isThrowKey(r: RoundRow): GroupKey | null {
  const s = getSelfScore(r);
  if (typeof s !== "number") return null;
  return s < 50 ? "true" : "false";
}

export function isDamageDealtKey(r: any): GroupKey | null {
  const dmg = r?.damage;
  if (typeof dmg !== "number" || !Number.isFinite(dmg)) return null;
  return dmg > 0 ? "true" : "false";
}

export function isDamageTakenKey(r: any): GroupKey | null {
  const dmg = r?.damage;
  if (typeof dmg !== "number" || !Number.isFinite(dmg)) return null;
  return dmg < 0 ? "true" : "false";
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

export function confusedCountriesKey(r: RoundRow): GroupKey | null {
  const truthRaw = getTrueCountry(r);
  const guessRaw = getGuessCountrySelf(r);
  if (typeof truthRaw !== "string" || typeof guessRaw !== "string") return null;
  const truth = truthRaw.trim();
  const guess = guessRaw.trim();
  if (!truth || !guess) return null;
  if (truth === guess) return null;

  const pretty = (v: string): string => (v.length <= 3 ? v.toUpperCase() : v);
  return `${pretty(truth)} -> ${pretty(guess)}`;
}

function timeDayKeyAny(row: any): GroupKey | null {
  const ts = getRowTs(row);
  if (typeof ts !== "number") return null;
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function weekdayKeyAny(row: any): GroupKey | null {
  const ts = getRowTs(row);
  if (typeof ts !== "number") return null;
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return names[new Date(ts).getDay()];
}

function hourKeyAny(row: any): GroupKey | null {
  const ts = getRowTs(row);
  if (typeof ts !== "number") return null;
  return String(new Date(ts).getHours()).padStart(2, "0");
}

function asTrimmedString(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : undefined;
}

function gameModeKeyAny(row: any): GroupKey | null {
  const v = asTrimmedString(row?.gameModeSimple ?? row?.gameMode ?? row?.mode ?? row?.game_mode);
  return v ? v : null;
}

function modeFamilyKeyAny(row: any): GroupKey | null {
  const v = asTrimmedString(row?.modeFamily ?? row?.mode_family);
  if (!v) return null;
  if (v === "duels") return "Duel";
  if (v === "teamduels") return "Team Duel";
  if (v === "standard") return "Standard";
  if (v === "streak") return "Streak";
  return v;
}

function resultKeyAny(row: any): GroupKey | null {
  const r = asTrimmedString(row?.result);
  if (r) return r;
  const v =
    typeof row?.player_self_victory === "boolean"
      ? row.player_self_victory
      : typeof row?.teamOneVictory === "boolean"
        ? row.teamOneVictory
        : typeof row?.playerOneVictory === "boolean"
          ? row.playerOneVictory
          : undefined;
  if (typeof v === "boolean") return v ? "Win" : "Loss";
  return null;
}

export const DIMENSION_EXTRACTORS: Record<Grain, Record<string, (row: any) => GroupKey | null>> = {
  round: {
    score_bucket: scoreBucketKey,
    round_id: (r: any) => {
      const gid = typeof r?.gameId === "string" ? r.gameId : "";
      const rn = typeof r?.roundNumber === "number" ? r.roundNumber : null;
      if (!gid || rn === null) return null;
      return `${gid}#${rn}`;
    },
    time_day: timeDayKey,
    weekday: weekdayKey,
    hour: hourKey,
    game_id: (r: any) => (typeof r?.gameId === "string" && r.gameId.trim().length ? r.gameId : null),
    true_country: trueCountryKey,
    movement_type: movementTypeKey,
    is_hit: isHitKey,
    is_throw: isThrowKey,
    is_damage_dealt: isDamageDealtKey,
    is_damage_taken: isDamageTakenKey,
    is_near_perfect: (r: any) => {
      const s = getSelfScore(r as any);
      if (typeof s !== "number") return null;
      return s >= 4500 ? "true" : "false";
    },
    is_low_score: (r: any) => {
      const s = getSelfScore(r as any);
      if (typeof s !== "number") return null;
      return s < 500 ? "true" : "false";
    },
    duration_bucket: durationBucketKey,
    confused_countries: confusedCountriesKey,
    teammate_name: teammateNameKey,
    round_number: (r: any) => (typeof r?.roundNumber === "number" ? `#${r.roundNumber}` : null)
  },
  game: {
    time_day: timeDayKeyAny,
    weekday: weekdayKeyAny,
    hour: hourKeyAny,
    game_id: (g: any) => (typeof g?.gameId === "string" && g.gameId.trim().length ? g.gameId : null),
    game_mode: gameModeKeyAny,
    mode_family: modeFamilyKeyAny,
    result: resultKeyAny,
    game_length: (g: any) => {
      const n = (g as any).roundsCount;
      if (typeof n !== "number" || !Number.isFinite(n)) return null;
      if (n < 2) return null;
      return String(Math.round(n));
    }
  },
  session: {
    session_index: (row: any) => (typeof row?.sessionIndex === "number" ? String(row.sessionIndex) : null),
    session_start: (row: any) => {
      const ts = typeof row?.sessionStartTs === "number" ? row.sessionStartTs : typeof row?.ts === "number" ? row.ts : null;
      if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
      const d = new Date(ts);
      const day = String(d.getDate()).padStart(2, "0");
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const y = d.getFullYear();
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return `${day}/${m}/${y} ${hh}:${mm}`;
    }
  }
};

// Backwards compat for older imports.
export const ROUND_DIMENSION_EXTRACTORS = DIMENSION_EXTRACTORS.round;
