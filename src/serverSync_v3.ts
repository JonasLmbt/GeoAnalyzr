import { db } from "./db";
import { getCurrentPlayerId, getCurrentPlayerName } from "./app/playerIdentity";
import { httpGetJson } from "./http";
import { loadServerSyncSettings } from "./serverSync";
import { getGmXmlhttpRequest } from "./gm";

export type ServerSyncV3Status = {
  ok: boolean;
  status: number;
  responseText: string;
  counts: {
    players: number;
    duel_games: number;
    duel_rounds: number;
    team_duel_games: number;
    team_duel_rounds: number;
  };
  bytesJson: number;
};

const SYNC_META_KEY_V3 = "server_sync_v3";

function rDelta(after: number | undefined | null, before: number | undefined | null): number | null {
  if (after != null && before != null) return (after as number) - (before as number);
  return null;
}

function n(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function b(v: unknown): number | null {
  if (v === true) return 1;
  if (v === false) return 0;
  return null;
}

function uc(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const x = v.trim().toUpperCase();
  return x || null;
}

function getUserscriptVersion(): string | undefined {
  const anyGlobal = globalThis as any;
  const info = anyGlobal?.GM_info;
  const v = info?.script?.version;
  return typeof v === "string" ? v : undefined;
}

function gmPostJson(
  url: string,
  body: string,
  headers: Record<string, string>
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const gm = getGmXmlhttpRequest();
    if (!gm) return reject(new Error("GM_xmlhttpRequest is not available."));
    gm({
      method: "POST",
      url,
      headers,
      data: body as any,
      responseType: "text",
      timeout: 120000,
      onload: (res: any) => resolve({ status: typeof res?.status === "number" ? res.status : 0, text: typeof res?.responseText === "string" ? res.responseText : "" }),
      onerror: (err: any) => reject(err instanceof Error ? err : new Error("Request failed")),
      ontimeout: () => reject(new Error("Request timeout")),
    });
  });
}

export function deriveV3SyncUrl(endpointUrl: string): string {
  const trimmed = (endpointUrl || "").trim();
  if (!trimmed) return "";
  try {
    const u = new URL(trimmed);
    u.pathname = "/api/v3/sync";
    u.search = "";
    return u.toString();
  } catch {
    if (/\/api\/sync.*$/i.test(trimmed)) return trimmed.replace(/\/api\/sync.*$/i, "/api/v3/sync");
    return trimmed.replace(/\/+$/, "") + "/api/v3/sync";
  }
}

export async function getLastServerSyncV3Cursor(): Promise<number> {
  const meta = await db.meta.get(SYNC_META_KEY_V3);
  const cursor = (meta?.value as any)?.cursorTo;
  return typeof cursor === "number" && Number.isFinite(cursor) ? Math.max(0, Math.floor(cursor)) : 0;
}

async function fetchOwnCountryCode(playerId: string): Promise<string | null> {
  try {
    const res = await httpGetJson(`https://www.geoguessr.com/api/v3/users/${encodeURIComponent(playerId)}`);
    if (res.status >= 200 && res.status < 300) {
      const cc = (res.data as any)?.countryCode ?? (res.data as any)?.user?.countryCode;
      if (typeof cc === "string" && cc.trim()) return cc.trim().toUpperCase();
    }
  } catch {
    // ignore
  }
  return null;
}

