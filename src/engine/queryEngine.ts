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
    sessionGapMinutes?: number;
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
let sessionsRawCache: any[] | null = null;
const sessionsFilteredCache = new Map<string, any[]>();

export function invalidateRoundsCache(): void {
  roundsRawCache = null;
  roundsFilteredCache.clear();
  gamesRawCache = null;
  gamesFilteredCache.clear();
  sessionsRawCache = null;
  sessionsFilteredCache.clear();
}

export async function hasAnyTeamDuels(): Promise<boolean> {
  const byFamily = await db.games.where("modeFamily").equals("teamduels").count();
  if (byFamily > 0) return true;
  const byFlag = await db.games.where("isTeamDuels").equals(true as any).count();
  return byFlag > 0;
}

export type SessionRow = {
  sessionId: string;
  sessionIndex: number;
  sessionStartTs: number;
  sessionEndTs: number;
  ts: number;

  gamesCount: number;
  roundsCount: number;

  scoreSum: number;
  scoreCount: number;
  durationSum: number;
  durationCount: number;
  distanceSum: number;
  distanceCount: number;

  fivekCount: number;
  hitCount: number;
  throwCount: number;

  // For drilldowns.
  gameIds: string[];
  rounds: RoundRow[];

  // Rating context for the session (computed from the first/last game in this session).
  ratingStart?: number;
  ratingEnd?: number;
  ratingDelta?: number;
};

function buildSessionsFromRounds(rounds: RoundRow[], gapMinutes: number): SessionRow[] {
  const byGame = new Map<string, RoundRow[]>();
  for (const r of rounds) {
    const gid = typeof (r as any).gameId === "string" ? (r as any).gameId : "";
    if (!gid) continue;
    const arr = byGame.get(gid) ?? [];
    arr.push(r);
    byGame.set(gid, arr);
  }

  const games = Array.from(byGame.entries())
    .map(([gameId, rows]) => {
      const times = rows
        .map((x) => (typeof (x as any).playedAt === "number" ? (x as any).playedAt : typeof (x as any).ts === "number" ? (x as any).ts : null))
        .filter((t): t is number => typeof t === "number" && Number.isFinite(t));
      const ts = times.length ? Math.min(...times) : null;
      const endTs = times.length ? Math.max(...times) : null;
      return ts === null || endTs === null ? null : { gameId, ts, endTs, rows };
    })
    .filter((x): x is { gameId: string; ts: number; endTs: number; rows: RoundRow[] } => !!x)
    .sort((a, b) => a.ts - b.ts);

  if (games.length === 0) return [];

  const gapMs = Math.max(1, Math.floor(gapMinutes * 60 * 1000));
  const sessions: SessionRow[] = [];

  let curGames: typeof games = [];
  const flush = () => {
    if (curGames.length === 0) return;
    const start = curGames[0].ts;
    const end = Math.max(...curGames.map((g) => g.endTs));
    const sessionId = `s${sessions.length + 1}`;
    const sessionIndex = sessions.length + 1;

    const allRounds = curGames.flatMap((g) => g.rows);
    const gameIdSet = new Set(curGames.map((g) => g.gameId));
    const gameIds = Array.from(gameIdSet.values());

    let scoreSum = 0, scoreCount = 0;
    let durationSum = 0, durationCount = 0;
    let distanceSum = 0, distanceCount = 0;
    let fivekCount = 0, hitCount = 0, throwCount = 0;

    for (const r of allRounds as any[]) {
      const s = (r as any).player_self_score;
      if (typeof s === "number" && Number.isFinite(s)) {
        scoreSum += s;
        scoreCount++;
        if (s >= 5000) fivekCount++;
        if (s < 50) throwCount++;
      }
      const truth = (r as any).trueCountry ?? (r as any).true_country;
      const guess = (r as any).player_self_guessCountry ?? (r as any).p1_guessCountry ?? (r as any).guessCountry;
      if (typeof truth === "string" && truth && typeof guess === "string" && guess === truth) hitCount++;

      const dur = (r as any).durationSeconds;
      if (typeof dur === "number" && Number.isFinite(dur) && dur >= 0) {
        durationSum += dur;
        durationCount++;
      }
      const dist = (r as any).distanceKm;
      if (typeof dist === "number" && Number.isFinite(dist) && dist >= 0) {
        distanceSum += dist;
        distanceCount++;
      }
    }

    sessions.push({
      sessionId,
      sessionIndex,
      sessionStartTs: start,
      sessionEndTs: end,
      ts: start,
      gamesCount: gameIdSet.size,
      roundsCount: allRounds.length,
      scoreSum,
      scoreCount,
      durationSum,
      durationCount,
      distanceSum,
      distanceCount,
      fivekCount,
      hitCount,
      throwCount,
      gameIds,
      rounds: allRounds
    });
    curGames = [];
  };

  for (const g of games) {
    if (curGames.length === 0) {
      curGames.push(g);
      continue;
    }
    const prevEnd = Math.max(...curGames.map((x) => x.endTs));
    if (g.ts - prevEnd > gapMs) {
      flush();
      curGames.push(g);
    } else {
      curGames.push(g);
    }
  }
  flush();
  return sessions;
}

