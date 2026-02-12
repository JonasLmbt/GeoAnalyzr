// src/engine/queryEngine.ts
import { db } from "../db";
import type { RoundRow } from "../db";
import type { GlobalFiltersSpec } from "../config/dashboard.types";
import { applyFilters } from "./filters";
import { buildAppliedRoundFilters, normalizeGlobalFilterKey, type GlobalFilterState } from "./globalFilters";

export type GlobalFilters = {
  global?: {
    spec: GlobalFiltersSpec | undefined;
    state: GlobalFilterState;
  };
};

let roundsRawCache: RoundRow[] | null = null;
const roundsFilteredCache = new Map<string, RoundRow[]>();

export async function getGamePlayedAtBounds(): Promise<{ minTs: number | null; maxTs: number | null }> {
  const first = await db.games.orderBy("playedAt").first();
  const last = await db.games.orderBy("playedAt").last();
  const minTs = first && typeof first.playedAt === "number" ? first.playedAt : null;
  const maxTs = last && typeof last.playedAt === "number" ? last.playedAt : null;
  return { minTs, maxTs };
}

async function getRoundsRaw(): Promise<RoundRow[]> {
  if (roundsRawCache) return roundsRawCache;
  const [rows, games, details] = await Promise.all([db.rounds.toArray(), db.games.toArray(), db.details.toArray()]);

  const playedAtByGame = new Map<string, number>();
  for (const g of games) {
    if (typeof g.playedAt === "number") playedAtByGame.set(g.gameId, g.playedAt);
  }

  const mateNameByGame = new Map<string, string>();
  const victoryByGame = new Map<string, boolean>();
  for (const d of details) {
    const raw = (d as any).player_mate_name;
    const name = typeof raw === "string" ? raw.trim() : "";
    if (name) mateNameByGame.set((d as any).gameId, name);
    const v = (d as any).player_self_victory;
    if (typeof v === "boolean") victoryByGame.set((d as any).gameId, v);
  }

  roundsRawCache = rows.map((r) => {
    const out: any = { ...(r as any) };

    if (typeof out.playedAt !== "number") {
      const gamePlayedAt = playedAtByGame.get(out.gameId);
      if (typeof gamePlayedAt === "number") out.playedAt = gamePlayedAt;
    }

    if (typeof out.teammateName !== "string" || !out.teammateName.trim()) {
      const mate = mateNameByGame.get(out.gameId);
      if (mate) out.teammateName = mate;
    }

    // Convenience fields for drilldown rendering.
    const v = victoryByGame.get(out.gameId);
    if (typeof v === "boolean") out.result = v ? "Win" : "Loss";
    if (typeof out.damage !== "number") {
      const mf = String(out.modeFamily ?? "");
      if (mf === "duels") {
        const self = (out as any).player_self_score;
        const opp = (out as any).player_opponent_score;
        if (typeof self === "number" && typeof opp === "number") out.damage = self - opp;
      } else if (mf === "teamduels") {
        const s1 = (out as any).player_self_score;
        const s2 = (out as any).player_mate_score;
        const o1 = (out as any).player_opponent_score;
        const o2 = (out as any).player_opponent_mate_score;
        const own = [s1, s2].filter((x: any) => typeof x === "number") as number[];
        const opp = [o1, o2].filter((x: any) => typeof x === "number") as number[];
        if (own.length && opp.length) {
          const avg = (a: number[]) => a.reduce((p, c) => p + c, 0) / a.length;
          out.damage = avg(own) - avg(opp);
        }
      }
    }

    return out as RoundRow;
  });

  return roundsRawCache;
}

export async function getRounds(filters: GlobalFilters): Promise<RoundRow[]> {
  const rowsAll = await getRoundsRaw();
  const gf = filters?.global;
  const spec = gf?.spec;
  const state = gf?.state ?? {};

  const key = normalizeGlobalFilterKey(spec, state);
  const cached = roundsFilteredCache.get(key);
  if (cached) return cached;

  const applied = buildAppliedRoundFilters(spec, state);
  let rows = rowsAll;

  if (applied.date) {
    const fromTs = applied.date.fromTs ?? null;
    const toTs = applied.date.toTs ?? null;
    if (fromTs !== null) rows = rows.filter((r) => typeof (r as any).playedAt === "number" && (r as any).playedAt >= fromTs);
    if (toTs !== null) rows = rows.filter((r) => typeof (r as any).playedAt === "number" && (r as any).playedAt <= toTs);
  }

  rows = applyFilters(rows, applied.clauses);

  roundsFilteredCache.set(key, rows);
  return rows;
}