export async function runServerSyncV3(opts: { forceFull?: boolean } = {}): Promise<ServerSyncV3Status> {
  const settings = loadServerSyncSettings();
  const endpointUrl = deriveV3SyncUrl(settings.endpointUrl);
  if (!endpointUrl) throw new Error("Missing sync endpoint URL.");
  const token = (settings.token || "").trim();
  if (!token) throw new Error("Missing sync token.");

  const forceFull = opts.forceFull === true;
  const cursorFrom = forceFull ? 0 : await getLastServerSyncV3Cursor();

  const [ownPlayerId, ownPlayerName] = await Promise.all([getCurrentPlayerId(), getCurrentPlayerName()]);
  const ownCountry = ownPlayerId ? await fetchOwnCountryCode(ownPlayerId) : null;

  // Load details records newer than the cursor (only duels/teamduels have details)
  const allDetails = await db.details
    .where("fetchedAt")
    .above(cursorFrom)
    .toArray() as any[];

  const okDetails = allDetails.filter(
    (d: any) => d?.status === "ok" && (d?.modeFamily === "duels" || d?.modeFamily === "teamduels")
  );

  const gameIds = okDetails.map((d: any) => String(d.gameId));

  // Load playedAt from feed games table
  const feedGames = gameIds.length > 0 ? await db.games.where("gameId").anyOf(gameIds).toArray() : [];
  const playedAtByGameId = new Map<string, number>();
  for (const g of feedGames) {
    if (typeof g.playedAt === "number") playedAtByGameId.set(g.gameId, g.playedAt);
  }

  // Load rounds for those games
  const allRounds = gameIds.length > 0
    ? (await db.rounds.where("gameId").anyOf(gameIds).toArray() as any[])
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

  if (ownPlayerId) {
    addPlayer(ownPlayerId, ownPlayerName, ownCountry, Date.now());
  }

  const duelGames: any[] = [];
  const tdGames: any[] = [];
  const duelGameIds = new Set<string>();
  const tdGameIds = new Set<string>();

  for (const d of okDetails) {
    const playedAt = playedAtByGameId.get(d.gameId) ?? null;
    const fetchedAt = typeof d.fetchedAt === "number" ? d.fetchedAt : undefined;

    if (d.modeFamily === "duels") {
      addPlayer(d.player_self_id, d.player_self_name, d.player_self_country, fetchedAt);
      addPlayer(d.player_opponent_id, d.player_opponent_name, d.player_opponent_country, fetchedAt);

      const winnerPlayerId =
        d.player_self_victory === true ? (d.player_self_id || null) :
        d.player_self_victory === false ? (d.player_opponent_id || null) : null;

      duelGames.push({
        gameId: d.gameId,
        p1_playerId: d.player_self_id || null,
        p2_playerId: d.player_opponent_id || null,
        mapSlug: d.mapSlug || null,
        mapName: d.mapName || null,
        movementType: d.movementType || null,
        isRated: d.isRated != null ? (d.isRated ? 1 : 0) : null,
        totalRounds: d.totalRounds ?? null,
        winnerPlayerId,
        p1_ratingAfter: n(d.player_self_endRating),
        p1_ratingDelta: rDelta(d.player_self_endRating, d.player_self_startRating),
        p1_movingRatingAfter: n(d.player_self_movingRatingAfter),
        p1_movingRatingDelta: rDelta(d.player_self_movingRatingAfter, d.player_self_movingRatingBefore),
        p1_noMoveRatingAfter: n(d.player_self_noMoveRatingAfter),
        p1_noMoveRatingDelta: rDelta(d.player_self_noMoveRatingAfter, d.player_self_noMoveRatingBefore),
        p1_nmpzRatingAfter: n(d.player_self_nmpzRatingAfter),
        p1_nmpzRatingDelta: rDelta(d.player_self_nmpzRatingAfter, d.player_self_nmpzRatingBefore),
        p2_ratingAfter: n(d.player_opponent_endRating),
        p2_ratingDelta: rDelta(d.player_opponent_endRating, d.player_opponent_startRating),
        p2_movingRatingAfter: n(d.player_opponent_movingRatingAfter),
        p2_movingRatingDelta: rDelta(d.player_opponent_movingRatingAfter, d.player_opponent_movingRatingBefore),
        p2_noMoveRatingAfter: n(d.player_opponent_noMoveRatingAfter),
        p2_noMoveRatingDelta: rDelta(d.player_opponent_noMoveRatingAfter, d.player_opponent_noMoveRatingBefore),
        p2_nmpzRatingAfter: n(d.player_opponent_nmpzRatingAfter),
        p2_nmpzRatingDelta: rDelta(d.player_opponent_nmpzRatingAfter, d.player_opponent_nmpzRatingBefore),
        playedAt,
      });
      duelGameIds.add(d.gameId);
    } else if (d.modeFamily === "teamduels") {
      addPlayer(d.player_self_id, d.player_self_name, d.player_self_country, fetchedAt);
      addPlayer(d.player_mate_id, d.player_mate_name, d.player_mate_country, fetchedAt);
      addPlayer(d.player_opponent_id, d.player_opponent_name, d.player_opponent_country, fetchedAt);
      addPlayer(d.player_opponent_mate_id, d.player_opponent_mate_name, d.player_opponent_mate_country, fetchedAt);

      const winnerTeam =
        d.player_self_victory === true ? "blue" :
        d.player_self_victory === false ? "red" : null;

      tdGames.push({
        gameId: d.gameId,
        p1_playerId: d.player_self_id || null,
        p2_playerId: d.player_mate_id || null,
        p3_playerId: d.player_opponent_id || null,
        p4_playerId: d.player_opponent_mate_id || null,
        mapSlug: d.mapSlug || null,
        mapName: d.mapName || null,
        movementType: d.movementType || null,
        isRated: d.isRated != null ? (d.isRated ? 1 : 0) : null,
        totalRounds: d.totalRounds ?? null,
        winnerTeam,
        p1_ratingAfter: n(d.player_self_endRating),
        p1_ratingDelta: rDelta(d.player_self_endRating, d.player_self_startRating),
        p2_ratingAfter: n(d.player_mate_endRating),
        p2_ratingDelta: rDelta(d.player_mate_endRating, d.player_mate_startRating),
        p3_ratingAfter: n(d.player_opponent_endRating),
        p3_ratingDelta: rDelta(d.player_opponent_endRating, d.player_opponent_startRating),
        p4_ratingAfter: n(d.player_opponent_mate_endRating),
        p4_ratingDelta: rDelta(d.player_opponent_mate_endRating, d.player_opponent_mate_startRating),
        playedAt,
      });
      tdGameIds.add(d.gameId);
    }
  }

  // Build round arrays
  const duelRounds: any[] = [];
  const tdRounds: any[] = [];

  for (const r of allRounds) {
    const playedAt = playedAtByGameId.get(r.gameId) ?? null;
    if (duelGameIds.has(r.gameId)) {
      duelRounds.push({
        gameId: r.gameId,
        roundNumber: r.roundNumber,
        trueLat: n(r.trueLat),
        trueLng: n(r.trueLng),
        trueCountry: uc(r.trueCountry),
        trueHeading: n(r.trueHeadingDeg),
        startTime: n(r.startTime),
        durationSec: n(r.durationSeconds),
        isHealingRound: b(r.isHealingRound),
        damageMultiplier: n(r.damageMultiplier),
        p1_lat: n(r.player_self_guessLat),
        p1_lng: n(r.player_self_guessLng),
        p1_country: uc(r.player_self_guessCountry),
        p1_score: n(r.player_self_score),
        p1_distanceKm: n(r.player_self_distanceKm),
        p1_timeSec: null,
        p1_timedOut: 0,
        p1_healthAfter: n(r.player_self_healthAfter),
        p1_isBestGuess: 0,
        p2_lat: n(r.player_opponent_guessLat),
        p2_lng: n(r.player_opponent_guessLng),
        p2_country: uc(r.player_opponent_guessCountry),
        p2_score: n(r.player_opponent_score),
        p2_distanceKm: n(r.player_opponent_distanceKm),
        p2_healthAfter: n(r.player_opponent_healthAfter),
        p2_isBestGuess: 0,
        playedAt,
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
        durationSec: n(r.durationSeconds),
        isHealingRound: b(r.isHealingRound),
        damageMultiplier: n(r.damageMultiplier),
        p1_lat: n(r.player_self_guessLat),
        p1_lng: n(r.player_self_guessLng),
        p1_country: uc(r.player_self_guessCountry),
        p1_score: n(r.player_self_score),
        p1_distanceKm: n(r.player_self_distanceKm),
        p1_timeSec: null,
        p1_isBestGuess: b(r.player_self_isBestGuess),
        p2_lat: n(r.player_mate_guessLat),
        p2_lng: n(r.player_mate_guessLng),
        p2_country: uc(r.player_mate_guessCountry),
        p2_score: n(r.player_mate_score),
        p2_distanceKm: n(r.player_mate_distanceKm),
        p3_lat: n(r.player_opponent_guessLat),
        p3_lng: n(r.player_opponent_guessLng),
        p3_country: uc(r.player_opponent_guessCountry),
        p3_score: n(r.player_opponent_score),
        p3_distanceKm: n(r.player_opponent_distanceKm),
        p4_lat: n(r.player_opponent_mate_guessLat),
        p4_lng: n(r.player_opponent_mate_guessLng),
        p4_country: uc(r.player_opponent_mate_guessCountry),
        p4_score: n(r.player_opponent_mate_score),
        p4_distanceKm: n(r.player_opponent_mate_distanceKm),
        blue_healthAfter: n(r.team_self_healthAfter),
        red_healthAfter: n(r.team_opponent_healthAfter),
        playedAt,
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
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    ...(getUserscriptVersion() ? { "X-GA-Script-Version": String(getUserscriptVersion()) } : {}),
  };

  const res = await gmPostJson(endpointUrl, jsonBody, headers);
  const httpOk = res.status >= 200 && res.status < 300;

  const parsed = (() => {
    try { return JSON.parse(res.text); } catch { return null; }
  })();

  if (httpOk) {
    const maxFetchedAt = okDetails.reduce((m: number, d: any) => Math.max(m, Number(d.fetchedAt) || 0), 0);
    if (maxFetchedAt > 0) {
      await db.meta.put({
        key: SYNC_META_KEY_V3,
        value: { cursorFrom, cursorTo: maxFetchedAt, lastSyncAt: Date.now() },
        updatedAt: Date.now(),
      });
    }
  }

  const serverCounts = parsed?.counts ?? null;
  return {
    ok: httpOk,
    status: res.status,
    responseText: res.text,
    counts: serverCounts ?? {
      players: players.length,
      duel_games: duelGames.length,
      duel_rounds: duelRounds.length,
      team_duel_games: tdGames.length,
      team_duel_rounds: tdRounds.length,
    },
    bytesJson: jsonBody.length,
  };
}