function pickGameTs(g: any): number | null {
  const ts = typeof g?.ts === "number" ? g.ts : typeof g?.playedAt === "number" ? g.playedAt : null;
  return typeof ts === "number" && Number.isFinite(ts) ? ts : null;
}

function extractGameRatings(g: any): { start?: number; end?: number } {
  const mf = typeof g?.modeFamily === "string" ? g.modeFamily.trim().toLowerCase() : "";
  if (mf === "teamduels") {
    const start = typeof g?.teamOneStartRating === "number" ? g.teamOneStartRating : typeof g?.player_self_startRating === "number" ? g.player_self_startRating : undefined;
    const end = typeof g?.teamOneEndRating === "number" ? g.teamOneEndRating : typeof g?.player_self_endRating === "number" ? g.player_self_endRating : undefined;
    return { start, end };
  }
  const start =
    typeof g?.player_self_startRating === "number" ? g.player_self_startRating : typeof g?.playerOneStartRating === "number" ? g.playerOneStartRating : undefined;
  const end =
    typeof g?.player_self_endRating === "number" ? g.player_self_endRating : typeof g?.playerOneEndRating === "number" ? g.playerOneEndRating : undefined;
  return { start, end };
}

async function attachRatingsToSessions(sessions: SessionRow[]): Promise<SessionRow[]> {
  if (!sessions.length) return sessions;
  const games = await getGamesRaw();
  const byId = new Map<string, any>();
  for (const g of games as any[]) {
    const id = typeof (g as any)?.gameId === "string" ? (g as any).gameId : "";
    if (id) byId.set(id, g);
  }

  for (const s of sessions as any[]) {
    const ids = Array.isArray(s.gameIds) ? (s.gameIds as string[]) : [];
    const gs = ids.map((id) => byId.get(id)).filter(Boolean);
    if (!gs.length) continue;
    const sorted = [...gs].sort((a, b) => (pickGameTs(a) ?? 0) - (pickGameTs(b) ?? 0));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const firstRat = extractGameRatings(first);
    const lastRat = extractGameRatings(last);
    const start = typeof firstRat.start === "number" ? firstRat.start : typeof firstRat.end === "number" ? firstRat.end : undefined;
    const end = typeof lastRat.end === "number" ? lastRat.end : undefined;
    if (typeof start === "number" && typeof end === "number" && Number.isFinite(start) && Number.isFinite(end)) {
      s.ratingStart = start;
      s.ratingEnd = end;
      s.ratingDelta = end - start;
    }
  }

  return sessions;
}

