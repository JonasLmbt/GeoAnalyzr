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
  for (const d of details) {
    const raw = (d as any).player_mate_name;
    const name = typeof raw === "string" ? raw.trim() : "";
    if (name) mateNameByGame.set((d as any).gameId, name);
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
