// src/engine/measures.ts
import type { Grain } from "../config/semantic.types";
import type { RoundRow, GameFactRow } from "../db";
import { getSelfScore, getTrueCountry, getGuessCountrySelf, getDurationSeconds, getDistanceKm, getPlayedAt, pick } from "./fieldAccess";
import type { SessionRow } from "./queryEngine";

export type MeasureFn = (rows: any[]) => number;

function medianOf(values: number[]): number {
  const finite = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (finite.length === 0) return 0;
  finite.sort((a, b) => a - b);
  const mid = Math.floor(finite.length / 2);
  return finite.length % 2 ? finite[mid] : (finite[mid - 1] + finite[mid]) / 2;
}

function stddevOf(values: number[]): number {
  const finite = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  const n = finite.length;
  if (n <= 1) return 0;
  const mean = finite.reduce((a, b) => a + b, 0) / n;
  let sumSq = 0;
  for (const v of finite) sumSq += (v - mean) * (v - mean);
  return Math.sqrt(sumSq / n);
}

function is5k(r: RoundRow): boolean {
  const s = getSelfScore(r);
  return typeof s === "number" && s >= 5000;
}

function isHit(r: RoundRow): boolean {
  const truth = getTrueCountry(r);
  if (!truth) return false;
  const guess = getGuessCountrySelf(r);
  return typeof guess === "string" && guess === truth;
}

function isThrowLt50(r: RoundRow): boolean {
  const s = getSelfScore(r);
  return typeof s === "number" && s < 50;
}

function isNearPerfect(r: RoundRow): boolean {
  const s = getSelfScore(r);
  return typeof s === "number" && s >= 4500;
}

function isLowScoreLt500(r: RoundRow): boolean {
  const s = getSelfScore(r);
  return typeof s === "number" && s < 500;
}

function getGameSelfVictory(g: GameFactRow): boolean | undefined {
  const v =
    pick(g as any, "player_self_victory") ??
    pick(g as any, "playerOneVictory") ??
    pick(g as any, "teamOneVictory");
  return typeof v === "boolean" ? v : undefined;
}

function getGameSelfStartRating(g: GameFactRow): number | undefined {
  const v = pick(g as any, "player_self_startRating") ?? pick(g as any, "playerOneStartRating") ?? pick(g as any, "teamOneStartRating");
  return typeof v === "number" ? v : undefined;
}

function getGameSelfEndRating(g: GameFactRow): number | undefined {
  const v = pick(g as any, "player_self_endRating") ?? pick(g as any, "playerOneEndRating") ?? pick(g as any, "teamOneEndRating");
  return typeof v === "number" ? v : undefined;
}

