// src/engine/measures.ts
import type { Grain } from "../config/semantic.types";
import type { RoundRow, GameFactRow } from "../db";
import { getSelfScore, getTrueCountry, getGuessCountrySelf, getDurationSeconds, getDistanceKm, pick } from "./fieldAccess";

export type MeasureFn = (rows: any[]) => number;

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
    const n = rows.length;
    if (!n) return 0;
    let k = 0;
    for (const g of rows) if (getGameSelfVictory(g) === true) k++;
    return k / n;
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
    for (const g of rows) if (getGameSelfVictory(g) === true) k++;
    return k;
  }
};

export const MEASURES_BY_GRAIN: Record<Grain, Record<string, MeasureFn>> = {
  round: ROUND_MEASURES_BY_FORMULA_ID as any,
  game: GAME_MEASURES_BY_FORMULA_ID as any,
  session: {}
};