// UI helper: allow building sessions from an already-filtered round list (e.g. section-local filters).
export function buildSessionsFromRoundsForUi(rounds: RoundRow[], gapMinutes: number): SessionRow[] {
  const mins = typeof gapMinutes === "number" && Number.isFinite(gapMinutes) ? Math.max(1, Math.min(360, Math.round(gapMinutes))) : 45;
  return buildSessionsFromRounds(rounds, mins);
}

async function getSessionsRaw(gapMinutes: number): Promise<SessionRow[]> {
  if (sessionsRawCache) return sessionsRawCache as SessionRow[];
  const rounds = await getRoundsRaw();
  const sessions = buildSessionsFromRounds(rounds, gapMinutes);
  sessionsRawCache = await attachRatingsToSessions(sessions);
  return sessionsRawCache as SessionRow[];
}

export async function getSessions(filters: GlobalFilters, opts?: { rounds?: RoundRow[] }): Promise<SessionRow[]> {
  const gf = filters?.global;
  const spec = gf?.spec;
  const state = gf?.state ?? {};
  const controlIds = gf?.controlIds;
  const gapMinutes = typeof gf?.sessionGapMinutes === "number" && Number.isFinite(gf.sessionGapMinutes) ? gf.sessionGapMinutes : 45;

  const key = normalizeGlobalFilterKey(spec, state, "session", controlIds) + `|gap=${gapMinutes}`;
  const cached = sessionsFilteredCache.get(key);
  if (cached) return cached as SessionRow[];

  // If prefiltered rounds are provided, build sessions from them (so round-grain filters affect sessionization).
  const raw = opts?.rounds ? await attachRatingsToSessions(buildSessionsFromRounds(opts.rounds, gapMinutes)) : await getSessionsRaw(gapMinutes);

  const applied = buildAppliedFilters(spec, state, "session", controlIds);
  let rows = raw as any[];
  if (applied.date) {
    const fromTs = applied.date.fromTs ?? null;
    const toTs = applied.date.toTs ?? null;
    if (fromTs !== null) rows = rows.filter((r) => typeof r.sessionStartTs === "number" && r.sessionStartTs >= fromTs);
    if (toTs !== null) rows = rows.filter((r) => typeof r.sessionStartTs === "number" && r.sessionStartTs <= toTs);
  }
  rows = applyFilters(rows, applied.clauses, "session");

  sessionsFilteredCache.set(key, rows);
  return rows as SessionRow[];
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
        if (typeof self === "number" && Number.isFinite(self) && typeof opp === "number" && Number.isFinite(opp)) {
          // Duel damage is the per-round score delta (bounded by [-5000, 5000]).
          out.damage = Math.max(-5000, Math.min(5000, self - opp));
        }
      } else if (mf === "teamduels") {
        const s1 = (out as any).player_self_score;
        const s2 = (out as any).player_mate_score;
        const o1 = (out as any).player_opponent_score;
        const o2 = (out as any).player_opponent_mate_score;
        const own = [s1, s2].filter((x: any) => typeof x === "number") as number[];
        const opp = [o1, o2].filter((x: any) => typeof x === "number") as number[];
        if (own.length && opp.length) {
          // Team Duel damage is the delta between the best score in each team (bounded by [-5000, 5000]).
          const bestOwn = Math.max(...own);
          const bestOpp = Math.max(...opp);
          if (Number.isFinite(bestOwn) && Number.isFinite(bestOpp)) {
            out.damage = Math.max(-5000, Math.min(5000, bestOwn - bestOpp));
          }
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
  const [games, details, rounds] = await Promise.all([db.games.toArray(), db.details.toArray(), db.rounds.toArray()]);

  const roundsCountByGame = new Map<string, number>();
  for (const r of rounds as any[]) {
    const gid = typeof r?.gameId === "string" ? r.gameId : "";
    if (!gid) continue;
    roundsCountByGame.set(gid, (roundsCountByGame.get(gid) ?? 0) + 1);
  }

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
    out.roundsCount = roundsCountByGame.get(g.gameId) ?? 0;

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
