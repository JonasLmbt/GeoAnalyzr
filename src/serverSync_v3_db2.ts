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
      addPlayer(g.selfId, g.selfName, g.selfCountry, fat);
      addPlayer(g.oppId, g.oppName, g.oppCountry, fat);

      duelGames.push({
        gameId: g.gameId,
        p1_playerId: g.selfId ?? null,
        p2_playerId: g.oppId ?? null,
        mapSlug: g.mapSlug ?? null,
        mapName: g.mapName ?? null,
        movementType: g.movementType ?? null,
        isRated: g.isRated != null ? (g.isRated ? 1 : 0) : null,
        totalRounds: g.totalRounds ?? null,
        winnerPlayerId: g.selfVictory === true ? (g.selfId ?? null) : g.selfVictory === false ? (g.oppId ?? null) : null,
        p1_ratingAfter: n(g.selfRatingAfter),
        p1_ratingDelta: rDelta(g.selfRatingAfter, g.selfRatingBefore),
        p1_movingRatingAfter: n(g.selfMovingRatingAfter),
        p1_movingRatingDelta: rDelta(g.selfMovingRatingAfter, g.selfMovingRatingBefore),
        p1_noMoveRatingAfter: n(g.selfNoMoveRatingAfter),
        p1_noMoveRatingDelta: rDelta(g.selfNoMoveRatingAfter, g.selfNoMoveRatingBefore),
        p1_nmpzRatingAfter: n(g.selfNmpzRatingAfter),
        p1_nmpzRatingDelta: rDelta(g.selfNmpzRatingAfter, g.selfNmpzRatingBefore),
        p2_ratingAfter: n(g.oppRatingAfter),
        p2_ratingDelta: rDelta(g.oppRatingAfter, g.oppRatingBefore),
        p2_movingRatingAfter: n(g.oppMovingRatingAfter),
        p2_movingRatingDelta: rDelta(g.oppMovingRatingAfter, g.oppMovingRatingBefore),
        p2_noMoveRatingAfter: n(g.oppNoMoveRatingAfter),
        p2_noMoveRatingDelta: rDelta(g.oppNoMoveRatingAfter, g.oppNoMoveRatingBefore),
        p2_nmpzRatingAfter: n(g.oppNmpzRatingAfter),
        p2_nmpzRatingDelta: rDelta(g.oppNmpzRatingAfter, g.oppNmpzRatingBefore),
        playedAt: g.playedAt ?? null,
      });
      duelGameIds.add(g.gameId);
    } else if (g.modeFamily === "teamduels") {
      addPlayer(g.selfId, g.selfName, g.selfCountry, fat);
      addPlayer(g.mateId, g.mateName, g.mateCountry, fat);
      addPlayer(g.oppId, g.oppName, g.oppCountry, fat);
      addPlayer(g.oppMateId, g.oppMateName, g.oppMateCountry, fat);

      tdGames.push({
        gameId: g.gameId,
        p1_playerId: g.selfId ?? null,
        p2_playerId: g.mateId ?? null,
        p3_playerId: g.oppId ?? null,
        p4_playerId: g.oppMateId ?? null,
        mapSlug: g.mapSlug ?? null,
        mapName: g.mapName ?? null,
        movementType: g.movementType ?? null,
        isRated: g.isRated != null ? (g.isRated ? 1 : 0) : null,
        totalRounds: g.totalRounds ?? null,
        winnerTeam: g.selfVictory === true ? "blue" : g.selfVictory === false ? "red" : null,
        p1_ratingAfter: n(g.selfRatingAfter),
        p1_ratingDelta: rDelta(g.selfRatingAfter, g.selfRatingBefore),
        p2_ratingAfter: n(g.mateRatingAfter),
        p2_ratingDelta: rDelta(g.mateRatingAfter, g.mateRatingBefore),
        p3_ratingAfter: n(g.oppRatingAfter),
        p3_ratingDelta: rDelta(g.oppRatingAfter, g.oppRatingBefore),
        p4_ratingAfter: n(g.oppMateRatingAfter),
        p4_ratingDelta: rDelta(g.oppMateRatingAfter, g.oppMateRatingBefore),
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
        p1_lat: n(r.selfLat),
        p1_lng: n(r.selfLng),
        p1_country: uc(r.selfCountry),
        p1_score: n(r.selfScore),
        p1_distanceKm: n(r.selfDistance),
        p1_timeSec: n(r.selfTimeSec),
        p1_timedOut: r.selfTimedOut ? 1 : 0,
        p1_healthAfter: n(r.selfHealthAfter),
        p1_isBestGuess: 0,
        p2_lat: n(r.oppLat),
        p2_lng: n(r.oppLng),
        p2_country: uc(r.oppCountry),
        p2_score: n(r.oppScore),
        p2_distanceKm: n(r.oppDistance),
        p2_healthAfter: n(r.oppHealthAfter),
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
        p1_lat: n(r.selfLat),
        p1_lng: n(r.selfLng),
        p1_country: uc(r.selfCountry),
        p1_score: n(r.selfScore),
        p1_distanceKm: n(r.selfDistance),
        p1_isBestGuess: r.selfIsBetterGuess ? 1 : 0,
        p2_lat: n(r.mateLat),
        p2_lng: n(r.mateLng),
        p2_country: uc(r.mateCountry),
        p2_score: n(r.mateScore),
        p2_distanceKm: n(r.mateDistance),
        p3_lat: n(r.oppLat),
        p3_lng: n(r.oppLng),
        p3_country: uc(r.oppCountry),
        p3_score: n(r.oppScore),
        p3_distanceKm: n(r.oppDistance),
        p4_lat: n(r.oppMateLat),
        p4_lng: n(r.oppMateLng),
        p4_country: uc(r.oppMateCountry),
        p4_score: n(r.oppMateScore),
        p4_distanceKm: n(r.oppMateDistance),
        blue_healthAfter: n(r.selfHealthAfter),
        red_healthAfter: n(r.oppHealthAfter),
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
