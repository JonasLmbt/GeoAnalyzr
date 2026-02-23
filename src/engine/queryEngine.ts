// src/engine/queryEngine.ts
import { db } from "../db";
import type { RoundRow, GameFactRow } from "../db";
import type { GlobalFiltersSpec } from "../config/dashboard.types";
import { applyFilters } from "./filters";
import { buildAppliedFilters, normalizeGlobalFilterKey, type GlobalFilterState } from "./globalFilters";
import { resolveCountryCodeByLatLngLocalOnly } from "../countries";

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
  hitScoreSum: number;
  hitScoreCount: number;
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

  // Game outcomes inside the session (best effort; depends on available game metadata).
  winCount?: number;
  lossCount?: number;
  tieCount?: number;
  gamesWithOutcome?: number;

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
    let hitScoreSum = 0, hitScoreCount = 0;
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
      const isHit = typeof truth === "string" && truth && typeof guess === "string" && guess === truth;
      if (isHit) {
        hitCount++;
        if (typeof s === "number" && Number.isFinite(s)) {
          hitScoreSum += s;
          hitScoreCount++;
        }
      }

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
      hitScoreSum,
      hitScoreCount,
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
  const mfRaw = asTrimmedString(g?.modeFamily ?? g?.mode_family) ?? "";
  const mf = mfRaw.toLowerCase();
  const isTeam = g?.isTeamDuels === true || mf === "teamduels" || (mf.includes("team") && mf.includes("duel"));

  const pickNum = (keys: string[]): number | undefined => {
    const v = pickFirst(g, keys);
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };

  if (isTeam) {
    const start = pickNum(["teamOneStartRating", "player_self_startRating", "playerOneStartRating", "team1StartRating"]);
    const end = pickNum(["teamOneEndRating", "player_self_endRating", "playerOneEndRating", "team1EndRating"]);
    return { start, end };
  }

  const start = pickNum(["player_self_startRating", "playerOneStartRating"]);
  const end = pickNum(["player_self_endRating", "playerOneEndRating"]);
  return { start, end };
}

