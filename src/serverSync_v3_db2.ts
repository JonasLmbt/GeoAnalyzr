/**
 * V3 server sync reading from the sync-only IndexedDB (db_v2).
 *
 * Sends all 7 tables (players, standard_games, standard_rounds,
 * duel_games, duel_rounds, team_duel_games, team_duel_rounds)
 * sequentially in batches to /api/v3/sync.
 */
import { dbV2, GameRow, RoundRow, ClassicGameRow, ClassicRoundRow, PlayerProfileCache, getSyncState, setSyncState } from "./db_v2";
import { loadServerSyncSettings } from "./serverSync";
import { getCurrentPlayerId, getCurrentPlayerName } from "./app/playerIdentity";
import { deriveV3SyncUrl } from "./serverSync_v3";
import { getGmXmlhttpRequest } from "./gm";
import { httpGetJson } from "./http";

const CURSOR_KEY_DUELS    = "server_sync_v3";
const CURSOR_KEY_STANDARD = "server_sync_v3_standard";
const BATCH_SIZE = 500;

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
  const info = (globalThis as any)?.GM_info?.script;
  const v = info?.version;
  if (typeof v !== "string") return undefined;
  const ns = String(info?.namespace || "");
  const variant = ns === "geoanalyzr-sync" ? "sync" : ns === "geoanalyzr-dev" ? "dev" : "full";
  return `${v} (${variant})`;
}

const PROFILE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const PROFILE_CONCURRENCY = 5;

async function fetchPlayerProfiles(playerIds: string[]): Promise<Map<string, PlayerProfileCache>> {
  const now = Date.now();
  const cached = await dbV2.playerProfiles.where("playerId").anyOf(playerIds).toArray();
  const map = new Map<string, PlayerProfileCache>(cached.map(p => [p.playerId, p]));

  const toFetch = playerIds.filter(id => {
    const c = map.get(id);
    // Re-fetch if missing, stale, or cached with no rating (from old broken /profiles/ endpoint)
    if (!c) return true;
    if ((now - c.fetchedAt) > PROFILE_CACHE_TTL_MS) return true;
    if (c.currentRating == null && (now - c.fetchedAt) > 60_000) return true;
    return false;
  });

  for (let i = 0; i < toFetch.length; i += PROFILE_CONCURRENCY) {
    await Promise.all(toFetch.slice(i, i + PROFILE_CONCURRENCY).map(async (playerId) => {
      try {
        const res = await httpGetJson(`https://www.geoguessr.com/api/v3/users/${encodeURIComponent(playerId)}`);
        console.log("[v3sync] profile response", playerId, res.status, res.data);
        if (res.status >= 200 && res.status < 300) {
          const d = res.data as any;
          const user = d?.user ?? d;
          const comp = user?.competitive ?? user?.competitiveStats ?? null;
          const profile: PlayerProfileCache = {
            playerId,
            fetchedAt: now,
            currentRating: typeof comp?.rating === "number" ? comp.rating : undefined,
            currentDivision: comp?.division?.type ?? comp?.divisionType ?? undefined,
            currentLevel: typeof user?.progress?.level === "number" ? user.progress.level
                        : typeof user?.level === "number" ? user.level : undefined,
            geoCreatedAt: user?.created ? new Date(user.created).getTime()
                        : user?.createdAt ? new Date(user.createdAt).getTime() : undefined,
            isBanned: user?.isBanned === true || user?.banned === true,
            clubTag: user?.club?.tag ?? user?.clubTag ?? null,
            streakProgress: user?.streakProgress ?? null,
          };
          console.log("[v3sync] parsed profile", playerId, profile);
          await dbV2.playerProfiles.put(profile);
          map.set(playerId, profile);
        } else {
          console.warn("[v3sync] profile fetch non-2xx", playerId, res.status, res.text);
        }
      } catch (e) { console.warn("[v3sync] profile fetch failed for", playerId, e); }
    }));
  }
  return map;
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
    standard_games: number;
    standard_rounds: number;
    duel_games: number;
    duel_rounds: number;
    team_duel_games: number;
    team_duel_rounds: number;
  };
}