function getGameModeFamily(g: GameFactRow): string {
  const v = pick(g as any, "modeFamily") ?? pick(g as any, "mode_family");
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

function getGameDuelStartRating(g: GameFactRow): number | undefined {
  const v = pick(g as any, "player_self_startRating") ?? pick(g as any, "playerOneStartRating");
  return typeof v === "number" ? v : undefined;
}

function getGameDuelEndRating(g: GameFactRow): number | undefined {
  const v = pick(g as any, "player_self_endRating") ?? pick(g as any, "playerOneEndRating");
  return typeof v === "number" ? v : undefined;
}

function getGameTeamStartRating(g: GameFactRow): number | undefined {
  const v = pick(g as any, "teamOneStartRating") ?? pick(g as any, "player_self_startRating");
  return typeof v === "number" ? v : undefined;
}

function getGameTeamEndRating(g: GameFactRow): number | undefined {
  const v = pick(g as any, "teamOneEndRating") ?? pick(g as any, "player_self_endRating");
  return typeof v === "number" ? v : undefined;
}

function getGameEffectiveStartRating(g: GameFactRow): number | undefined {
  return getGameModeFamily(g) === "teamduels" ? getGameTeamStartRating(g) : getGameDuelStartRating(g);
}

function getGameEffectiveEndRating(g: GameFactRow): number | undefined {
  return getGameModeFamily(g) === "teamduels" ? getGameTeamEndRating(g) : getGameDuelEndRating(g);
}

function ratingModeForRows(rows: any[]): "duel" | "team" {
  // Default to duel rating when the dataset mixes modes.
  for (const g of rows as any[]) {
    if (getGameModeFamily(g as any) === "duels") return "duel";
  }
  return "team";
}

function getGameOutcome(g: GameFactRow): "win" | "loss" | "tie" | null {
  const v = getGameSelfVictory(g);
  if (typeof v === "boolean") return v ? "win" : "loss";
  const r = pick(g as any, "result");
  const s = typeof r === "string" ? r.trim().toLowerCase() : "";
  if (!s) return null;
  if (s === "win" || s === "w" || s === "true") return "win";
  if (s === "loss" || s === "l" || s === "false") return "loss";
  if (s === "tie" || s === "t" || s === "draw") return "tie";
  return null;
}

export const ROUND_MEASURES_BY_FORMULA_ID: Record<string, (rows: RoundRow[]) => number> = {
  count_rounds: (rows) => rows.length,

  count_distinct_game_id: (rows) => {
    const seen = new Set<string>();
    for (const r of rows as any[]) {
      const gid = typeof (r as any)?.gameId === "string" ? (r as any).gameId : "";
      if (gid) seen.add(gid);
    }
    return seen.size;
  },

  min_played_at_ts: (rows) => {
    let min = Infinity;
    for (const r of rows) {
      const ts = getPlayedAt(r) ?? (r as any)?.ts;
      if (typeof ts === "number" && Number.isFinite(ts)) min = Math.min(min, ts);
    }
    return Number.isFinite(min) ? min : 0;
  },

  max_played_at_ts: (rows) => {
    let max = -Infinity;
    for (const r of rows) {
      const ts = getPlayedAt(r) ?? (r as any)?.ts;
      if (typeof ts === "number" && Number.isFinite(ts)) max = Math.max(max, ts);
    }
    return Number.isFinite(max) ? max : 0;
  },

  spread_player_self_score: (rows) => {
    let min = Infinity;
    let max = -Infinity;
    for (const r of rows) {
      const s = getSelfScore(r);
      if (typeof s !== "number" || !Number.isFinite(s)) continue;
      if (s < min) min = s;
      if (s > max) max = s;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return 0;
    return Math.max(0, max - min);
  },

  // Share-of-total measures are normalized in chart/breakdown widgets (they need access to total rows).
  // In non-grouped contexts (e.g. stat row over all rows), returning 1.0 is a sensible default (100% of itself).
  share_damage_dealt: (_rows) => 1,
  share_damage_taken: (_rows) => 1,

  mean_player_self_score: (rows) => {
    let sum = 0;
    let n = 0;
    for (const r of rows) {
      const s = getSelfScore(r);
      if (typeof s === "number") {
        sum += s;
        n++;
      }
    }
    return n ? sum / n : 0;
  },

  median_player_self_score: (rows) => medianOf(rows.map((r) => getSelfScore(r) as any).filter((v) => typeof v === "number")),
  stddev_player_self_score: (rows) => stddevOf(rows.map((r) => getSelfScore(r) as any).filter((v) => typeof v === "number")),

  rate_player_self_score_eq_5000: (rows) => {
    const n = rows.length;
    if (!n) return 0;
    let k = 0;
    for (const r of rows) if (is5k(r)) k++;
    return k / n;
  },

  rate_true_country_hit: (rows) => {
    const n = rows.length;
    if (!n) return 0;
    let k = 0;
    for (const r of rows) if (isHit(r)) k++;
    return k / n;
  },

  rate_throw_round: (rows) => {
    const n = rows.length;
    if (!n) return 0;
    let k = 0;
    for (const r of rows) if (isThrowLt50(r)) k++;
    return k / n;
  },

  count_5k_round: (rows) => {
    let k = 0;
    for (const r of rows) if (is5k(r)) k++;
    return k;
  },

  rate_near_perfect_round: (rows) => {
    const n = rows.length;
    if (!n) return 0;
    let k = 0;
    for (const r of rows) if (isNearPerfect(r)) k++;
    return k / n;
  },

  count_near_perfect_round: (rows) => {
    let k = 0;
    for (const r of rows) if (isNearPerfect(r)) k++;
    return k;
  },

  count_hit_round: (rows) => {
    let k = 0;
    for (const r of rows) if (isHit(r)) k++;
    return k;
  },

  count_throw_round: (rows) => {
    let k = 0;
    for (const r of rows) if (isThrowLt50(r)) k++;
    return k;
  },

  rate_low_score_round: (rows) => {
    const n = rows.length;
    if (!n) return 0;
    let k = 0;
    for (const r of rows) if (isLowScoreLt500(r)) k++;
    return k / n;
  },

  count_low_score_round: (rows) => {
    let k = 0;
    for (const r of rows) if (isLowScoreLt500(r)) k++;
    return k;
  },

  mean_player_self_score_hit_only: (rows) => {
    let sum = 0;
    let n = 0;
    for (const r of rows) {
      if (!isHit(r)) continue;
      const s = getSelfScore(r);
      if (typeof s === "number") {
        sum += s;
        n++;
      }
    }
    return n ? sum / n : 0;
  },

  mean_duration_seconds: (rows) => {
    let sum = 0;
    let n = 0;
    for (const r of rows) {
      const v = getDurationSeconds(r);
      if (typeof v === "number" && Number.isFinite(v)) {
        sum += v;
        n++;
      }
    }
    return n ? sum / n : 0;
  },

  median_duration_seconds: (rows) => medianOf(rows.map((r) => getDurationSeconds(r) as any).filter((v) => typeof v === "number")),
  sum_duration_seconds: (rows) => {
    let sum = 0;
    for (const r of rows) {
      const v = getDurationSeconds(r);
      if (typeof v === "number" && Number.isFinite(v)) sum += v;
    }
    return sum;
  },
  count_rounds_with_duration: (rows) => {
    let k = 0;
    for (const r of rows) {
      const v = getDurationSeconds(r);
      if (typeof v === "number" && Number.isFinite(v)) k++;
    }
    return k;
  },

  mean_player_self_distance_km: (rows) => {
    let sum = 0;
    let n = 0;
    for (const r of rows) {
      const v = getDistanceKm(r);
      if (typeof v === "number" && Number.isFinite(v)) {
        sum += v;
        n++;
      }
    }
    return n ? sum / n : 0;
  },

  median_player_self_distance_km: (rows) => medianOf(rows.map((r) => getDistanceKm(r) as any).filter((v) => typeof v === "number")),

  mean_damage_dealt: (rows) => {
    let sum = 0;
    let n = 0;
    for (const r of rows as any[]) {
      const dmg = (r as any).damage;
      if (typeof dmg === "number" && Number.isFinite(dmg)) {
        sum += Math.max(0, dmg);
        n++;
      }
    }
    return n ? sum / n : 0;
  },

  mean_damage_taken: (rows) => {
    let sum = 0;
    let n = 0;
    for (const r of rows as any[]) {
      const dmg = (r as any).damage;
      if (typeof dmg === "number" && Number.isFinite(dmg)) {
        sum += Math.max(0, -dmg);
        n++;
      }
    }
    return n ? sum / n : 0;
  }
};

export const GAME_MEASURES_BY_FORMULA_ID: Record<string, (rows: GameFactRow[]) => number> = {
  count_games: (rows) => rows.length,

  count_distinct_opponent_name: (rows) => {
    const set = new Set<string>();
    for (const g of rows as any[]) {
      const s = typeof g?.opponentName === "string" ? g.opponentName.trim() : "";
      if (s) set.add(s);
    }
    return set.size;
  },

  count_distinct_opponent_country: (rows) => {
    const set = new Set<string>();
    for (const g of rows as any[]) {
      const s = typeof g?.opponentCountry === "string" ? g.opponentCountry.trim() : "";
      if (s) set.add(s);
    }
    return set.size;
  },

  mean_game_length_rounds: (rows) => {
    let sum = 0;
    let n = 0;
    for (const g of rows as any[]) {
      const v = g?.roundsCount;
      if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        sum += v;
        n++;
      }
    }
    return n ? sum / n : 0;
  },

  rate_player_self_win: (rows) => {
    let n = 0;
    let k = 0;
    for (const g of rows) {
      const o = getGameOutcome(g);
      if (!o) continue;
      n++;
      if (o === "win") k++;
    }
    return n ? k / n : 0;
  },

  mean_player_self_end_rating: (rows) => {
    let sum = 0;
    let n = 0;
    for (const g of rows) {
      const v = getGameSelfEndRating(g);
      if (typeof v === "number") {
        sum += v;
        n++;
      }
    }
    return n ? sum / n : 0;
  },

  last_player_self_end_rating: (rows) => {
    const sorted = [...rows].sort((a: any, b: any) => (Number(a?.ts) || Number(a?.playedAt) || 0) - (Number(b?.ts) || Number(b?.playedAt) || 0));
    const mode = ratingModeForRows(sorted as any[]);
    for (let i = sorted.length - 1; i >= 0; i--) {
      const v =
        mode === "duel"
          ? getGameDuelEndRating(sorted[i] as any)
          : getGameTeamEndRating(sorted[i] as any);
      if (typeof v === "number" && Number.isFinite(v)) return v;
    }
    return 0;
  },

  trend_player_self_rating: (rows) => {
    const sorted = [...rows].sort((a: any, b: any) => (Number(a?.ts) || Number(a?.playedAt) || 0) - (Number(b?.ts) || Number(b?.playedAt) || 0));
    if (sorted.length === 0) return 0;

    const pickFiniteNonZero = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v !== 0 ? v : null);

    let firstRating: number | null = null;
    for (const g of sorted as any[]) {
      const start = pickFiniteNonZero(getGameEffectiveStartRating(g) ?? getGameEffectiveEndRating(g));
      const end = pickFiniteNonZero(getGameEffectiveEndRating(g) ?? getGameEffectiveStartRating(g));
      const r = start ?? end;
      if (r !== null) {
        firstRating = r;
        break;
      }
    }

    let lastRating: number | null = null;
    for (let i = sorted.length - 1; i >= 0; i--) {
      const g = sorted[i] as any;
      const end = pickFiniteNonZero(getGameEffectiveEndRating(g) ?? getGameEffectiveStartRating(g));
      const start = pickFiniteNonZero(getGameEffectiveStartRating(g) ?? getGameEffectiveEndRating(g));
      const r = end ?? start;
      if (r !== null) {
        lastRating = r;
        break;
      }
    }

    if (firstRating !== null && lastRating !== null) return lastRating - firstRating;
    return 0;
  },

  mean_player_self_rating_delta: (rows) => {
    let sum = 0;
    let n = 0;
    for (const g of rows) {
      const start = getGameSelfStartRating(g);
      const end = getGameSelfEndRating(g);
      if (typeof start === "number" && typeof end === "number") {
        sum += end - start;
        n++;
      }
    }
    return n ? sum / n : 0;
  },

  max_player_self_rating_delta: (rows) => {
    let best = -Infinity;
    for (const g of rows as any[]) {
      const start = getGameEffectiveStartRating(g) ?? getGameEffectiveEndRating(g);
      const end = getGameEffectiveEndRating(g);
      if (typeof start !== "number" || typeof end !== "number") continue;
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      if (start === 0 || end === 0) continue;
      best = Math.max(best, end - start);
    }
    return Number.isFinite(best) ? best : 0;
  },

  min_player_self_rating_delta: (rows) => {
    let best = Infinity;
    for (const g of rows as any[]) {
      const start = getGameEffectiveStartRating(g) ?? getGameEffectiveEndRating(g);
      const end = getGameEffectiveEndRating(g);
      if (typeof start !== "number" || typeof end !== "number") continue;
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      if (start === 0 || end === 0) continue;
      best = Math.min(best, end - start);
    }
    return Number.isFinite(best) ? best : 0;
  },

  count_win_game: (rows) => {
    let k = 0;
    for (const g of rows) if (getGameOutcome(g) === "win") k++;
    return k;
  },
  count_loss_game: (rows) => {
    let k = 0;
    for (const g of rows) if (getGameOutcome(g) === "loss") k++;
    return k;
  },
  count_tie_game: (rows) => {
    let k = 0;
    for (const g of rows) if (getGameOutcome(g) === "tie") k++;
    return k;
  },
  count_games_with_result: (rows) => {
    let k = 0;
    for (const g of rows) if (getGameOutcome(g)) k++;
    return k;
  },
  max_player_self_end_rating: (rows) => {
    let best = -Infinity;
    const mode = ratingModeForRows(rows as any[]);
    for (const g of rows) {
      const v =
        mode === "duel"
          ? getGameDuelEndRating(g as any)
          : getGameTeamEndRating(g as any);
      if (typeof v === "number" && Number.isFinite(v)) best = Math.max(best, v);
    }
    return Number.isFinite(best) ? best : 0;
  },
  max_win_streak: (rows) => {
    const sorted = [...rows].sort((a: any, b: any) => (Number(a?.ts) || 0) - (Number(b?.ts) || 0));
    let best = 0;
    let cur = 0;
    for (const g of sorted) {
      const o = getGameOutcome(g);
      if (!o) continue;
      if (o === "win") {
        cur++;
        best = Math.max(best, cur);
      } else {
        cur = 0;
      }
    }
    return best;
  },
  max_loss_streak: (rows) => {
    const sorted = [...rows].sort((a: any, b: any) => (Number(a?.ts) || 0) - (Number(b?.ts) || 0));
    let best = 0;
    let cur = 0;
    for (const g of sorted) {
      const o = getGameOutcome(g);
      if (!o) continue;
      if (o === "loss") {
        cur++;
        best = Math.max(best, cur);
      } else {
        cur = 0;
      }
    }
    return best;
  },

  max_opponent_start_rating: (rows) => {
    let best = -Infinity;
    for (const g of rows as any[]) {
      const mode = String((g as any)?.modeFamily ?? "").trim().toLowerCase();
      const vals: unknown[] =
        mode === "teamduels"
          ? [(g as any).player_opponent_startRating, (g as any).player_opponent_mate_startRating]
          : [(g as any).player_opponent_startRating, (g as any).playerTwoStartRating];
      for (const v of vals) {
        if (typeof v === "number" && Number.isFinite(v)) best = Math.max(best, v);
      }
    }
    return Number.isFinite(best) ? best : 0;
  },

  max_defeated_opponent_start_rating: (rows) => {
    let best = -Infinity;
    for (const g of rows as any[]) {
      if (getGameOutcome(g as any) !== "win") continue;
      const mode = String((g as any)?.modeFamily ?? "").trim().toLowerCase();
      const vals: unknown[] =
        mode === "teamduels"
          ? [(g as any).player_opponent_startRating, (g as any).player_opponent_mate_startRating]
          : [(g as any).player_opponent_startRating, (g as any).playerTwoStartRating];
      for (const v of vals) {
        if (typeof v === "number" && Number.isFinite(v)) best = Math.max(best, v);
      }
    }
    return Number.isFinite(best) ? best : 0;
  }
};

