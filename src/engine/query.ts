import { db, ModeFamily, RoundRow, GameRow } from "../db";

export type DateRangeFilter = { fromTs?: number; toTs?: number };

export type EngineFilters = {
  date?: DateRangeFilter;
  modeFamily?: "all" | ModeFamily;          // duels/teamduels/...
  movementType?: "all" | "moving" | "no_move" | "nmpz" | "unknown";
  country?: "all" | string;                 // trueCountry
  teammateId?: "all" | string;              // needs details join
};

export type QueryContext = {
  filters: EngineFilters;
};

function inRange(ts: number | undefined, r: DateRangeFilter | undefined): boolean {
  if (!r) return true;
  if (typeof ts !== "number") return false;
  if (typeof r.fromTs === "number" && ts < r.fromTs) return false;
  if (typeof r.toTs === "number" && ts > r.toTs) return false;
  return true;
}

function matchRoundFast(r: RoundRow, ctx: QueryContext): boolean {
  const f = ctx.filters;

  if (!inRange((r as any).playedAt, f.date)) return false;

  if (f.modeFamily && f.modeFamily !== "all") {
    if (r.modeFamily !== f.modeFamily) return false;
  }

  if (f.movementType && f.movementType !== "all") {
    if ((r as any).movementType !== f.movementType) return false;
  }

  if (f.country && f.country !== "all") {
    if ((r as any).trueCountry !== f.country) return false;
  }

  return true;
}

/**
 * Pull rounds matching filters. This is the "workhorse" for most charts.
 * If teammateId filter is set, we additionally join details by gameId.
 */
export async function getFilteredRounds(ctx: QueryContext): Promise<RoundRow[]> {
  const f = ctx.filters;

  // Fast-path: no teammate filter => filter purely from rounds.
  if (!f.teammateId || f.teammateId === "all") {
    const rows = await db.rounds.toArray();
    return rows.filter((r) => matchRoundFast(r, ctx));
  }

  // Teammate filter requires details join.
  const detailsByGameId = new Map<string, GameRow>();
  const detailsRows = await db.details.toArray();
  for (const d of detailsRows) detailsByGameId.set(d.gameId, d);

  const rounds = await db.rounds.toArray();
  return rounds.filter((r) => {
    if (!matchRoundFast(r, ctx)) return false;

    const d = detailsByGameId.get(r.gameId);
    if (!d) return false;

    const mateId = (d as any).player_mate_id;
    return mateId === f.teammateId;
  });
}

/**
 * Convenience: get games count quickly (often used in widgets).
 * Uses rounds filtered set so it respects teammate/country etc.
 */
export async function countDistinctGames(ctx: QueryContext): Promise<number> {
  const rounds = await getFilteredRounds(ctx);
  const s = new Set(rounds.map((r) => r.gameId));
  return s.size;
}
