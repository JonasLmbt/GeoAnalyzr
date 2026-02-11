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

async function getRoundsRaw(): Promise<RoundRow[]> {
  if (roundsRawCache) return roundsRawCache;
  const rows = await db.rounds.toArray();
  const missingPlayedAt = rows.some((r) => typeof (r as any).playedAt !== "number");
  if (!missingPlayedAt) {
    roundsRawCache = rows;
    return rows;
  }

  const games = await db.games.toArray();
  const playedAtByGame = new Map<string, number>();
  for (const g of games) {
    if (typeof g.playedAt === "number") playedAtByGame.set(g.gameId, g.playedAt);
  }

  roundsRawCache = rows.map((r) => {
    if (typeof (r as any).playedAt === "number") return r;
    const gamePlayedAt = playedAtByGame.get(r.gameId);
    if (typeof gamePlayedAt !== "number") return r;
    return { ...(r as any), playedAt: gamePlayedAt } as RoundRow;
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