export const SESSION_MEASURES_BY_FORMULA_ID: Record<string, (rows: SessionRow[]) => number> = {
  count_sessions: (rows) => rows.length,
  mean_games_per_session: (rows) => {
    if (!rows.length) return 0;
    const sum = rows.reduce((a, r) => a + (typeof (r as any).gamesCount === "number" ? (r as any).gamesCount : 0), 0);
    return sum / rows.length;
  },
  session_avg_score_hit: (rows) => {
    let sum = 0;
    let n = 0;
    for (const r of rows as any[]) {
      const ss = r.hitScoreSum;
      const sc = r.hitScoreCount;
      if (typeof ss === "number" && typeof sc === "number" && sc > 0) {
        sum += ss;
        n += sc;
      }
    }
    return n ? sum / n : 0;
  },
  session_5k_count: (rows) => rows.reduce((a, r: any) => a + (typeof r.fivekCount === "number" ? r.fivekCount : 0), 0),
  session_hit_count: (rows) => rows.reduce((a, r: any) => a + (typeof r.hitCount === "number" ? r.hitCount : 0), 0),
  session_throw_count: (rows) => rows.reduce((a, r: any) => a + (typeof r.throwCount === "number" ? r.throwCount : 0), 0),
  session_win_count: (rows) => rows.reduce((a, r: any) => a + (typeof r.winCount === "number" ? r.winCount : 0), 0),
  session_win_rate: (rows) => {
    let wins = 0;
    let n = 0;
    for (const r of rows as any[]) {
      const w = r.winCount;
      const g = r.gamesWithOutcome;
      if (typeof w === "number" && Number.isFinite(w) && typeof g === "number" && Number.isFinite(g) && g > 0) {
        wins += w;
        n += g;
      }
    }
    return n ? wins / n : 0;
  },
  session_start_rating: (rows) => {
    const sorted = [...rows].sort((a: any, b: any) => Number(a?.sessionStartTs ?? 0) - Number(b?.sessionStartTs ?? 0));
    for (const r of sorted as any[]) {
      const start = (r as any)?.ratingStart;
      if (typeof start === "number" && Number.isFinite(start)) return start;
      const end = (r as any)?.ratingEnd;
      if (typeof end === "number" && Number.isFinite(end)) return end;
    }
    return 0;
  },
  session_end_rating: (rows) => {
    const sorted = [...rows].sort((a: any, b: any) => Number(a?.sessionEndTs ?? 0) - Number(b?.sessionEndTs ?? 0));
    for (let i = sorted.length - 1; i >= 0; i--) {
      const r: any = sorted[i];
      const end = r?.ratingEnd;
      if (typeof end === "number" && Number.isFinite(end)) return end;
      const start = r?.ratingStart;
      if (typeof start === "number" && Number.isFinite(start)) return start;
    }
    return 0;
  },
  session_duration_seconds: (rows) => {
    let sum = 0;
    for (const r of rows as any[]) {
      const start = (r as any)?.sessionStartTs;
      const end = (r as any)?.sessionEndTs;
      if (typeof start !== "number" || typeof end !== "number") continue;
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      const delta = end - start;
      if (Number.isFinite(delta) && delta > 0) sum += delta / 1000;
    }
    return sum;
  },
  session_duration_minutes: (rows) => {
    let sum = 0;
    for (const r of rows as any[]) {
      const start = (r as any)?.sessionStartTs;
      const end = (r as any)?.sessionEndTs;
      if (typeof start !== "number" || typeof end !== "number") continue;
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      const delta = end - start;
      if (Number.isFinite(delta) && delta > 0) sum += delta / 60000;
    }
    return sum;
  },
  max_break_between_sessions_seconds: (rows) => {
    const sorted = [...rows].sort((a: any, b: any) => Number(a?.sessionStartTs ?? 0) - Number(b?.sessionStartTs ?? 0));
    let best = 0;
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1] as any;
      const cur = sorted[i] as any;
      const gapMs = Number(cur.sessionStartTs ?? 0) - Number(prev.sessionEndTs ?? 0);
      if (Number.isFinite(gapMs) && gapMs > best) best = gapMs;
    }
    return best / 1000;
  },
  session_games_count: (rows) => rows.reduce((a, r: any) => a + (typeof r.gamesCount === "number" ? r.gamesCount : 0), 0),
  session_rounds_count: (rows) => rows.reduce((a, r: any) => a + (typeof r.roundsCount === "number" ? r.roundsCount : 0), 0),
  session_avg_score: (rows) => {
    let sum = 0;
    let n = 0;
    for (const r of rows as any[]) {
      const ss = r.scoreSum;
      const sc = r.scoreCount;
      if (typeof ss === "number" && typeof sc === "number" && sc > 0) {
        sum += ss;
        n += sc;
      }
    }
    return n ? sum / n : 0;
  },
  session_avg_guess_duration: (rows) => {
    let sum = 0;
    let n = 0;
    for (const r of rows as any[]) {
      const ss = r.durationSum;
      const sc = r.durationCount;
      if (typeof ss === "number" && typeof sc === "number" && sc > 0) {
        sum += ss;
        n += sc;
      }
    }
    return n ? sum / n : 0;
  },
  session_avg_distance_km: (rows) => {
    let sum = 0;
    let n = 0;
    for (const r of rows as any[]) {
      const ss = r.distanceSum;
      const sc = r.distanceCount;
      if (typeof ss === "number" && typeof sc === "number" && sc > 0) {
        sum += ss;
        n += sc;
      }
    }
    return n ? sum / n : 0;
  },
  session_fivek_rate: (rows) => {
    let fivek = 0;
    let n = 0;
    for (const r of rows as any[]) {
      const fk = r.fivekCount;
      const rc = r.roundsCount;
      if (typeof fk === "number" && typeof rc === "number" && rc > 0) {
        fivek += fk;
        n += rc;
      }
    }
    return n ? fivek / n : 0;
  },
  session_hit_rate: (rows) => {
    let k = 0;
    let n = 0;
    for (const r of rows as any[]) {
      const hk = r.hitCount;
      const rc = r.roundsCount;
      if (typeof hk === "number" && typeof rc === "number" && rc > 0) {
        k += hk;
        n += rc;
      }
    }
    return n ? k / n : 0;
  },
  session_throw_rate: (rows) => {
    let k = 0;
    let n = 0;
    for (const r of rows as any[]) {
      const tk = r.throwCount;
      const rc = r.roundsCount;
      if (typeof tk === "number" && typeof rc === "number" && rc > 0) {
        k += tk;
        n += rc;
      }
    }
    return n ? k / n : 0;
  }
  ,
  session_delta_rating: (rows) => {
    let sum = 0;
    for (const r of rows as any[]) {
      const d = (r as any)?.ratingDelta;
      if (typeof d === "number" && Number.isFinite(d)) sum += d;
    }
    return sum;
  }
};

export const MEASURES_BY_GRAIN: Record<Grain, Record<string, MeasureFn>> = {
  round: ROUND_MEASURES_BY_FORMULA_ID as any,
  game: GAME_MEASURES_BY_FORMULA_ID as any,
  session: SESSION_MEASURES_BY_FORMULA_ID as any
};
