// src/engine/measures.ts
import type { Grain } from "../config/semantic.types";
import type { RoundRow, GameFactRow } from "../db";
import { getSelfScore, getTrueCountry, getGuessCountrySelf, getDurationSeconds, getDistanceKm, pick } from "./fieldAccess";
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
  }
  ,
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
    for (const g of rows) {
      const v = getGameSelfEndRating(g);
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
  }
};

export const SESSION_MEASURES_BY_FORMULA_ID: Record<string, (rows: SessionRow[]) => number> = {
  count_sessions: (rows) => rows.length,
  mean_games_per_session: (rows) => {
    if (!rows.length) return 0;
    const sum = rows.reduce((a, r) => a + (typeof (r as any).gamesCount === "number" ? (r as any).gamesCount : 0), 0);
    return sum / rows.length;
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
};

export const MEASURES_BY_GRAIN: Record<Grain, Record<string, MeasureFn>> = {
  round: ROUND_MEASURES_BY_FORMULA_ID as any,
  game: GAME_MEASURES_BY_FORMULA_ID as any,
  session: SESSION_MEASURES_BY_FORMULA_ID as any
};
