// src/engine/dimensions.ts
import type { RoundRow } from "../db";
import type { Grain } from "../config/semantic.types";
import {
  getSelfScore,
  getPlayedAt,
  getTrueCountry,
  getMovementType,
  getDurationSeconds,
  getTeammateName,
  getGuessCountrySelf,
  getMateScore,
  getMateDistanceKm,
  getDistanceKm
} from "./fieldAccess";

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

function isFlawlessWinKeyAny(row: any): GroupKey | null {
  const v = (row as any)?.isFlawlessWin;
  if (typeof v === "boolean") return v ? "true" : "false";
  return null;
}

function mapSlugKeyAny(row: any): GroupKey | null {
  const direct = asTrimmedString((row as any)?.mapSlug ?? (row as any)?.map_slug);
  if (direct) return direct;
  const raw = (row as any)?.raw;
  const v = asTrimmedString(raw?.options?.map?.slug ?? raw?.mapSlug ?? raw?.map?.slug);
  return v ? v : null;
}

function mapNameKeyAny(row: any): GroupKey | null {
  const direct = asTrimmedString((row as any)?.mapName ?? (row as any)?.map_name);
  if (direct) return direct;
  const raw = (row as any)?.raw;
  const v = asTrimmedString(raw?.options?.map?.name ?? raw?.mapName ?? raw?.map?.name);
  return v ? v : null;
}

function isRatedKeyAny(row: any): GroupKey | null {
  const direct = (row as any)?.isRated;
  if (direct === true) return "Rated";
  if (direct === false) return "Unrated";
  const raw = (row as any)?.raw;
  const v = raw?.options?.isRated;
  if (v === true) return "Rated";
  if (v === false) return "Unrated";

  // Best-effort inference for older payloads:
  const a = (row as any)?.player_self_startRating;
  const b = (row as any)?.player_self_endRating;
  if (typeof a === "number" && Number.isFinite(a) && typeof b === "number" && Number.isFinite(b)) return "Rated";
  return "Unknown";
}

function teammateKeyAny(row: any): GroupKey | null {
  const v = asTrimmedString(row?.teammateName ?? row?.teammate_name ?? row?.player_mate_name);
  return v ? v : null;
}

function movementTypeKeyAny(row: any): GroupKey | null {
  const v = asTrimmedString(row?.movementType ?? row?.movement_type ?? row?.gameModeSimple ?? row?.gameMode);
  if (!v) return null;
  const k = v.toLowerCase();
  if (k.includes("nmpz")) return "nmpz";
  if (k.includes("no move") || k.includes("no_move") || k.includes("nomove") || k.includes("no moving")) return "no_move";
  if (k.includes("moving")) return "moving";
  return v;
}

export function guessCountryKey(r: RoundRow): GroupKey | null {
  const guess = getGuessCountrySelf(r);
  const v = typeof guess === "string" ? guess.trim() : "";
  return v.length ? v : null;
}

function mateLabel(r: RoundRow): string {
  const n = getTeammateName(r);
  const v = typeof n === "string" ? n.trim() : "";
  return v.length ? v : "Mate";
}

function winnerLabelForCompare(
  r: RoundRow,
  a: number | undefined,
  b: number | undefined,
  prefer: "min" | "max"
): GroupKey | null {
  if (typeof a !== "number" || !Number.isFinite(a) || typeof b !== "number" || !Number.isFinite(b)) return null;
  if (a === b) return "Tie";
  const youWin = prefer === "min" ? a < b : a > b;
  return youWin ? "You" : mateLabel(r);
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
    guess_country: guessCountryKey,
    teammate_name: teammateNameKey,
    map_slug: mapSlugKeyAny,
    map_name: mapNameKeyAny,
    is_rated: isRatedKeyAny,
    mode_family: (r: any) => {
      const v = typeof (r as any)?.modeFamily === "string" ? String((r as any).modeFamily).trim().toLowerCase() : "";
      if (!v) return null;
      if (v === "duels") return "Duel";
      if (v === "teamduels") return "Team Duel";
      return v;
    },
    team_closer_winner: (r: any) => winnerLabelForCompare(r, getDistanceKm(r as any), getMateDistanceKm(r as any), "min"),
    team_higher_score_winner: (r: any) => winnerLabelForCompare(r, getSelfScore(r as any), getMateScore(r as any), "max"),
    team_fewer_throw_winner: (r: any) => {
      const a = getSelfScore(r as any);
      const b = getMateScore(r as any);
      if (typeof a !== "number" || typeof b !== "number") return null;
      const aThrow = a < 50;
      const bThrow = b < 50;
      if (aThrow === bThrow) return "Tie";
      return aThrow ? mateLabel(r as any) : "You";
    },
    team_more_5k_winner: (r: any) => {
      const a = getSelfScore(r as any);
      const b = getMateScore(r as any);
      if (typeof a !== "number" || typeof b !== "number") return null;
      const a5 = a >= 5000;
      const b5 = b >= 5000;
      if (a5 === b5) return "Tie";
      return a5 ? "You" : mateLabel(r as any);
    },
    round_number: (r: any) => (typeof r?.roundNumber === "number" ? `#${r.roundNumber}` : null)
  },
  game: {
    time_day: timeDayKeyAny,
    weekday: weekdayKeyAny,
    hour: hourKeyAny,
    game_id: (g: any) => (typeof g?.gameId === "string" && g.gameId.trim().length ? g.gameId : null),
    opponent_name: (g: any) => {
      const s = typeof g?.opponentName === "string" ? g.opponentName.trim() : "";
      return s ? s : null;
    },
    opponent_country: (g: any) => {
      const s = typeof g?.opponentCountry === "string" ? g.opponentCountry.trim() : "";
      return s ? s : null;
    },
    movement_type: movementTypeKeyAny,
    teammate_name: teammateKeyAny,
    map_slug: mapSlugKeyAny,
    map_name: mapNameKeyAny,
    is_rated: isRatedKeyAny,
    game_mode: gameModeKeyAny,
    mode_family: modeFamilyKeyAny,
    result: resultKeyAny,
    is_flawless_win: isFlawlessWinKeyAny,
    game_length: (g: any) => {
      const n = (g as any).roundsCount;
      if (typeof n !== "number" || !Number.isFinite(n)) return null;
      if (n < 2) return null;
      return String(Math.round(n));
    }
  },
  session: {
    time_day: (row: any) => {
      const ts = typeof row?.sessionStartTs === "number" ? row.sessionStartTs : typeof row?.ts === "number" ? row.ts : null;
      if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
      const d = new Date(ts);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    },
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