async function postBatch(url: string, token: string, payload: Record<string, any[]>): Promise<void> {
  const body = JSON.stringify({
    schema: "geoanalyzr-v3-sync",
    schemaVersion: 1,
    createdAt: Date.now(),
    appVersion: getUserscriptVersion(),
    ...payload,
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt));
    const res = await gmPost(url, body, token);
    if (res.status >= 200 && res.status < 300) return;
    if (res.status === 502 || res.status === 503 || res.status === 0) continue; // retry
    const parsed = (() => { try { return JSON.parse(res.text); } catch { return null; } })();
    throw new Error(parsed?.error ?? `HTTP ${res.status}`);
  }
  throw new Error("HTTP 502 (after retries)");
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function syncV3FromDb2(opts: {
  forceFull?: boolean;
  gameIds?: string[];
} = {}): Promise<SyncV3Db2Result> {
  const settings = loadServerSyncSettings();
  if (!settings.token) { console.warn("[v3sync] no_token"); return { ok: false, error: "no_token" }; }

  const url = deriveV3SyncUrl(settings.endpointUrl);
  if (!url) { console.warn("[v3sync] no_endpoint"); return { ok: false, error: "no_endpoint" }; }

  console.log("[v3sync] starting", { url, forceFull: opts.forceFull });
  const forceFull = opts.forceFull === true;

  const [ownPlayerId, ownPlayerName] = await Promise.all([getCurrentPlayerId(), getCurrentPlayerName()]);
  const ownCountry = ownPlayerId ? await fetchOwnCountryCode(ownPlayerId) : null;

  const totalCounts = {
    players: 0, standard_games: 0, standard_rounds: 0,
    duel_games: 0, duel_rounds: 0, team_duel_games: 0, team_duel_rounds: 0,
  };

  // ── Players ────────────────────────────────────────────────────────────────

  type PlayerEntry = { playerId: string; playerName: string | null; countryCode: string | null; firstSeenAt: number | null; lastSeenAt: number | null };
  const playerMap = new Map<string, PlayerEntry>();
  const addPlayer = (id: unknown, name: unknown, country: unknown, playedAt?: number) => {
    if (typeof id !== "string" || !id) return;
    const cc = typeof country === "string" && country.trim() ? country.trim().toUpperCase() : null;
    const nm = typeof name === "string" && name.trim() ? name.trim() : null;
    const existing = playerMap.get(id);
    if (!existing) {
      playerMap.set(id, { playerId: id, playerName: nm, countryCode: cc, firstSeenAt: playedAt ?? null, lastSeenAt: playedAt ?? null });
    } else {
      if (nm && !existing.playerName) existing.playerName = nm;
      if (cc && !existing.countryCode) existing.countryCode = cc;
      if (playedAt) {
        if (!existing.firstSeenAt || playedAt < existing.firstSeenAt) existing.firstSeenAt = playedAt;
        if (!existing.lastSeenAt || playedAt > existing.lastSeenAt) existing.lastSeenAt = playedAt;
      }
    }
  };

  if (ownPlayerId) addPlayer(ownPlayerId, ownPlayerName, ownCountry);

  // ── Standard games ─────────────────────────────────────────────────────────

  const stdCursorFrom: number = forceFull ? 0 : ((await getSyncState<number>(CURSOR_KEY_STANDARD)) ?? 0);
  let classicGames: ClassicGameRow[];
  if (opts.gameIds && !forceFull) {
    const idSet = new Set(opts.gameIds);
    classicGames = await dbV2.classicGames
      .filter((g) => idSet.has(g.gameId) && g.detailFetchedAt != null)
      .toArray();
  } else {
    classicGames = await dbV2.classicGames
      .filter((g) => g.detailFetchedAt != null && (forceFull || (g.detailFetchedAt! > stdCursorFrom)))
      .toArray();
  }

  // ── Duels & Teamduels ──────────────────────────────────────────────────────

  const duelCursorFrom: number = forceFull ? 0 : ((await getSyncState<number>(CURSOR_KEY_DUELS)) ?? 0);
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
        (forceFull || (g.detailFetchedAt! > duelCursorFrom))
      )
      .toArray();
  }

  const duelGameRows: any[] = [];
  const tdGameRows: any[] = [];
  const duelGameIds = new Set<string>();
  const tdGameIds = new Set<string>();

  for (const g of classicGames) {
    if (ownPlayerId) addPlayer(ownPlayerId, ownPlayerName, ownCountry, g.playedAt);
  }

  for (const g of games) {
    const pat = g.playedAt ?? undefined;
    if (g.modeFamily === "duels") {
      addPlayer(g.p1Id, g.p1Name, g.p1Country, pat);
      addPlayer(g.p2Id, g.p2Name, g.p2Country, pat);
      const winnerPlayerId = g.winnerTeamIdx === 0 ? (g.p1Id ?? null)
                           : g.winnerTeamIdx === 1 ? (g.p2Id ?? null)
                           : null;
      duelGameRows.push({
        gameId: g.gameId,
        p1_playerId: g.p1Id ?? null,
        p2_playerId: g.p2Id ?? null,
        mapSlug: g.mapSlug ?? null,
        mapName: g.mapName ?? null,
        movementType: g.movementType ?? null,
        isRated: g.isRated != null ? (g.isRated ? 1 : 0) : null,
        totalRounds: g.totalRounds ?? null,
        winnerPlayerId,
        winnerStyle: g.winnerStyle ?? null,
        initialHealth: n(g.initialHealth),
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
      addPlayer(g.p1Id, g.p1Name, g.p1Country, pat);
      addPlayer(g.p2Id, g.p2Name, g.p2Country, pat);
      addPlayer(g.p3Id, g.p3Name, g.p3Country, pat);
      addPlayer(g.p4Id, g.p4Name, g.p4Country, pat);
      const winnerTeam = g.winnerTeamIdx === 0 ? "blue" : g.winnerTeamIdx === 1 ? "red" : null;
      tdGameRows.push({
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
        initialHealth: n(g.initialHealth),
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

  // Load rounds for duels/teamduels
  const allDuelTdIds = [...duelGameIds, ...tdGameIds];
  const rounds: RoundRow[] = allDuelTdIds.length > 0
    ? await dbV2.rounds.where("gameId").anyOf(allDuelTdIds).toArray()
    : [];

  const duelRoundRows: any[] = [];
  const tdRoundRows: any[] = [];
  for (const r of rounds) {
    if (duelGameIds.has(r.gameId)) {
      duelRoundRows.push({
        gameId: r.gameId,
        roundNumber: r.roundNumber,
        panoId: r.panoId ?? null,
        trueLat: n(r.trueLat),
        trueLng: n(r.trueLng),
        trueCountry: uc(r.trueCountry),
        trueHeading: n(r.trueHeadingDeg),
        truePitch: n(r.truePitch),
        trueZoom: n(r.trueZoom),
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
        p1_healthBefore: n(r.team0HealthBefore),
        p1_healthAfter: n(r.team0HealthAfter),
        p1_damageDealt: n(r.team0DamageDealt),
        p1_isBestGuess: 0,
        p2_lat: n(r.p2Lat),
        p2_lng: n(r.p2Lng),
        p2_country: uc(r.p2Country),
        p2_score: n(r.p2Score),
        p2_distanceKm: n(r.p2Distance),
        p2_timeSec: n(r.p2TimeSec),
        p2_timedOut: r.p2TimedOut ? 1 : 0,
        p2_healthBefore: n(r.team1HealthBefore),
        p2_healthAfter: n(r.team1HealthAfter),
        p2_damageDealt: n(r.team1DamageDealt),
        p2_isBestGuess: 0,
        playedAt: r.startTime ?? null,
      });
    } else if (tdGameIds.has(r.gameId)) {
      tdRoundRows.push({
        gameId: r.gameId,
        roundNumber: r.roundNumber,
        panoId: r.panoId ?? null,
        trueLat: n(r.trueLat),
        trueLng: n(r.trueLng),
        trueCountry: uc(r.trueCountry),
        trueHeading: n(r.trueHeadingDeg),
        truePitch: n(r.truePitch),
        trueZoom: n(r.trueZoom),
        startTime: n(r.startTime),
        durationSec: n(r.durationSec),
        isHealingRound: r.isHealing ? 1 : null,
        damageMultiplier: n(r.damageMultiplier),
        p1_lat: n(r.p1Lat),
        p1_lng: n(r.p1Lng),
        p1_country: uc(r.p1Country),
        p1_score: n(r.p1Score),
        p1_distanceKm: n(r.p1Distance),
        p1_timeSec: n(r.p1TimeSec),
        p1_timedOut: r.p1TimedOut ? 1 : 0,
        p1_isBestGuess: r.p1IsBetterGuess ? 1 : 0,
        p2_lat: n(r.p2Lat),
        p2_lng: n(r.p2Lng),
        p2_country: uc(r.p2Country),
        p2_score: n(r.p2Score),
        p2_distanceKm: n(r.p2Distance),
        p2_timeSec: n(r.p2TimeSec),
        p2_timedOut: r.p2TimedOut ? 1 : 0,
        p2_isBestGuess: r.p2IsBetterGuess ? 1 : 0,
        p3_lat: n(r.p3Lat),
        p3_lng: n(r.p3Lng),
        p3_country: uc(r.p3Country),
        p3_score: n(r.p3Score),
        p3_distanceKm: n(r.p3Distance),
        p3_timeSec: n(r.p3TimeSec),
        p3_timedOut: r.p3TimedOut ? 1 : 0,
        p3_isBestGuess: r.p3IsBetterGuess ? 1 : 0,
        p4_lat: n(r.p4Lat),
        p4_lng: n(r.p4Lng),
        p4_country: uc(r.p4Country),
        p4_score: n(r.p4Score),
        p4_distanceKm: n(r.p4Distance),
        p4_timeSec: n(r.p4TimeSec),
        p4_timedOut: r.p4TimedOut ? 1 : 0,
        p4_isBestGuess: r.p4IsBetterGuess ? 1 : 0,
        blue_healthBefore: n(r.team0HealthBefore),
        blue_healthAfter: n(r.team0HealthAfter),
        blue_damageDealt: n(r.team0DamageDealt),
        red_healthBefore: n(r.team1HealthBefore),
        red_healthAfter: n(r.team1HealthAfter),
        red_damageDealt: n(r.team1DamageDealt),
        playedAt: r.startTime ?? null,
      });
    }
  }

  // ── Send sequentially: std_games → std_rounds → players → duel_games → duel_rounds → td_games → td_rounds

  try {
    // Standard games & rounds (moved into try so auth errors don't abort before duel data)
    if (ownPlayerId) {
      const stdGameRows: any[] = classicGames.map((g) => ({
        gameId: g.gameId, p1_playerId: ownPlayerId, mapSlug: g.mapId ?? null, mapName: g.mapName ?? null,
        movementType: g.movement ?? "moving", timeLimit: g.timeLimit ?? null, roundCount: g.roundCount ?? null,
        totalScore: g.totalScore ?? null, totalDistanceKm: g.totalDistanceM != null ? g.totalDistanceM / 1000 : null,
        totalTimeSec: g.totalTimeSec ?? null, totalSteps: g.totalSteps ?? null, playedAt: g.playedAt ?? null,
      }));
      console.log("[v3sync] standard_games", stdGameRows.length);
      for (const batch of chunk(stdGameRows, BATCH_SIZE)) {
        await postBatch(url, settings.token, { standard_games: batch });
        totalCounts.standard_games += batch.length;
      }
      if (classicGames.length > 0) {
        const stdGameIds = classicGames.map((g) => g.gameId);
        const classicRounds: ClassicRoundRow[] = await dbV2.classicRounds.where("gameId").anyOf(stdGameIds).toArray();
        const stdRoundRows: any[] = classicRounds.map((r) => ({
          gameId: r.gameId, roundNumber: r.roundNumber, panoId: r.panoId ?? null,
          trueLat: n(r.trueLat), trueLng: n(r.trueLng), trueCountry: uc(r.trueCountry), trueHeading: n(r.trueHeadingDeg),
          truePitch: n(r.truePitch), trueZoom: n(r.trueZoom), p1_lat: n(r.selfLat), p1_lng: n(r.selfLng), p1_country: uc(r.selfCountry),
          p1_score: n(r.selfScore), p1_distanceKm: n(r.selfDistance), p1_timeSec: n(r.selfTimeSec), p1_steps: n(r.selfSteps),
          timedOut: r.timedOut ? 1 : 0, skippedRound: r.skippedRound ? 1 : 0, playedAt: r.playedAt ?? null,
        }));
        console.log("[v3sync] standard_rounds", stdRoundRows.length);
        for (const batch of chunk(stdRoundRows, BATCH_SIZE)) {
          await postBatch(url, settings.token, { standard_rounds: batch });
          totalCounts.standard_rounds += batch.length;
        }
      }
    }

    // Fetch own profile only here; opponent profiles are handled in syncPlayerProfiles()
    const profileIds = ownPlayerId ? [ownPlayerId] : [];
    const profileMap = await fetchPlayerProfiles(profileIds);
    for (const [playerId, entry] of playerMap) {
      const p = profileMap.get(playerId);
      if (!p) continue;
      (entry as any).currentRating    = p.currentRating    ?? null;
      (entry as any).currentDivision  = p.currentDivision  ?? null;
      (entry as any).currentLevel     = p.currentLevel     ?? null;
      (entry as any).geoCreatedAt     = p.geoCreatedAt     ?? null;
      (entry as any).isBanned         = p.isBanned ? 1 : 0;
      (entry as any).clubTag          = p.clubTag          ?? null;
      (entry as any).streakProgress   = p.streakProgress   != null ? JSON.stringify(p.streakProgress) : null;
      (entry as any).profileFetchedAt = p.fetchedAt;
    }

    // Players (always send, even if empty, to update lastSyncedAt)
    const players = Array.from(playerMap.values());
    console.log("[v3sync] players", players.length, "duel_games", duelGameRows.length, "duel_rounds", duelRoundRows.length, "td_games", tdGameRows.length, "td_rounds", tdRoundRows.length);
    for (const batch of chunk(players.length > 0 ? players : [], BATCH_SIZE)) {
      await postBatch(url, settings.token, { players: batch });
      totalCounts.players += batch.length;
    }
    // Send empty player ping if no players but we still want server to register the sync
    if (players.length === 0) {
      await postBatch(url, settings.token, { players: [] });
    }

    for (const batch of chunk(duelGameRows, BATCH_SIZE)) {
      await postBatch(url, settings.token, { duel_games: batch });
      totalCounts.duel_games += batch.length;
    }
    for (const batch of chunk(duelRoundRows, BATCH_SIZE)) {
      await postBatch(url, settings.token, { duel_rounds: batch });
      totalCounts.duel_rounds += batch.length;
    }
    for (const batch of chunk(tdGameRows, BATCH_SIZE)) {
      await postBatch(url, settings.token, { team_duel_games: batch });
      totalCounts.team_duel_games += batch.length;
    }
    for (const batch of chunk(tdRoundRows, BATCH_SIZE)) {
      await postBatch(url, settings.token, { team_duel_rounds: batch });
      totalCounts.team_duel_rounds += batch.length;
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // Advance cursors
  const maxDuelFetchedAt = games.reduce((m, g) => Math.max(m, g.detailFetchedAt ?? 0), 0);
  if (maxDuelFetchedAt > 0) await setSyncState(CURSOR_KEY_DUELS, maxDuelFetchedAt);

  const maxStdFetchedAt = classicGames.reduce((m, g) => Math.max(m, g.detailFetchedAt ?? 0), 0);
  if (maxStdFetchedAt > 0) await setSyncState(CURSOR_KEY_STANDARD, maxStdFetchedAt);

  return { ok: true, counts: totalCounts };
}

/**
 * Dedicated phase: fetch GeoGuessr profiles for all players ever seen in local games
 * and push them to the server. Runs up to `batchSize` uncached/stale players per call.
 * Returns how many profiles were fetched and sent.
 */
export async function syncPlayerProfiles(opts: {
  batchSize?: number;
  onProgress?: (msg: string) => void;
} = {}): Promise<{ ok: boolean; fetched: number; sent: number; error?: string }> {
  const settings = loadServerSyncSettings();
  if (!settings.token) return { ok: false, fetched: 0, sent: 0, error: "no_token" };
  const url = deriveV3SyncUrl(settings.endpointUrl);
  if (!url) return { ok: false, fetched: 0, sent: 0, error: "no_endpoint" };

  const batchSize = opts.batchSize ?? 50;
  const now = Date.now();

  // Collect all unique player IDs from all local games
  const allIds = new Set<string>();
  try {
    const allGames = await dbV2.games.toArray();
    for (const g of allGames) {
      if (g.p1Id) allIds.add(g.p1Id);
      if (g.p2Id) allIds.add(g.p2Id);
      if ((g as any).p3Id) allIds.add((g as any).p3Id);
      if ((g as any).p4Id) allIds.add((g as any).p4Id);
    }
  } catch (e) {
    return { ok: false, fetched: 0, sent: 0, error: "db_read_failed" };
  }

  const allPlayerIds = Array.from(allIds);
  // Check which are uncached or stale
  const cached = await dbV2.playerProfiles.where("playerId").anyOf(allPlayerIds).toArray();
  const cachedMap = new Map(cached.map(p => [p.playerId, p]));
  const toFetch = allPlayerIds.filter(id => {
    const c = cachedMap.get(id);
    if (!c) return true;
    if ((now - c.fetchedAt) > PROFILE_CACHE_TTL_MS) return true;
    if (c.currentRating == null && (now - c.fetchedAt) > 60_000) return true;
    return false;
  }).slice(0, batchSize);

  const remaining = allPlayerIds.filter(id => {
    const c = cachedMap.get(id);
    if (!c) return true;
    if ((now - c.fetchedAt) > PROFILE_CACHE_TTL_MS) return true;
    if (c.currentRating == null && (now - c.fetchedAt) > 60_000) return true;
    return false;
  }).length;

  opts.onProgress?.(`Fetching ${toFetch.length} player profiles (${remaining} remaining)...`);

  const profileMap = await fetchPlayerProfiles(toFetch);

  // Build player rows with profile data and send to server
  const playerRows: any[] = [];
  for (const playerId of toFetch) {
    const p = profileMap.get(playerId);
    if (!p) continue;
    playerRows.push({
      playerId,
      playerName: null,
      countryCode: null,
      firstSeenAt: null,
      lastSeenAt: null,
      currentRating:    p.currentRating    ?? null,
      currentDivision:  p.currentDivision  ?? null,
      currentLevel:     p.currentLevel     ?? null,
      geoCreatedAt:     p.geoCreatedAt     ?? null,
      isBanned:         p.isBanned ? 1 : 0,
      clubTag:          p.clubTag          ?? null,
      streakProgress:   p.streakProgress   != null ? JSON.stringify(p.streakProgress) : null,
      profileFetchedAt: p.fetchedAt,
    });
  }

  if (playerRows.length === 0) return { ok: true, fetched: toFetch.length, sent: 0 };

  try {
    for (const batch of chunk(playerRows, BATCH_SIZE)) {
      await postBatch(url, settings.token, { players: batch });
    }
  } catch (e) {
    return { ok: false, fetched: toFetch.length, sent: 0, error: e instanceof Error ? e.message : String(e) };
  }

  return { ok: true, fetched: toFetch.length, sent: playerRows.length };
}