function getGameOutcome(g: any): "win" | "loss" | "tie" | null {
  const v =
    typeof g?.player_self_victory === "boolean"
      ? g.player_self_victory
      : typeof g?.teamOneVictory === "boolean"
        ? g.teamOneVictory
        : typeof g?.playerOneVictory === "boolean"
          ? g.playerOneVictory
          : undefined;
  if (typeof v === "boolean") return v ? "win" : "loss";

  const r = g?.result;
  const s = typeof r === "string" ? r.trim().toLowerCase() : "";
  if (!s) return null;
  if (s === "win" || s === "w" || s === "true") return "win";
  if (s === "loss" || s === "l" || s === "false") return "loss";
  if (s === "tie" || s === "t" || s === "draw") return "tie";
  return null;
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
    let firstRating: number | undefined;
    let lastRating: number | undefined;
    let prevEnd: number | undefined;
    let deltaSum = 0;
    let haveDelta = false;

    let winCount = 0;
    let lossCount = 0;
    let tieCount = 0;
    let gamesWithOutcome = 0;

    for (const g of sorted) {
      const outcome = getGameOutcome(g);
      if (outcome) {
        gamesWithOutcome++;
        if (outcome === "win") winCount++;
        else if (outcome === "loss") lossCount++;
        else tieCount++;
      }

      const r = extractGameRatings(g);
      const start = typeof r.start === "number" && Number.isFinite(r.start) ? r.start : undefined;
      const end = typeof r.end === "number" && Number.isFinite(r.end) ? r.end : undefined;
      const startEff = start ?? prevEnd ?? end;

      if (firstRating === undefined && typeof startEff === "number" && Number.isFinite(startEff)) firstRating = startEff;
      if (typeof end === "number" && Number.isFinite(end)) {
        lastRating = end;
        prevEnd = end;
      }

      if (typeof startEff === "number" && Number.isFinite(startEff) && typeof end === "number" && Number.isFinite(end)) {
        deltaSum += end - startEff;
        haveDelta = true;
      }
    }

    if (typeof firstRating === "number" && typeof lastRating === "number") {
      s.ratingStart = firstRating;
      s.ratingEnd = lastRating;
      s.ratingDelta = lastRating - firstRating;
    } else if (haveDelta) {
      s.ratingDelta = deltaSum;
    }

    if (gamesWithOutcome > 0) {
      s.winCount = winCount;
      s.lossCount = lossCount;
      s.tieCount = tieCount;
      s.gamesWithOutcome = gamesWithOutcome;
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

  // Important: when sessions are built from a caller-provided round list, they are inherently local/ephemeral
  // (e.g. "sessions together with teammate X"). Caching them under the same global key would cause cross-contamination
  // between different local datasets and even different sections, which leads to obviously wrong session counts/breaks.
  const fromProvidedRounds = Array.isArray(opts?.rounds);

  const key = normalizeGlobalFilterKey(spec, state, "session", controlIds) + `|gap=${gapMinutes}`;
  if (!fromProvidedRounds) {
    const cached = sessionsFilteredCache.get(key);
    if (cached) return cached as SessionRow[];
  }

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

  if (!fromProvidedRounds) sessionsFilteredCache.set(key, rows);
  return rows as SessionRow[];
}

export async function getGamePlayedAtBounds(): Promise<{ minTs: number | null; maxTs: number | null }> {
  const isInvalidKeyRangeError = (e: unknown): boolean => {
    const any = e as any;
    const name = typeof any?.name === "string" ? any.name : "";
    const message = typeof any?.message === "string" ? any.message : "";
    // Firefox/Chromium usually surface this as a DOMException "DataError".
    if (name === "DataError" && message.toLowerCase().includes("idbkeyrange")) return true;
    return message.includes("IDBKeyRange") && message.toLowerCase().includes("valid key");
  };

  // Fast path using the playedAt index.
  try {
    const first = await db.games.orderBy("playedAt").first();
    const last = await db.games.orderBy("playedAt").last();
    const minTs = first && typeof first.playedAt === "number" ? first.playedAt : null;
    const maxTs = last && typeof last.playedAt === "number" ? last.playedAt : null;
    return { minTs, maxTs };
  } catch (e) {
    // Fallback: if the index or key-range query is broken for some users, compute bounds by scanning.
    // This avoids IndexedDB key-range creation (IDBKeyRange.bound) paths entirely.
    if (!isInvalidKeyRangeError(e)) throw e;
    const games = await db.games.toArray();
    let minTs: number | null = null;
    let maxTs: number | null = null;
    for (const g of games as any[]) {
      const ts = typeof g?.playedAt === "number" && Number.isFinite(g.playedAt) ? g.playedAt : null;
      if (ts === null) continue;
      minTs = minTs === null ? ts : Math.min(minTs, ts);
      maxTs = maxTs === null ? ts : Math.max(maxTs, ts);
    }
    return { minTs, maxTs };
  }
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

  roundsRawCache = await Promise.all(rows.map(async (r) => {
    const out: any = { ...(r as any) };
    const gameId = String(out.gameId ?? "");
    const d = detailsByGame.get(gameId);

    // Backfill game-level fields onto rounds for round-grain filters/exports.
    if (d) {
      if (typeof out.mapSlug !== "string" || !out.mapSlug) {
        const ms = typeof d?.mapSlug === "string" ? d.mapSlug : typeof d?.raw?.options?.map?.slug === "string" ? d.raw.options.map.slug : "";
        if (ms) out.mapSlug = ms;
      }
      if (typeof out.mapName !== "string" || !out.mapName) {
        const mn = typeof d?.mapName === "string" ? d.mapName : typeof d?.raw?.options?.map?.name === "string" ? d.raw.options.map.name : "";
        if (mn) out.mapName = mn;
      }
      if (typeof out.isRated !== "boolean") {
        const ir = d?.isRated;
        const rawIr = d?.raw?.options?.isRated;
        if (ir === true || ir === false) out.isRated = ir;
        else if (rawIr === true || rawIr === false) out.isRated = rawIr;
      }
    }

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

    // Normalize guess duration:
    // - Ignore 0 / missing values.
    // - If start/end timestamps exist and disagree strongly with durationSeconds, prefer derived.
    // This prevents broken constant values like 120.0s when timestamps show something else.
    let rawDur = typeof out.durationSeconds === "number" && Number.isFinite(out.durationSeconds) && out.durationSeconds > 0 ? out.durationSeconds : null;
    const start = typeof out.startTime === "number" && Number.isFinite(out.startTime) ? out.startTime : null;
    const end = typeof out.endTime === "number" && Number.isFinite(out.endTime) ? out.endTime : null;
    const derived = start !== null && end !== null && end > start ? (end - start) / 1000 : null;
    const derivedOk = derived !== null && Number.isFinite(derived) && derived > 0 && derived < 60 * 30 ? derived : null;
    if (derivedOk !== null) {
      if (rawDur === null || Math.abs(rawDur - derivedOk) > 6) out.durationSeconds = derivedOk;
    } else if (rawDur === null) {
      // Keep it unset if nothing trustworthy exists (prevents misleading 0s).
      delete out.durationSeconds;
    } else if (start === null || end === null) {
      // Heuristic: some data sources seem to store the time limit (e.g. 120s) instead of actual guess duration.
      // If we don't have timestamps, treat common time-limit constants as missing.
      const rounded = Math.round(rawDur);
      if (Math.abs(rawDur - rounded) < 0.001 && [60, 90, 120, 180, 300].includes(rounded)) {
        delete out.durationSeconds;
        rawDur = null;
      }
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
        const selfId = asTrimmedString(out.player_self_playerId) ?? asTrimmedString((out as any).player_self_id);
        const selfName = asTrimmedString((out as any).player_self_name) ?? asTrimmedString((d as any).player_self_name);
        const t1id = asTrimmedString(d.teamOnePlayerOneId);
        const t2id = asTrimmedString(d.teamOnePlayerTwoId);
        const t1name = asTrimmedString(d.teamOnePlayerOneName);
        const t2name = asTrimmedString(d.teamOnePlayerTwoName);
        const u1id = asTrimmedString((d as any).teamTwoPlayerOneId);
        const u2id = asTrimmedString((d as any).teamTwoPlayerTwoId);
        const u1name = asTrimmedString((d as any).teamTwoPlayerOneName);
        const u2name = asTrimmedString((d as any).teamTwoPlayerTwoName);
        let mateName: string | undefined;
        if (selfId && selfId === t1id) mateName = t2name;
        else if (selfId && selfId === t2id) mateName = t1name;
        else if (selfId && selfId === u1id) mateName = u2name;
        else if (selfId && selfId === u2id) mateName = u1name;
        else mateName = asTrimmedString(pickFirst(d, ["player_mate_name", "teamOnePlayerTwoName", "p2_name"]));
        if (mateName && selfName && mateName.trim() === selfName.trim()) mateName = undefined;
        if (mateName) out.teammateName = mateName;
      }
    }

    // Best-effort: ensure guessCountry exists for confusion matrix / hit-rate dimensions.
    // Do this locally only (no network), and only if we have a guess coordinate.
    const existingGuess = typeof out.player_self_guessCountry === "string" ? out.player_self_guessCountry : typeof out.p1_guessCountry === "string" ? out.p1_guessCountry : typeof out.guessCountry === "string" ? out.guessCountry : "";
    if (!existingGuess) {
      const glat = typeof out.player_self_guessLat === "number" ? out.player_self_guessLat : typeof out.p1_guessLat === "number" ? out.p1_guessLat : undefined;
      const glng = typeof out.player_self_guessLng === "number" ? out.player_self_guessLng : typeof out.p1_guessLng === "number" ? out.p1_guessLng : undefined;
      if (typeof glat === "number" && Number.isFinite(glat) && typeof glng === "number" && Number.isFinite(glng)) {
        const iso = await resolveCountryCodeByLatLngLocalOnly(glat, glng);
        if (iso) out.player_self_guessCountry = iso;
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
  }));

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
  const movementByGame = new Map<string, string>();
  const scoreSumByGame = new Map<string, number>();
  const scoreCountByGame = new Map<string, number>();
  const fivekCountByGame = new Map<string, number>();
  const throwCountByGame = new Map<string, number>();
  const hitCountByGame = new Map<string, number>();
  const hitDenomByGame = new Map<string, number>();
  const minStartByGame = new Map<string, number>();
  const maxEndByGame = new Map<string, number>();
  const minHealthAfterByGame = new Map<string, number>();
  const maxHealthAfterByGame = new Map<string, number>();
  const finalHealthAfterByGame = new Map<string, number>();
  const finalHealthMarkerByGame = new Map<string, number>();
  for (const r of rounds as any[]) {
    const gid = typeof r?.gameId === "string" ? r.gameId : "";
    if (!gid) continue;
    roundsCountByGame.set(gid, (roundsCountByGame.get(gid) ?? 0) + 1);

    const mv = typeof r?.movementType === "string" ? r.movementType : typeof r?.movement_type === "string" ? r.movement_type : "";
    const cur = movementByGame.get(gid);
    if (mv) {
      if (!cur) {
        movementByGame.set(gid, mv);
      } else if (cur !== mv && cur !== "mixed") {
        movementByGame.set(gid, "mixed");
      }
    }

    // Round aggregates (for game-level records).
    const score = typeof r?.player_self_score === "number" ? r.player_self_score : typeof r?.p1_score === "number" ? r.p1_score : typeof r?.score === "number" ? r.score : null;
    if (typeof score === "number" && Number.isFinite(score) && score >= 0) {
      scoreSumByGame.set(gid, (scoreSumByGame.get(gid) ?? 0) + score);
      scoreCountByGame.set(gid, (scoreCountByGame.get(gid) ?? 0) + 1);
      if (score >= 5000) fivekCountByGame.set(gid, (fivekCountByGame.get(gid) ?? 0) + 1);
      if (score < 50) throwCountByGame.set(gid, (throwCountByGame.get(gid) ?? 0) + 1);
    }

    const truth = typeof r?.trueCountry === "string" ? r.trueCountry : typeof r?.true_country === "string" ? r.true_country : "";
    const guess = typeof r?.player_self_guessCountry === "string" ? r.player_self_guessCountry : typeof r?.p1_guessCountry === "string" ? r.p1_guessCountry : typeof r?.guessCountry === "string" ? r.guessCountry : "";
    if (truth && guess) {
      hitDenomByGame.set(gid, (hitDenomByGame.get(gid) ?? 0) + 1);
      if (guess === truth) hitCountByGame.set(gid, (hitCountByGame.get(gid) ?? 0) + 1);
    }

    const start = typeof r?.startTime === "number" && Number.isFinite(r.startTime) ? r.startTime : null;
    const end = typeof r?.endTime === "number" && Number.isFinite(r.endTime) ? r.endTime : null;
    if (start !== null) {
      const curMin = minStartByGame.get(gid);
      minStartByGame.set(gid, curMin === undefined ? start : Math.min(curMin, start));
    }
    if (end !== null) {
      const curMax = maxEndByGame.get(gid);
      maxEndByGame.set(gid, curMax === undefined ? end : Math.max(curMax, end));
    }

    const h = typeof r?.player_self_healthAfter === "number" && Number.isFinite(r.player_self_healthAfter) ? r.player_self_healthAfter : null;
    if (h !== null) {
      const curMin = minHealthAfterByGame.get(gid);
      const curMax = maxHealthAfterByGame.get(gid);
      minHealthAfterByGame.set(gid, curMin === undefined ? h : Math.min(curMin, h));
      maxHealthAfterByGame.set(gid, curMax === undefined ? h : Math.max(curMax, h));

      const marker =
        (typeof r?.endTime === "number" && Number.isFinite(r.endTime) ? r.endTime : null) ??
        (typeof r?.startTime === "number" && Number.isFinite(r.startTime) ? r.startTime : null) ??
        (typeof r?.roundNumber === "number" && Number.isFinite(r.roundNumber) ? r.roundNumber : null);
      if (marker !== null) {
        const curMarker = finalHealthMarkerByGame.get(gid);
        if (curMarker === undefined || marker >= curMarker) {
          finalHealthMarkerByGame.set(gid, marker);
          finalHealthAfterByGame.set(gid, h);
        }
      }
    }
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
    if (typeof out.movementType !== "string" || !out.movementType) {
      const mv = movementByGame.get(g.gameId);
      if (mv) out.movementType = mv;
    }
    if (typeof out.movementType !== "string" || !out.movementType || String(out.movementType).toLowerCase() === "unknown") {
      const raw =
        asTrimmedString(out.gameModeSimple) ??
        asTrimmedString(out.gameMode) ??
        asTrimmedString(out.mode) ??
        asTrimmedString(out.gameType);
      const norm = normalizeMovementType(raw);
      if (norm !== "unknown") out.movementType = norm;
    }

    const scoreSum = scoreSumByGame.get(g.gameId);
    const scoreCount = scoreCountByGame.get(g.gameId);
    if (typeof scoreSum === "number") out.scoreSum = scoreSum;
    if (typeof scoreCount === "number") out.scoreCount = scoreCount;
    out.fivekCount = fivekCountByGame.get(g.gameId) ?? 0;
    out.throwCount = throwCountByGame.get(g.gameId) ?? 0;
    out.hitCount = hitCountByGame.get(g.gameId) ?? 0;
    out.hitDenom = hitDenomByGame.get(g.gameId) ?? 0;

    const minStart = minStartByGame.get(g.gameId);
    const maxEnd = maxEndByGame.get(g.gameId);
    if (typeof minStart === "number" && typeof maxEnd === "number" && Number.isFinite(minStart) && Number.isFinite(maxEnd) && maxEnd > minStart) {
      out.gameDurationSeconds = (maxEnd - minStart) / 1000;
    }

    // Flawless win (no damage taken) approximated via constant healthAfter across all rounds.
    const minH = minHealthAfterByGame.get(g.gameId);
    const maxH = maxHealthAfterByGame.get(g.gameId);
    if (typeof minH === "number" && typeof maxH === "number" && Number.isFinite(minH) && Number.isFinite(maxH) && minH === maxH && maxH > 0) {
      out.isFlawless = true;
    }

    const finalH = finalHealthAfterByGame.get(g.gameId);
    if (typeof finalH === "number" && Number.isFinite(finalH) && finalH >= 0) {
      out.player_self_finalHealth = finalH;
    }

    // Best-effort normalize teammateName for team duels.
    if (String(out.modeFamily ?? "").toLowerCase() === "teamduels") {
      const hasMate = typeof out.teammateName === "string" && out.teammateName.trim().length > 0;
      if (!hasMate) {
        const selfId = asTrimmedString(out.player_self_id ?? out.player_self_playerId);
        const selfName = asTrimmedString((out as any).player_self_name) ?? asTrimmedString((out as any).playerOneName);
        const t1id = asTrimmedString(out.teamOnePlayerOneId);
        const t2id = asTrimmedString(out.teamOnePlayerTwoId);
        const t1name = asTrimmedString(out.teamOnePlayerOneName);
        const t2name = asTrimmedString(out.teamOnePlayerTwoName);
        const u1id = asTrimmedString((out as any).teamTwoPlayerOneId);
        const u2id = asTrimmedString((out as any).teamTwoPlayerTwoId);
        const u1name = asTrimmedString((out as any).teamTwoPlayerOneName);
        const u2name = asTrimmedString((out as any).teamTwoPlayerTwoName);
        let mateName: string | undefined;
        if (selfId && selfId === t1id) mateName = t2name;
        else if (selfId && selfId === t2id) mateName = t1name;
        else if (selfId && selfId === u1id) mateName = u2name;
        else if (selfId && selfId === u2id) mateName = u1name;
        else mateName = asTrimmedString(pickFirst(out, ["player_mate_name", "teamOnePlayerTwoName"]));
        if (mateName && selfName && mateName.trim() === selfName.trim()) mateName = undefined;
        if (mateName) out.teammateName = mateName;
      }
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

    if (out.isFlawless === true) {
      const res = String(out.result ?? "").trim().toLowerCase();
      out.isFlawlessWin = res === "win" || res === "w" || res === "true";
    }

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
