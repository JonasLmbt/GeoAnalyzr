// src/engine/queryEngine.ts
import { db } from "../db";
import type { RoundRow, GameFactRow } from "../db";
import type { GlobalFiltersSpec } from "../config/dashboard.types";
import { applyFilters } from "./filters";
import { buildAppliedFilters, normalizeGlobalFilterKey, type GlobalFilterState } from "./globalFilters";

export type GlobalFilters = {
  global?: {
    spec: GlobalFiltersSpec | undefined;
    state: GlobalFilterState;
    controlIds?: string[];
  };
};

function normalizeMovementType(raw: unknown): "moving" | "no_move" | "nmpz" | "unknown" {
  if (typeof raw !== "string") return "unknown";
  const s = raw.trim().toLowerCase();
  if (!s) return "unknown";
  if (s.includes("nmpz")) return "nmpz";
  if (s.includes("no move") || s.includes("no_move") || s.includes("nomove") || s.includes("no moving")) return "no_move";
  if (s.includes("moving")) return "moving";
  return "unknown";
}

function asTrimmedString(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : undefined;
}

function pickFirst(obj: any, keys: string[]): any {
  for (const k of keys) {
    if (!obj) continue;
    const v = obj[k];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

let roundsRawCache: RoundRow[] | null = null;
const roundsFilteredCache = new Map<string, RoundRow[]>();
let gamesRawCache: GameFactRow[] | null = null;
const gamesFilteredCache = new Map<string, GameFactRow[]>();

export function invalidateRoundsCache(): void {
  roundsRawCache = null;
  roundsFilteredCache.clear();
  gamesRawCache = null;
  gamesFilteredCache.clear();
}

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
  const modeFamilyByGame = new Map<string, string>();
  const gameModeByGame = new Map<string, string>();
  for (const g of games) {
    if (typeof g.playedAt === "number") playedAtByGame.set(g.gameId, g.playedAt);
    if (typeof (g as any).modeFamily === "string" && (g as any).modeFamily) modeFamilyByGame.set(g.gameId, (g as any).modeFamily);
    const gm = asTrimmedString((g as any).gameMode ?? (g as any).mode);
    if (gm) gameModeByGame.set(g.gameId, gm);
  }

  const detailsByGame = new Map<string, any>();
  for (const d of details) {
    if (d && typeof (d as any).gameId === "string") detailsByGame.set((d as any).gameId, d as any);
  }

  roundsRawCache = rows.map((r) => {
    const out: any = { ...(r as any) };
    const gameId = String(out.gameId ?? "");
    const d = detailsByGame.get(gameId);

    // Prefer round start time where available (round-specific).
    const roundStart = typeof out.startTime === "number" && Number.isFinite(out.startTime) ? out.startTime : undefined;
    const roundEnd = typeof out.endTime === "number" && Number.isFinite(out.endTime) ? out.endTime : undefined;
    const gamePlayedAt = playedAtByGame.get(gameId);
    const bestTime = roundStart ?? roundEnd ?? (typeof out.playedAt === "number" ? out.playedAt : undefined) ?? gamePlayedAt;

    if (typeof bestTime === "number" && Number.isFinite(bestTime)) {
      // Use playedAt as the canonical time field for charts/filters.
      out.playedAt = bestTime;
      // Also expose a dedicated ts so drilldown/date columns don't have to guess.
      out.ts = bestTime;
    }

    // Fill mode fields if missing.
    if (typeof out.modeFamily !== "string" || !out.modeFamily) {
      const mf = asTrimmedString(out.modeFamily) ?? asTrimmedString(d?.modeFamily) ?? modeFamilyByGame.get(gameId);
      if (mf) out.modeFamily = mf;
    }
    if (typeof out.gameMode !== "string" || !out.gameMode) {
      const gm = asTrimmedString(out.gameMode) ?? asTrimmedString(d?.gameModeSimple) ?? asTrimmedString(d?.gameMode) ?? gameModeByGame.get(gameId);
      if (gm) out.gameMode = gm;
    }

    // Movement type can be derived from details.gameModeSimple or games.gameMode.
    if (typeof out.movementType !== "string" || !out.movementType) {
      const fromDetail = asTrimmedString(d?.gameModeSimple);
      const fromGame = gameModeByGame.get(gameId);
      out.movementType = normalizeMovementType(fromDetail ?? fromGame);
    }

    // Convenience fields for drilldown rendering (result + teammateName).
    if (d) {
      const v =
        typeof d.player_self_victory === "boolean"
          ? d.player_self_victory
          : typeof d.teamOneVictory === "boolean"
            ? d.teamOneVictory
            : typeof d.playerOneVictory === "boolean"
              ? d.playerOneVictory
              : undefined;
      if (typeof v === "boolean") out.result = v ? "Win" : "Loss";

      if (typeof out.teammateName !== "string" || !out.teammateName.trim()) {
        // Prefer resolving teammate name based on self playerId when possible.
        const selfId = asTrimmedString(out.player_self_playerId);
        const t1id = asTrimmedString(d.teamOnePlayerOneId);
        const t2id = asTrimmedString(d.teamOnePlayerTwoId);
        const t1name = asTrimmedString(d.teamOnePlayerOneName);
        const t2name = asTrimmedString(d.teamOnePlayerTwoName);
        let mateName: string | undefined;
        if (selfId && selfId === t1id) mateName = t2name;
        else if (selfId && selfId === t2id) mateName = t1name;
        else mateName = asTrimmedString(pickFirst(d, ["player_mate_name", "teamOnePlayerTwoName", "p2_name"]));
        if (mateName) out.teammateName = mateName;
      }
    }

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
        if (own.length && opp.length) out.damage = own.reduce((p, c) => p + c, 0) - opp.reduce((p, c) => p + c, 0);
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
  const controlIds = gf?.controlIds;

  const key = normalizeGlobalFilterKey(spec, state, "round", controlIds);
  const cached = roundsFilteredCache.get(key);
  if (cached) return cached;

  const applied = buildAppliedFilters(spec, state, "round", controlIds);
  let rows = rowsAll;

  if (applied.date) {
    const fromTs = applied.date.fromTs ?? null;
    const toTs = applied.date.toTs ?? null;
    if (fromTs !== null) rows = rows.filter((r) => typeof (r as any).playedAt === "number" && (r as any).playedAt >= fromTs);
    if (toTs !== null) rows = rows.filter((r) => typeof (r as any).playedAt === "number" && (r as any).playedAt <= toTs);
  }

  rows = applyFilters(rows, applied.clauses, "round");

  roundsFilteredCache.set(key, rows);
  return rows;
}

async function getGamesRaw(): Promise<GameFactRow[]> {
  if (gamesRawCache) return gamesRawCache;
  const [games, details] = await Promise.all([db.games.toArray(), db.details.toArray()]);

  const detailsByGame = new Map<string, any>();
  for (const d of details) {
    if (d && typeof (d as any).gameId === "string") detailsByGame.set((d as any).gameId, d as any);
  }

  gamesRawCache = games.map((g) => {
    const d = detailsByGame.get(g.gameId);
    const out: any = { ...(g as any), ...(d ? (d as any) : {}) };
    if (typeof g.playedAt === "number" && Number.isFinite(g.playedAt)) {
      out.playedAt = g.playedAt;
      out.ts = g.playedAt;
    }

    // Best-effort normalize a result string for the "result" dimension.
    const v =
      typeof out.player_self_victory === "boolean"
        ? out.player_self_victory
        : typeof out.teamOneVictory === "boolean"
          ? out.teamOneVictory
          : typeof out.playerOneVictory === "boolean"
            ? out.playerOneVictory
            : undefined;
    if (typeof v === "boolean") out.result = v ? "Win" : "Loss";

    return out as GameFactRow;
  });

  return gamesRawCache;
}

export async function getGames(filters: GlobalFilters): Promise<GameFactRow[]> {
  const rowsAll = await getGamesRaw();
  const gf = filters?.global;
  const spec = gf?.spec;
  const state = gf?.state ?? {};
  const controlIds = gf?.controlIds;

  const key = normalizeGlobalFilterKey(spec, state, "game", controlIds);
  const cached = gamesFilteredCache.get(key);
  if (cached) return cached;

  const applied = buildAppliedFilters(spec, state, "game", controlIds);
  let rows = rowsAll;

  if (applied.date) {
    const fromTs = applied.date.fromTs ?? null;
    const toTs = applied.date.toTs ?? null;
    if (fromTs !== null) rows = rows.filter((r) => typeof (r as any).playedAt === "number" && (r as any).playedAt >= fromTs);
    if (toTs !== null) rows = rows.filter((r) => typeof (r as any).playedAt === "number" && (r as any).playedAt <= toTs);
  }

  rows = applyFilters(rows, applied.clauses, "game");

  gamesFilteredCache.set(key, rows);
  return rows;
}
