/**
 * V3 server sync reading from the sync-only IndexedDB (db_v2).
 *
 * Maps self/mate/opp/oppMate fields → p1/p2/p3/p4 and posts to /api/v3/sync.
 * Used by the sync-only script's runFetchAndSync pipeline.
 */
import { dbV2, GameRow, RoundRow, getSyncState, setSyncState } from "./db_v2";
import { loadServerSyncSettings } from "./serverSync";
import { getCurrentPlayerId, getCurrentPlayerName } from "./app/playerIdentity";
import { deriveV3SyncUrl } from "./serverSync_v3";
import { getGmXmlhttpRequest } from "./gm";
import { httpGetJson } from "./http";

const CURSOR_KEY = "server_sync_v3";

function n(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function uc(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const x = v.trim().toUpperCase();
  return x || null;
}

function rDelta(after: number | undefined, before: number | undefined): number | null {
  return after != null && before != null ? after - before : null;
}

function getUserscriptVersion(): string | undefined {
  const v = (globalThis as any)?.GM_info?.script?.version;
  return typeof v === "string" ? v : undefined;
}

async function fetchOwnCountryCode(playerId: string): Promise<string | null> {
  try {
    const res = await httpGetJson(`https://www.geoguessr.com/api/v3/users/${encodeURIComponent(playerId)}`);
    if (res.status >= 200 && res.status < 300) {
      const cc = (res.data as any)?.countryCode ?? (res.data as any)?.user?.countryCode;
      if (typeof cc === "string" && cc.trim()) return cc.trim().toUpperCase();
    }
  } catch { /* ignore */ }
  return null;
}

function gmPost(url: string, body: string, token: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const gm = getGmXmlhttpRequest();
    if (!gm) return reject(new Error("GM_xmlhttpRequest not available"));
    gm({
      method: "POST",
      url,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(getUserscriptVersion() ? { "X-GA-Script-Version": getUserscriptVersion()! } : {}),
      },
      data: body as any,
      responseType: "text",
      timeout: 120000,
      onload: (r: any) => resolve({ status: r?.status ?? 0, text: r?.responseText ?? "" }),
      onerror: (e: any) => reject(e instanceof Error ? e : new Error("Request failed")),
      ontimeout: () => reject(new Error("Request timeout")),
    });
  });
}

export interface SyncV3Db2Result {
  ok: boolean;
  error?: string;
  counts?: {
    players: number;
    duel_games: number;
    duel_rounds: number;
    team_duel_games: number;
    team_duel_rounds: number;
  };
}

