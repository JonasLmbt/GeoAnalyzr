// src/engine/measures.ts
import type { RoundRow } from "../db";
import { getSelfScore, getTrueCountry, getGuessCountrySelf } from "./fieldAccess";

export type MeasureFn = (rows: RoundRow[]) => number;

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

export const ROUND_MEASURES_BY_FORMULA_ID: Record<string, MeasureFn> = {
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
  }
};
