import { dbV2, GameRow, RoundRow, ModeFamily, MovementType } from "./db_v2";
import { httpGetJsonWithRetry } from "./http";
import { resolveCountryCodeByLatLng } from "./countries";

export interface DetailFetchProgress {
  processed: number;
  total: number;
  succeeded: number;
  failed: number;
}

export interface DetailFetchResult {
  succeeded: number;
  failed: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function asNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asBool(v: unknown): boolean | undefined {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  return undefined;
}

function normalizeIso2(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const x = v.trim().toLowerCase();
  return /^[a-z]{2}$/.test(x) ? x : undefined;
}

function toTs(v: unknown): number | undefined {
  if (typeof v !== "string") return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : undefined;
}

function getByPath(obj: any, path: string): any {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== "object" || !(p in cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

function pickFirst(obj: any, paths: string[]): any {
  for (const p of paths) {
    const v = getByPath(obj, p);
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

function readPlayerId(player: any): string | undefined {
  const v = player?.playerId ?? player?.id ?? player?.userId ?? player?.user?.id;
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function detectMovementType(gameData: any): MovementType | "mixed" | undefined {
  const opts = pickFirst(gameData, [
    "movementOptions",
    "options.movementOptions",
    "options.duelRoundOptions.movementOptions",
  ]);
  if (!opts || typeof opts !== "object") {
    // Solo games store movement as top-level booleans
    const fm = gameData?.forbidMoving;
    const fz = gameData?.forbidZooming;
    const fr = gameData?.forbidRotating;
    if (fm === undefined && fz === undefined && fr === undefined) return undefined;
    if (fm === false && fz === false && fr === false) return "moving";
    if (fm && fz && fr) return "nmpz";
    if (fm) return "no_move";
    return undefined;
  }
  const fm = opts.forbidMoving === true;
  const fz = opts.forbidZooming === true;
  const fr = opts.forbidRotating === true;
  if (!fm && !fz && !fr) return "moving";
  if (fm && fz && fr) return "nmpz";
  if (fm) return "no_move";
  return undefined;
}

function extractRatingChange(player: any): { before?: number; after?: number } {
  const paths = [
    "progressChange.rankedSystemProgress",
    "progressChange.rankedTeamDuelsProgress",
    "progressChange.rankedProgress",
    "progressChange.ratingProgress",
  ];
  for (const p of paths) {
    const obj = getByPath(player, p);
    const before = asNum(obj?.ratingBefore);
    const after = asNum(obj?.ratingAfter);
    if (before !== undefined || after !== undefined) return { before, after };
  }
  return {};
}

async function resolveGuessCountry(
  guess: any,
  lat?: number,
  lng?: number
): Promise<string | undefined> {
  const fromApi = normalizeIso2(
    guess?.countryCode ?? guess?.country_code ?? guess?.country
  );
  if (fromApi) return fromApi;
  return resolveCountryCodeByLatLng(lat, lng).catch(() => undefined);
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

function buildEndpoints(gameId: string, modeFamily: ModeFamily): string[] {
  const gameServer = `https://game-server.geoguessr.com/api/duels/${gameId}`;
  const duelsEndpoints = [
    gameServer,
    `https://www.geoguessr.com/api/duels/${gameId}`,
    `https://www.geoguessr.com/api/v4/competitive-games/${gameId}`,
  ];
  const teamDuelsEndpoints = [
    gameServer,
    `https://www.geoguessr.com/api/team-duels/${gameId}`,
    `https://www.geoguessr.com/api/v4/competitive-games/${gameId}`,
  ];
  const soloEndpoints = [
    `https://www.geoguessr.com/api/v3/games/${gameId}`,
    `https://www.geoguessr.com/api/v4/games/${gameId}`,
  ];

  switch (modeFamily) {
    case "teamduels":
      return [...teamDuelsEndpoints, ...duelsEndpoints, ...soloEndpoints];
    case "duels":
      return [...duelsEndpoints, ...teamDuelsEndpoints, ...soloEndpoints];
    default:
      return [...soloEndpoints, ...duelsEndpoints];
  }
}

async function tryFetch(
  gameId: string,
  endpoints: string[]
): Promise<{ data: any; endpoint: string } | null> {
  for (const endpoint of endpoints) {
    try {
      const res = await httpGetJsonWithRetry(endpoint, {
        retries: 4,
        baseDelayMs: 600,
        maxDelayMs: 15000,
      });
      if (res.status >= 200 && res.status < 300 && res.data) {
        return { data: res.data, endpoint };
      }
      if (res.status === 404) continue; // try next endpoint
    } catch {
      // try next
    }
  }
  return null;
}

// ─── Duels / TeamDuels normalization ─────────────────────────────────────────

function guessByRound(player: any): Map<number, any> {
  const map = new Map<number, any>();
  for (const g of Array.isArray(player?.guesses) ? player.guesses : []) {
    const rn = asNum(g?.roundNumber);
    if (rn !== undefined) map.set(rn, g);
  }
  return map;
}

function healthByRound(team: any): Map<number, number> {
  const map = new Map<number, number>();
  for (const r of Array.isArray(team?.roundResults) ? team.roundResults : []) {
    const rn = asNum(r?.roundNumber);
    const h = asNum(r?.healthAfter);
    if (rn !== undefined && h !== undefined) map.set(rn, h);
  }
  return map;
}

/**
 * Order teams/players so self is first. Returns up to 4 player slots:
 * [self, mate?, opp, oppMate?]
 */
function orderedPlayers(
  gameData: any,
  selfId?: string
): Array<{ player: any; healthMap: Map<number, number> }> {
  const teams: any[] = Array.isArray(gameData?.teams) ? gameData.teams : [];
  if (teams.length === 0) return [];

  let ownTeamIndex = 0;
  if (selfId) {
    const found = teams.findIndex(
      (t: any) =>
        Array.isArray(t?.players) &&
        t.players.some((p: any) => readPlayerId(p) === selfId)
    );
    if (found >= 0) ownTeamIndex = found;
  }

  const ownTeam = teams[ownTeamIndex];
  const otherTeams = teams.filter((_: any, i: number) => i !== ownTeamIndex);

  const ownPlayers: any[] = Array.isArray(ownTeam?.players) ? [...ownTeam.players] : [];
  const ownHealth = healthByRound(ownTeam);

  // Put self first within own team
  if (selfId) {
    ownPlayers.sort((a: any, b: any) => {
      if (readPlayerId(a) === selfId) return -1;
      if (readPlayerId(b) === selfId) return 1;
      return 0;
    });
  }

  const result: Array<{ player: any; healthMap: Map<number, number> }> = [];
  for (const p of ownPlayers) result.push({ player: p, healthMap: ownHealth });
  for (const t of otherTeams) {
    const h = healthByRound(t);
    for (const p of Array.isArray(t?.players) ? t.players : []) {
      result.push({ player: p, healthMap: h });
    }
  }

  return result.slice(0, 4);
}

async function normalizeDuelsRounds(
  gameId: string,
  gameData: any,
  selfId?: string
): Promise<RoundRow[]> {
  const rounds: any[] = Array.isArray(gameData?.rounds) ? gameData.rounds : [];
  const players = orderedPlayers(gameData, selfId);
  const guessMaps = players.map((x) => guessByRound(x.player));

  const roles = [
    "self",
    "mate",
    "opp",
    "oppMate",
  ] as const;

  const result: RoundRow[] = [];

  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    const rn = asNum(r?.roundNumber) ?? i + 1;
    const startTs = toTs(r?.startTime);
    const endTs = toTs(r?.endTime);

    // Skip rounds with no timestamp AND no guesses (unplayed/future rounds)
    const hasAnyGuess = guessMaps.some((m) => m.has(rn));
    if (startTs === undefined && endTs === undefined && !hasAnyGuess) continue;

    const durationSec =
      startTs !== undefined && endTs !== undefined && endTs >= startTs
        ? (endTs - startTs) / 1000
        : undefined;

    const trueLat = asNum(r?.panorama?.lat);
    const trueLng = asNum(r?.panorama?.lng);
    const trueCountry = normalizeIso2(r?.panorama?.countryCode);

    // Build per-player guess data
    const guessData: Array<{
      lat?: number;
      lng?: number;
      country?: string;
      score?: number;
      distanceKm?: number;
      healthAfter?: number;
    }> = [];

    for (let p = 0; p < 4; p++) {
      const entry = players[p];
      if (!entry) {
        guessData.push({});
        continue;
      }
      const guess = guessMaps[p].get(rn);
      const guessLat = asNum(guess?.lat ?? guess?.latitude);
      const guessLng = asNum(guess?.lng ?? guess?.lon ?? guess?.longitude);
      const distanceMeters = asNum(guess?.distance ?? guess?.distanceInMeters);
      const guessCountry = await resolveGuessCountry(guess, guessLat, guessLng);
      guessData.push({
        lat: guessLat,
        lng: guessLng,
        country: guessCountry,
        score: asNum(guess?.score),
        distanceKm: distanceMeters !== undefined ? distanceMeters / 1e3 : undefined,
        healthAfter: entry.healthMap.get(rn),
      });
    }

    const [self, mate, opp, oppMate] = guessData;

    const row: RoundRow = {
      gameId,
      roundNumber: rn,
      startTime: startTs,
      durationSec,
      trueLat,
      trueLng,
      trueCountry,
      selfGuessLat: self.lat,
      selfGuessLng: self.lng,
      selfGuessCountry: self.country,
      selfScore: self.score,
      selfDistanceKm: self.distanceKm,
      selfHealthAfter: self.healthAfter,
      oppGuessLat: opp.lat,
      oppGuessLng: opp.lng,
      oppGuessCountry: opp.country,
      oppScore: opp.score,
      oppDistanceKm: opp.distanceKm,
      oppHealthAfter: opp.healthAfter,
      mateGuessLat: mate.lat,
      mateGuessLng: mate.lng,
      mateGuessCountry: mate.country,
      mateScore: mate.score,
      mateDistanceKm: mate.distanceKm,
      oppMateGuessLat: oppMate.lat,
      oppMateGuessLng: oppMate.lng,
      oppMateGuessCountry: oppMate.country,
      oppMateScore: oppMate.score,
      oppMateDistanceKm: oppMate.distanceKm,
    };

    // Strip undefined fields
    for (const k of Object.keys(row) as (keyof RoundRow)[]) {
      if (row[k] === undefined) delete row[k];
    }

    result.push(row);
  }

  return result;
}

async function normalizeSoloRounds(
  gameId: string,
  gameData: any
): Promise<RoundRow[]> {
  const rounds: any[] = Array.isArray(gameData?.rounds) ? gameData.rounds : [];
  const playerGuesses: any[] = Array.isArray(gameData?.player?.guesses)
    ? gameData.player.guesses
    : [];

  // Index guesses by roundNumber
  const guessMap = new Map<number, any>();
  for (const g of playerGuesses) {
    const rn = asNum(g?.roundNumber);
    if (rn !== undefined) guessMap.set(rn, g);
  }

  const result: RoundRow[] = [];

  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    const rn = asNum(r?.roundNumber) ?? i + 1;
    const startTs = toTs(r?.startTime);
    const endTs = toTs(r?.endTime);
    const guess = guessMap.get(rn);

    if (startTs === undefined && endTs === undefined && !guess) continue;

    const durationSec =
      startTs !== undefined && endTs !== undefined && endTs >= startTs
        ? (endTs - startTs) / 1000
        : asNum(r?.roundDuration);

    const trueLat = asNum(r?.lat ?? r?.latitude);
    const trueLng = asNum(r?.lng ?? r?.longitude);
    const trueCountry = normalizeIso2(r?.streakLocationCode ?? r?.countryCode);

    const guessLat = asNum(guess?.lat ?? guess?.latitude);
    const guessLng = asNum(guess?.lng ?? guess?.longitude);
    const distanceMeters = asNum(guess?.distanceInMeters ?? guess?.distance);
    const guessCountry = await resolveGuessCountry(guess, guessLat, guessLng);

    const row: RoundRow = {
      gameId,
      roundNumber: rn,
      startTime: startTs,
      durationSec,
      trueLat,
      trueLng,
      trueCountry,
      selfGuessLat: guessLat,
      selfGuessLng: guessLng,
      selfGuessCountry: guessCountry,
      selfScore: asNum(guess?.roundScore?.amount ?? guess?.score),
      selfDistanceKm: distanceMeters !== undefined ? distanceMeters / 1e3 : undefined,
    };

    for (const k of Object.keys(row) as (keyof RoundRow)[]) {
      if (row[k] === undefined) delete row[k];
    }

    result.push(row);
  }

  return result;
}

// ─── Game-level field extraction ──────────────────────────────────────────────

function extractGameUpdates(
  gameData: any,
  modeFamily: ModeFamily,
  selfId?: string
): Partial<GameRow> {
  const isDuelType = modeFamily === "duels" || modeFamily === "teamduels";
  const mapName: string | undefined =
    typeof gameData?.options?.map?.name === "string" ? gameData.options.map.name :
    typeof gameData?.map?.name === "string" ? gameData.map.name : undefined;
  const mapSlug: string | undefined =
    typeof gameData?.options?.map?.slug === "string" ? gameData.options.map.slug :
    typeof gameData?.map?.slug === "string" ? gameData.map.slug : undefined;
  const isRated = asBool(gameData?.options?.isRated ?? gameData?.isRated);
  const rounds: any[] = Array.isArray(gameData?.rounds) ? gameData.rounds : [];
  const totalRounds = asNum(gameData?.currentRoundNumber) ?? (rounds.length || undefined);
  const movementType = detectMovementType(gameData);

  const updates: Partial<GameRow> = {
    detailFetchedAt: Date.now(),
    mapName,
    mapSlug,
    isRated,
    totalRounds,
    movementType: movementType ?? undefined,
  };

  if (isDuelType) {
    const teams: any[] = Array.isArray(gameData?.teams) ? gameData.teams : [];
    const winningTeamId = String(gameData?.result?.winningTeamId || "");
    const players = orderedPlayers(gameData, selfId);
    const p = [0, 1, 2, 3].map((i) => players[i]?.player);

    const p0Id = readPlayerId(p[0]) ?? selfId;
    const p1Id = readPlayerId(p[1]);
    const p2Id = readPlayerId(p[2]);
    const p3Id = readPlayerId(p[3]);

    const rc = p.map(extractRatingChange);

    let ownTeamIndex = 0;
    if (selfId) {
      const found = teams.findIndex(
        (t: any) =>
          Array.isArray(t?.players) &&
          t.players.some((pl: any) => readPlayerId(pl) === selfId)
      );
      if (found >= 0) ownTeamIndex = found;
    }
    const ownTeam = teams[ownTeamIndex];
    const otherTeam = teams.find((_: any, i: number) => i !== ownTeamIndex) ?? teams[1];
    const selfVictory = winningTeamId
      ? String(ownTeam?.id || "") === winningTeamId
      : undefined;
    const selfScore = asNum(ownTeam?.health);

    Object.assign(updates, {
      selfId: p0Id,
      selfName: typeof p[0]?.nick === "string" ? p[0].nick : undefined,
      selfScore,
      selfVictory,
      selfRatingBefore: rc[0].before,
      selfRatingAfter: rc[0].after,
      oppId: p2Id,
      oppName: typeof p[2]?.nick === "string" ? p[2].nick : undefined,
      oppRatingBefore: rc[2].before,
      oppRatingAfter: rc[2].after,
      mateId: p1Id,
      mateName: typeof p[1]?.nick === "string" ? p[1].nick : undefined,
      mateRatingBefore: rc[1].before,
      mateRatingAfter: rc[1].after,
      oppMateId: p3Id,
      oppMateName: typeof p[3]?.nick === "string" ? p[3].nick : undefined,
      oppMateRatingBefore: rc[3].before,
      oppMateRatingAfter: rc[3].after,
    } satisfies Partial<GameRow>);
  } else {
    // Solo
    const player = gameData?.player;
    const totalScore = asNum(
      player?.totalScore?.amount ?? player?.totalScore ?? gameData?.totalScore?.amount
    );
    Object.assign(updates, {
      selfId: readPlayerId(player),
      selfName: typeof player?.nick === "string" ? player.nick : undefined,
      selfScore: totalScore,
    } satisfies Partial<GameRow>);
  }

  return updates;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Fetch game details for games in dbV2 that don't yet have details.
 * Updates `games`, writes `rawGameDetails`, `detailFetchLog`, and `rounds`.
 */
export async function fetchDetails(opts: {
  /** If provided, only fetch details for these games (otherwise queries DB). */
  games?: GameRow[];
  onProgress?: (p: DetailFetchProgress) => void;
  concurrency?: number;
  delayMs?: number;
  /** Retry previously-failed games (lastStatus !== 'ok'), up to maxRetries attempts */
  retryFailed?: boolean;
  /** Max attempts before a game is considered permanently unfetchable (default: 3) */
  maxRetries?: number;
}): Promise<DetailFetchResult> {
  const concurrency = Math.max(1, opts.concurrency ?? 2);
  const delayMs = opts.delayMs ?? 500;
  const maxRetries = opts.maxRetries ?? 3;

  let games: GameRow[];
  if (opts.games) {
    games = opts.games;
  } else {
    // Query all games without detailFetchedAt
    const all = await dbV2.games.toArray();
    const failed = opts.retryFailed
      ? (await dbV2.detailFetchLog.toArray())
          .filter((l) => l.lastStatus !== "ok" && l.attempts < maxRetries)
          .map((l) => l.gameId)
      : [];
    const failedSet = new Set(failed);
    games = all.filter((g) => g.detailFetchedAt === undefined || failedSet.has(g.gameId));
  }

  const total = games.length;
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  // Process in batches of `concurrency`
  for (let i = 0; i < games.length; i += concurrency) {
    const batch = games.slice(i, i + concurrency);

    await Promise.all(
      batch.map(async (game) => {
        const endpoints = buildEndpoints(game.gameId, game.modeFamily);
        const attemptedAt = Date.now();

        const result = await tryFetch(game.gameId, endpoints);

        if (!result) {
          failed++;
          await dbV2.detailFetchLog.put({
            gameId: game.gameId,
            attempts: ((await dbV2.detailFetchLog.get(game.gameId))?.attempts ?? 0) + 1,
            lastAttemptAt: attemptedAt,
            lastStatus: "not_found",
            lastError: "All endpoints failed or returned 404",
          });
          return;
        }

        const { data, endpoint } = result;

        try {
          // Write raw detail
          await dbV2.rawGameDetails.put({
            gameId: game.gameId,
            fetchedAt: attemptedAt,
            endpoint,
            json: data,
          });

          // Normalize rounds
          const isDuelType = game.modeFamily === "duels" || game.modeFamily === "teamduels";
          const rounds = isDuelType
            ? await normalizeDuelsRounds(game.gameId, data, game.selfId)
            : await normalizeSoloRounds(game.gameId, data);

          // Write rounds
          if (rounds.length > 0) {
            await dbV2.rounds.bulkPut(rounds);
          }

          // Update game row with extracted fields
          const updates = extractGameUpdates(data, game.modeFamily, game.selfId);
          await dbV2.games.update(game.gameId, updates);

          // Log success
          await dbV2.detailFetchLog.put({
            gameId: game.gameId,
            attempts: ((await dbV2.detailFetchLog.get(game.gameId))?.attempts ?? 0) + 1,
            lastAttemptAt: attemptedAt,
            lastStatus: "ok",
            endpoint,
          });

          succeeded++;
        } catch (e) {
          failed++;
          await dbV2.detailFetchLog.put({
            gameId: game.gameId,
            attempts: ((await dbV2.detailFetchLog.get(game.gameId))?.attempts ?? 0) + 1,
            lastAttemptAt: attemptedAt,
            lastStatus: "error",
            lastError: e instanceof Error ? e.message : String(e),
            endpoint,
          });
        }
      })
    );

    processed += batch.length;
    opts.onProgress?.({ processed, total, succeeded, failed });

    if (i + concurrency < games.length && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return { succeeded, failed };
}