export async function syncV3FromDb2(opts: {
  forceFull?: boolean;
  gameIds?: string[];
} = {}): Promise<SyncV3Db2Result> {
  const settings = loadServerSyncSettings();
  if (!settings.token) return { ok: false, error: "no_token" };

  const url = deriveV3SyncUrl(settings.endpointUrl);
  if (!url) return { ok: false, error: "no_endpoint" };

  const forceFull = opts.forceFull === true;
  const cursorFrom: number = forceFull ? 0 : ((await getSyncState<number>(CURSOR_KEY)) ?? 0);

  const [ownPlayerId, ownPlayerName] = await Promise.all([getCurrentPlayerId(), getCurrentPlayerName()]);
  const ownCountry = ownPlayerId ? await fetchOwnCountryCode(ownPlayerId) : null;

  // Load relevant games from db_v2
  let games: GameRow[];
  if (opts.gameIds && !forceFull) {
    const idSet = new Set(opts.gameIds);
    games = await dbV2.games
      .filter((g) =>
        idSet.has(g.gameId) &&
        (g.modeFamily === "duels" || g.modeFamily === "teamduels") &&
        g.detailFetchedAt != null
      )
      .toArray();
  } else {
    games = await dbV2.games
      .filter((g) =>
        (g.modeFamily === "duels" || g.modeFamily === "teamduels") &&
        g.detailFetchedAt != null &&
        (forceFull || (g.detailFetchedAt! > cursorFrom))
      )
      .toArray();
  }

  if (games.length === 0 && !forceFull) {
    return { ok: true, counts: { players: 0, duel_games: 0, duel_rounds: 0, team_duel_games: 0, team_duel_rounds: 0 } };
  }

  const gameIdList = games.map((g) => g.gameId);
  const rounds: RoundRow[] = gameIdList.length > 0
    ? await dbV2.rounds.where("gameId").anyOf(gameIdList).toArray()
    : [];

  // Collect players
  type PlayerEntry = { playerId: string; playerName: string | null; countryCode: string | null; fetchedAt: number | null };
  const playerMap = new Map<string, PlayerEntry>();
  const addPlayer = (id: unknown, name: unknown, country: unknown, fetchedAt?: number) => {
    if (typeof id !== "string" || !id) return;
    const cc = typeof country === "string" && country.trim() ? country.trim().toUpperCase() : null;
    const nm = typeof name === "string" && name.trim() ? name.trim() : null;
    const existing = playerMap.get(id);
    if (!existing) {
      playerMap.set(id, { playerId: id, playerName: nm, countryCode: cc, fetchedAt: fetchedAt ?? null });
    } else {
      if (nm && !existing.playerName) existing.playerName = nm;
      if (cc && !existing.countryCode) existing.countryCode = cc;
      if (fetchedAt && (!existing.fetchedAt || fetchedAt > existing.fetchedAt)) existing.fetchedAt = fetchedAt;
    }
  };

  if (ownPlayerId) addPlayer(ownPlayerId, ownPlayerName, ownCountry, Date.now());

  const duelGames: any[] = [];
  const tdGames: any[] = [];
  const duelGameIds = new Set<string>();
  const tdGameIds = new Set<string>();

  for (const g of games) {
    const fat = g.detailFetchedAt;
    if (g.modeFamily === "duels") {
      addPlayer(g.p1Id, g.p1Name, g.p1Country, fat);
      addPlayer(g.p2Id, g.p2Name, g.p2Country, fat);

      // winnerTeamIdx: 0=team[0](p1) won, 1=team[1](p2) won
      const winnerPlayerId = g.winnerTeamIdx === 0 ? (g.p1Id ?? null)
                           : g.winnerTeamIdx === 1 ? (g.p2Id ?? null)
                           : null;

      duelGames.push({
        gameId: g.gameId,
        p1_playerId: g.p1Id ?? null,
        p2_playerId: g.p2Id ?? null,
        mapSlug: g.mapSlug ?? null,
        mapName: g.mapName ?? null,
        movementType: g.movementType ?? null,
        isRated: g.isRated != null ? (g.isRated ? 1 : 0) : null,
        totalRounds: g.totalRounds ?? null,
        winnerPlayerId,
        p1_ratingAfter: n(g.p1RatingAfter),
        p1_ratingDelta: rDelta(g.p1RatingAfter, g.p1RatingBefore),
        p1_movingRatingAfter: n(g.p1MovingRatingAfter),
        p1_movingRatingDelta: rDelta(g.p1MovingRatingAfter, g.p1MovingRatingBefore),
        p1_noMoveRatingAfter: n(g.p1NoMoveRatingAfter),
        p1_noMoveRatingDelta: rDelta(g.p1NoMoveRatingAfter, g.p1NoMoveRatingBefore),
        p1_nmpzRatingAfter: n(g.p1NmpzRatingAfter),
        p1_nmpzRatingDelta: rDelta(g.p1NmpzRatingAfter, g.p1NmpzRatingBefore),
        p2_ratingAfter: n(g.p2RatingAfter),
        p2_ratingDelta: rDelta(g.p2RatingAfter, g.p2RatingBefore),
        p2_movingRatingAfter: n(g.p2MovingRatingAfter),
        p2_movingRatingDelta: rDelta(g.p2MovingRatingAfter, g.p2MovingRatingBefore),
        p2_noMoveRatingAfter: n(g.p2NoMoveRatingAfter),
        p2_noMoveRatingDelta: rDelta(g.p2NoMoveRatingAfter, g.p2NoMoveRatingBefore),
        p2_nmpzRatingAfter: n(g.p2NmpzRatingAfter),
        p2_nmpzRatingDelta: rDelta(g.p2NmpzRatingAfter, g.p2NmpzRatingBefore),
        playedAt: g.playedAt ?? null,
      });
      duelGameIds.add(g.gameId);
    } else if (g.modeFamily === "teamduels") {
      addPlayer(g.p1Id, g.p1Name, g.p1Country, fat);
      addPlayer(g.p2Id, g.p2Name, g.p2Country, fat);
      addPlayer(g.p3Id, g.p3Name, g.p3Country, fat);
      addPlayer(g.p4Id, g.p4Name, g.p4Country, fat);

      // winnerTeamIdx: 0=team[0](p1+p2) won → "blue"; 1=team[1](p3+p4) won → "red"
      const winnerTeam = g.winnerTeamIdx === 0 ? "blue" : g.winnerTeamIdx === 1 ? "red" : null;

      tdGames.push({
        gameId: g.gameId,
        p1_playerId: g.p1Id ?? null,
        p2_playerId: g.p2Id ?? null,
        p3_playerId: g.p3Id ?? null,
        p4_playerId: g.p4Id ?? null,
        mapSlug: g.mapSlug ?? null,
        mapName: g.mapName ?? null,
        movementType: g.movementType ?? null,
        isRated: g.isRated != null ? (g.isRated ? 1 : 0) : null,
        totalRounds: g.totalRounds ?? null,
        winnerTeam,
        p1_ratingAfter: n(g.p1RatingAfter),
        p1_ratingDelta: rDelta(g.p1RatingAfter, g.p1RatingBefore),
        p2_ratingAfter: n(g.p2RatingAfter),
        p2_ratingDelta: rDelta(g.p2RatingAfter, g.p2RatingBefore),
        p3_ratingAfter: n(g.p3RatingAfter),
        p3_ratingDelta: rDelta(g.p3RatingAfter, g.p3RatingBefore),
        p4_ratingAfter: n(g.p4RatingAfter),
        p4_ratingDelta: rDelta(g.p4RatingAfter, g.p4RatingBefore),
        playedAt: g.playedAt ?? null,
      });
      tdGameIds.add(g.gameId);
    }
  }

  // Build round arrays
  const duelRounds: any[] = [];
  const tdRounds: any[] = [];

  for (const r of rounds) {
    if (duelGameIds.has(r.gameId)) {
      duelRounds.push({
        gameId: r.gameId,
        roundNumber: r.roundNumber,
        trueLat: n(r.trueLat),
        trueLng: n(r.trueLng),
        trueCountry: uc(r.trueCountry),
        trueHeading: n(r.trueHeadingDeg),
        startTime: n(r.startTime),
        durationSec: n(r.durationSec),
        isHealingRound: null,
        damageMultiplier: n(r.damageMultiplier),
        p1_lat: n(r.p1Lat),
        p1_lng: n(r.p1Lng),
        p1_country: uc(r.p1Country),
        p1_score: n(r.p1Score),
        p1_distanceKm: n(r.p1Distance),
        p1_timeSec: n(r.p1TimeSec),
        p1_timedOut: r.p1TimedOut ? 1 : 0,
        p1_healthAfter: n(r.team0HealthAfter),
        p1_isBestGuess: 0,
        p2_lat: n(r.p2Lat),
        p2_lng: n(r.p2Lng),
        p2_country: uc(r.p2Country),
        p2_score: n(r.p2Score),
        p2_distanceKm: n(r.p2Distance),
        p2_healthAfter: n(r.team1HealthAfter),
        p2_isBestGuess: 0,
      });
    } else if (tdGameIds.has(r.gameId)) {
      tdRounds.push({
        gameId: r.gameId,
        roundNumber: r.roundNumber,
        trueLat: n(r.trueLat),
        trueLng: n(r.trueLng),
        trueCountry: uc(r.trueCountry),
        trueHeading: n(r.trueHeadingDeg),
        startTime: n(r.startTime),
        durationSec: n(r.durationSec),
        isHealingRound: r.isHealing ? 1 : null,
        damageMultiplier: n(r.damageMultiplier),
        p1_lat: n(r.p1Lat),
        p1_lng: n(r.p1Lng),
        p1_country: uc(r.p1Country),
        p1_score: n(r.p1Score),
        p1_distanceKm: n(r.p1Distance),
        p1_isBestGuess: r.p1IsBetterGuess ? 1 : 0,
        p2_lat: n(r.p2Lat),
        p2_lng: n(r.p2Lng),
        p2_country: uc(r.p2Country),
        p2_score: n(r.p2Score),
        p2_distanceKm: n(r.p2Distance),
        p2_isBestGuess: r.p2IsBetterGuess ? 1 : 0,
        p3_lat: n(r.p3Lat),
        p3_lng: n(r.p3Lng),
        p3_country: uc(r.p3Country),
        p3_score: n(r.p3Score),
        p3_distanceKm: n(r.p3Distance),
        p3_isBestGuess: r.p3IsBetterGuess ? 1 : 0,
        p4_lat: n(r.p4Lat),
        p4_lng: n(r.p4Lng),
        p4_country: uc(r.p4Country),
        p4_score: n(r.p4Score),
        p4_distanceKm: n(r.p4Distance),
        p4_isBestGuess: r.p4IsBetterGuess ? 1 : 0,
        blue_healthAfter: n(r.team0HealthAfter),
        red_healthAfter: n(r.team1HealthAfter),
      });
    }
  }

  const players = Array.from(playerMap.values());
  const envelope = {
    schema: "geoanalyzr-v3-sync",
    schemaVersion: 1,
    createdAt: Date.now(),
    appVersion: getUserscriptVersion(),
    owner: { playerId: ownPlayerId, playerName: ownPlayerName },
    cursor: { from: cursorFrom },
    players,
    duel_games: duelGames,
    duel_rounds: duelRounds,
    team_duel_games: tdGames,
    team_duel_rounds: tdRounds,
  };

  const jsonBody = JSON.stringify(envelope);
  let res: { status: number; text: string };
  try {
    res = await gmPost(url, jsonBody, settings.token);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const ok = res.status >= 200 && res.status < 300;
  if (ok) {
    // Advance cursor to max detailFetchedAt among synced games
    const maxFetchedAt = games.reduce((m, g) => Math.max(m, g.detailFetchedAt ?? 0), 0);
    if (maxFetchedAt > 0) {
      await setSyncState(CURSOR_KEY, maxFetchedAt);
    }
  }

  const parsed = (() => { try { return JSON.parse(res.text); } catch { return null; } })();
  return {
    ok,
    error: ok ? undefined : (parsed?.error ?? `HTTP ${res.status}`),
    counts: parsed?.counts ?? {
      players: players.length,
      duel_games: duelGames.length,
      duel_rounds: duelRounds.length,
      team_duel_games: tdGames.length,
      team_duel_rounds: tdRounds.length,
    },
  };
}
