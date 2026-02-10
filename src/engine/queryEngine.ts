// src/engine/queryEngine.ts
import { db } from "../db";
import type { RoundRow } from "../db";

export type GlobalFilters = {
  // Add later: dateRange, modeFamily, movementType, etc.
};

export async function getRounds(_filters: GlobalFilters): Promise<RoundRow[]> {
  const rows = await db.rounds.toArray();
  const missingPlayedAt = rows.some((r) => typeof (r as any).playedAt !== "number");
  if (!missingPlayedAt) return rows;

  const games = await db.games.toArray();
  const playedAtByGame = new Map<string, number>();
  for (const g of games) {
    if (typeof g.playedAt === "number") playedAtByGame.set(g.gameId, g.playedAt);
  }

  return rows.map((r) => {
    if (typeof (r as any).playedAt === "number") return r;
    const gamePlayedAt = playedAtByGame.get(r.gameId);
    if (typeof gamePlayedAt !== "number") return r;
    return { ...(r as any), playedAt: gamePlayedAt } as RoundRow;
  });
}
