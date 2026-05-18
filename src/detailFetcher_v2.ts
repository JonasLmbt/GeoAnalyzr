import { dbV2, GameRow, RoundRow, ClassicGameRow, ClassicRoundRow, ModeFamily, MovementType } from "./db_v2";
import { httpGetJsonWithRetry } from "./http";
import { resolveCountryCodeByLatLng } from "./countries";

export interface DetailFetchProgress {
  processed: number;
  total: number;
  succeeded: number;
  failed: number;
}

export interface DetailFetchResult {
  queued: number;
  succeeded: number;
  updatedGameIds: string[];
  failed: number;
  permanentlySkipped: number;
}

export interface DetailGameEvent {
  gameId: string;
  playedAt?: number;
  mode: ModeFamily;
  missing: string[];
  status: "checking" | "ok" | "failed";
  source?: "cache" | "api";
  error?: string;
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

/** Extracts the movement-mode–specific rating change for this game. */
function extractGameModeRating(player: any): { before?: number; after?: number } {
  const paths = [
    "progressChange.rankedSystemProgress",
    "progressChange.rankedTeamDuelsProgress",
    "progressChange.rankedProgress",
    "progressChange.ratingProgress",
  ];
  for (const p of paths) {
    const obj = getByPath(player, p);
    const before = asNum(obj?.gameModeRatingBefore);
    const after = asNum(obj?.gameModeRatingAfter);
    if (before !== undefined || after !== undefined) return { before, after };
  }
  return {};
}

function extractCountry(player: any): string | undefined {
  return normalizeIso2(
    player?.countryCode ?? player?.country ?? player?.user?.countryCode ?? player?.user?.country
  );
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

  // Enforce the [self, mate?, opp, oppMate?] contract: if own team has only one
  // player (standard 1v1 duel), insert a null placeholder for the mate slot so
  // that opponents always land at index 2 and index 3, not 1 and 2.
  const hasOtherPlayers = otherTeams.some(
    (t: any) => Array.isArray(t?.players) && t.players.length > 0
  );
  if (ownPlayers.length === 1 && hasOtherPlayers) {
    result.push({ player: null, healthMap: new Map() });
  }

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
    const trueHeadingDeg = asNum(
      r?.panorama?.heading ?? r?.panorama?.panoHeading ?? r?.panorama?.initialHeading
    );
    const trueCountry = normalizeIso2(r?.panorama?.countryCode);
    const isHealing = r?.isHealRound === true || r?.isHealingRound === true || r?.isHeal === true || undefined;
    const damageMultiplier = asNum(r?.damageMultiplier);

    // Build per-player guess data
    const guessData: Array<{
      lat?: number;
      lng?: number;
      country?: string;
      score?: number;
      distance?: number; // km
      healthAfter?: number;
    }> = [];

    for (let p = 0; p < 4; p++) {
      const entry = players[p];
      if (!entry) {
        guessData.push({});
        continue;
      }
      const guess = guessMaps[p].get(rn);
      const lat = asNum(guess?.lat ?? guess?.latitude);
      const lng = asNum(guess?.lng ?? guess?.lon ?? guess?.longitude);
      const distanceMeters = asNum(guess?.distance ?? guess?.distanceInMeters);
      const country = await resolveGuessCountry(guess, lat, lng);
      guessData.push({
        lat,
        lng,
        country,
        score: asNum(guess?.score),
        distance: distanceMeters !== undefined ? distanceMeters / 1e3 : undefined,
        healthAfter: entry.healthMap.get(rn),
      });
    }

    const [self, mate, opp, oppMate] = guessData;

    // In TeamDuels the team uses the better of the two guesses
    const hasMate = mate.score !== undefined || mate.lat !== undefined;
    const selfIsBetterGuess = hasMate ? ((self.score ?? -1) >= (mate.score ?? -1)) : undefined;
    const hasOppMate = oppMate.score !== undefined || oppMate.lat !== undefined;
    const oppIsBetterGuess = hasOppMate ? ((opp.score ?? -1) >= (oppMate.score ?? -1)) : undefined;

    const row: RoundRow = {
      gameId,
      roundNumber: rn,
      startTime: startTs,
      durationSec,
      trueLat,
      trueLng,
      trueHeadingDeg,
      trueCountry,
      isHealing: isHealing as boolean | undefined,
      damageMultiplier,
      selfLat: self.lat,
      selfLng: self.lng,
      selfCountry: self.country,
      selfScore: self.score,
      selfDistance: self.distance,
      selfHealthAfter: self.healthAfter,
      selfIsBetterGuess,
      oppLat: opp.lat,
      oppLng: opp.lng,
      oppCountry: opp.country,
      oppScore: opp.score,
      oppDistance: opp.distance,
      oppHealthAfter: opp.healthAfter,
      oppIsBetterGuess,
      mateLat: mate.lat,
      mateLng: mate.lng,
      mateCountry: mate.country,
      mateScore: mate.score,
      mateDistance: mate.distance,
      oppMateLat: oppMate.lat,
      oppMateLng: oppMate.lng,
      oppMateCountry: oppMate.country,
      oppMateScore: oppMate.score,
      oppMateDistance: oppMate.distance,
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
      selfLat: guessLat,
      selfLng: guessLng,
      selfCountry: guessCountry,
      selfScore: asNum(guess?.roundScoreInPoints ?? guess?.roundScore?.amount ?? guess?.score),
      selfDistance: distanceMeters !== undefined ? distanceMeters / 1e3 : undefined,
    };

    for (const k of Object.keys(row) as (keyof RoundRow)[]) {
      if (row[k] === undefined) delete row[k];
    }

    result.push(row);
  }

  return result;
}

// ─── Classic normalization ────────────────────────────────────────────────────

function normalizeClassicGame(gameId: string, playerId: string, gameData: any): ClassicGameRow {
  const rounds: any[] = Array.isArray(gameData?.rounds) ? gameData.rounds : [];
  const player = gameData?.player;
  const movement = detectMovementType(gameData);

  const row: ClassicGameRow = {
    gameId,
    playerId,
    playedAt: toTs(rounds[0]?.startTime),
    mapId: typeof gameData?.map === "string" ? gameData.map : undefined,
    mapName: typeof gameData?.mapName === "string" ? gameData.mapName : undefined,
    movement: movement === "mixed" ? undefined : (movement ?? undefined),
    timeLimit: asNum(gameData?.timeLimit),
    roundCount: asNum(gameData?.roundCount) ?? (rounds.length || undefined),
    totalScore: asNum(player?.totalScore?.amount ?? player?.totalScore),
    totalDistanceM: asNum(player?.totalDistanceInMeters),
    totalTimeSec: asNum(player?.totalTime),
    totalSteps: asNum(player?.totalStepsCount),
    detailFetchedAt: Date.now(),
  };

  for (const k of Object.keys(row) as (keyof ClassicGameRow)[]) {
    if (row[k] === undefined) delete row[k];
  }
  return row;
}

async function normalizeClassicRounds(gameId: string, gameData: any): Promise<ClassicRoundRow[]> {
  const rounds: any[] = Array.isArray(gameData?.rounds) ? gameData.rounds : [];
  const guesses: any[] = Array.isArray(gameData?.player?.guesses)
    ? gameData.player.guesses
    : [];

  const result: ClassicRoundRow[] = [];
  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    const g = guesses[i];

    const guessLat = asNum(g?.lat ?? g?.latitude);
    const guessLng = asNum(g?.lng ?? g?.longitude);
    const selfCountry = await resolveGuessCountry(g, guessLat, guessLng);
    const distM = asNum(g?.distanceInMeters);

    const row: ClassicRoundRow = {
      gameId,
      roundNumber: i + 1,
      playedAt: toTs(r?.startTime),
      trueLat: asNum(r?.lat ?? r?.latitude),
      trueLng: asNum(r?.lng ?? r?.longitude),
      trueHeadingDeg: asNum(r?.heading),
      trueCountry: normalizeIso2(r?.streakLocationCode ?? r?.countryCode),
      panoId: typeof r?.panoId === "string" ? r.panoId : undefined,
      selfLat: guessLat,
      selfLng: guessLng,
      selfCountry,
      selfScore: asNum(g?.roundScoreInPoints ?? g?.roundScore?.amount),
      selfDistance: distM !== undefined ? distM / 1e3 : undefined,
      selfTimeSec: asNum(g?.time),
      selfSteps: asNum(g?.stepsCount),
      timedOut: asBool(g?.timedOut),
      skippedRound: asBool(g?.skippedRound),
    };

    for (const k of Object.keys(row) as (keyof ClassicRoundRow)[]) {
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
    const gm = p.map(extractGameModeRating);

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
    const selfScore = asNum(ownTeam?.health);
    const otherScore = asNum(otherTeam?.health);

    // Primary: winningTeamId from result; fallback: team with higher health wins
    let selfVictory: boolean | undefined;
    if (winningTeamId) {
      selfVictory = String(ownTeam?.id || "") === winningTeamId;
    } else if (selfScore !== undefined && otherScore !== undefined) {
      selfVictory = selfScore > otherScore;
    }

    // Movement ratings: API returns one gameModeRating per player; which column
    // it maps to depends on the movementType of this game.
    const mt = movementType; // already extracted above
    const selfGm = gm[0];
    const oppGm = gm[2];
    const selfMovingRatingBefore  = mt === "moving"  ? selfGm.before : undefined;
    const selfMovingRatingAfter   = mt === "moving"  ? selfGm.after  : undefined;
    const selfNoMoveRatingBefore  = mt === "no_move" ? selfGm.before : undefined;
    const selfNoMoveRatingAfter   = mt === "no_move" ? selfGm.after  : undefined;
    const selfNmpzRatingBefore    = mt === "nmpz"    ? selfGm.before : undefined;
    const selfNmpzRatingAfter     = mt === "nmpz"    ? selfGm.after  : undefined;
    const oppMovingRatingBefore   = mt === "moving"  ? oppGm.before  : undefined;
    const oppMovingRatingAfter    = mt === "moving"  ? oppGm.after   : undefined;
    const oppNoMoveRatingBefore   = mt === "no_move" ? oppGm.before  : undefined;
    const oppNoMoveRatingAfter    = mt === "no_move" ? oppGm.after   : undefined;
    const oppNmpzRatingBefore     = mt === "nmpz"    ? oppGm.before  : undefined;
    const oppNmpzRatingAfter      = mt === "nmpz"    ? oppGm.after   : undefined;

    Object.assign(updates, {
      selfId: p0Id,
      selfName: typeof p[0]?.nick === "string" ? p[0].nick : undefined,
      selfCountry: extractCountry(p[0]),
      selfScore,
      selfVictory,
      selfRatingBefore: rc[0].before,
      selfRatingAfter: rc[0].after,
      selfMovingRatingBefore,
      selfMovingRatingAfter,
      selfNoMoveRatingBefore,
      selfNoMoveRatingAfter,
      selfNmpzRatingBefore,
      selfNmpzRatingAfter,
      oppId: p2Id,
      oppName: typeof p[2]?.nick === "string" ? p[2].nick : undefined,
      oppCountry: extractCountry(p[2]),
      oppRatingBefore: rc[2].before,
      oppRatingAfter: rc[2].after,
      oppMovingRatingBefore,
      oppMovingRatingAfter,
      oppNoMoveRatingBefore,
      oppNoMoveRatingAfter,
      oppNmpzRatingBefore,
      oppNmpzRatingAfter,
      mateId: p1Id,
      mateName: typeof p[1]?.nick === "string" ? p[1].nick : undefined,
      mateCountry: extractCountry(p[1]),
      mateRatingBefore: rc[1].before,
      mateRatingAfter: rc[1].after,
      oppMateId: p3Id,
      oppMateName: typeof p[3]?.nick === "string" ? p[3].nick : undefined,
      oppMateCountry: extractCountry(p[3]),
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

// ─── Completeness check ───────────────────────────────────────────────────────

export function getMissingFields(game: GameRow): string[] {
  const m: string[] = [];
  if (game.detailFetchedAt === undefined) m.push("never fetched");
  if (game.totalRounds === undefined) m.push("totalRounds");
  if (game.movementType === undefined) m.push("movementType");
  const isDuelType = game.modeFamily === "duels" || game.modeFamily === "teamduels";
  if (isDuelType) {
    if (game.selfVictory === undefined) m.push("selfVictory");
    if (game.oppId === undefined) m.push("oppId");
    // Only require selfRatingBefore on the first fetch; if the game has already been
    // fetched and the API still didn't return it, accept that as the final state.
    if (game.isRated && game.selfRatingBefore === undefined && game.detailFetchedAt === undefined) m.push("selfRatingBefore");
  }
  if (game.modeFamily === "teamduels") {
    if (game.mateId === undefined) m.push("mateId");
  }
  return m;
}

function isDetailIncomplete(game: GameRow): boolean {
  return getMissingFields(game).length > 0;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Fetch game details for games in dbV2 that are missing details or incomplete.
 * Updates `games`, writes `rawGameDetails`, `detailFetchLog`, and `rounds`.
 */
export async function fetchDetails(opts: {
  /** If provided, only fetch details for these games (otherwise queries DB). */
  games?: GameRow[];
  onProgress?: (p: DetailFetchProgress) => void;
  onGameEvent?: (e: DetailGameEvent) => void;
  concurrency?: number;
  delayMs?: number;
  /** Max attempts per game before it is skipped on normal syncs (default: 3) */
  maxRetries?: number;
  /** If true, retry even games that have exhausted maxRetries (shift+click) */
  force?: boolean;
  /** The current user's GeoGuessr player ID — used to correctly assign self/opp when game.selfId is missing. */
  currentPlayerId?: string;
}): Promise<DetailFetchResult> {
  const concurrency = Math.max(1, opts.concurrency ?? 2);
  const delayMs = opts.delayMs ?? 500;
  const maxRetries = opts.maxRetries ?? 3;

  let games: GameRow[];
  let permanentlySkipped = 0;
  if (opts.games) {
    games = opts.games;
  } else {
    const all = await dbV2.games.toArray();
    const logEntries = await dbV2.detailFetchLog.toArray();
    const attemptsByGame = new Map(logEntries.map((l) => [l.gameId, l.attempts]));
    permanentlySkipped = [...attemptsByGame.values()].filter((a) => a >= maxRetries).length;
    games = all.filter((g) => {
      if (!opts.force && (attemptsByGame.get(g.gameId) ?? 0) >= maxRetries) return false;
      return isDetailIncomplete(g);
    });
  }

  const total = games.length;
  let processed = 0;
  let succeeded = 0;
  const updatedGameIds: string[] = [];
  let failed = 0;

  // Process in batches of `concurrency`
  for (let i = 0; i < games.length; i += concurrency) {
    const batch = games.slice(i, i + concurrency);

    await Promise.all(
      batch.map(async (game) => {
        const missing = getMissingFields(game);
        opts.onGameEvent?.({ gameId: game.gameId, playedAt: game.playedAt, mode: game.modeFamily, missing, status: "checking" });

        // Resolve the correct selfId: use stored value first, fall back to the
        // known current player ID so orderedPlayers() always puts the right
        // player in slot 0 even for freshly-fetched games.
        const resolvedSelfId = game.selfId ?? opts.currentPlayerId;

        const attemptedAt = Date.now();

        // ── Cache-first: try to re-parse stored raw response before hitting the API ──
        const cached = await dbV2.rawGameDetails.get(game.gameId);
        if (cached?.json) {
          try {
            const updates = extractGameUpdates(cached.json, game.modeFamily, resolvedSelfId);
            const hypothetical = { ...game, ...updates } as GameRow;
            if (getMissingFields(hypothetical).length === 0) {
              await dbV2.games.update(game.gameId, updates);
              // Re-normalize rounds so opp/mate slots are correct after the index fix.
              const isDuelType = game.modeFamily === "duels" || game.modeFamily === "teamduels";
              if (isDuelType) {
                const rounds = await normalizeDuelsRounds(game.gameId, cached.json, hypothetical.selfId ?? resolvedSelfId);
                if (rounds.length > 0) await dbV2.rounds.bulkPut(rounds);
              }
              opts.onGameEvent?.({ gameId: game.gameId, playedAt: game.playedAt, mode: game.modeFamily, missing, status: "ok", source: "cache" });
              updatedGameIds.push(game.gameId);
              succeeded++;
              return;
            }
          } catch { /* ignore, fall through to API */ }
        }

        // ── API fetch ──────────────────────────────────────────────────────────────
        const endpoints = buildEndpoints(game.gameId, game.modeFamily);
        const result = await tryFetch(game.gameId, endpoints);

        if (!result) {
          failed++;
          opts.onGameEvent?.({ gameId: game.gameId, playedAt: game.playedAt, mode: game.modeFamily, missing, status: "failed", error: "All endpoints 404" });
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
            ? await normalizeDuelsRounds(game.gameId, data, resolvedSelfId)
            : await normalizeSoloRounds(game.gameId, data);

          // Write rounds
          if (rounds.length > 0) {
            await dbV2.rounds.bulkPut(rounds);
          }

          // For standard/classic games, also write to dedicated classic tables
          if (game.modeFamily === "standard") {
            const selfId = resolvedSelfId ?? readPlayerId(data?.player) ?? "";
            const classicGame = normalizeClassicGame(game.gameId, selfId, data);
            const classicRounds = await normalizeClassicRounds(game.gameId, data);
            await dbV2.classicGames.put(classicGame);
            if (classicRounds.length > 0) await dbV2.classicRounds.bulkPut(classicRounds);
          }

          // Update game row with extracted fields
          const updates = extractGameUpdates(data, game.modeFamily, resolvedSelfId);
          await dbV2.games.update(game.gameId, updates);

          // Log success
          await dbV2.detailFetchLog.put({
            gameId: game.gameId,
            attempts: ((await dbV2.detailFetchLog.get(game.gameId))?.attempts ?? 0) + 1,
            lastAttemptAt: attemptedAt,
            lastStatus: "ok",
            endpoint,
          });

          opts.onGameEvent?.({ gameId: game.gameId, playedAt: game.playedAt, mode: game.modeFamily, missing, status: "ok", source: "api" });
          updatedGameIds.push(game.gameId);
          succeeded++;
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          opts.onGameEvent?.({ gameId: game.gameId, playedAt: game.playedAt, mode: game.modeFamily, missing, status: "failed", error: errMsg });
          failed++;
          await dbV2.detailFetchLog.put({
            gameId: game.gameId,
            attempts: ((await dbV2.detailFetchLog.get(game.gameId))?.attempts ?? 0) + 1,
            lastAttemptAt: attemptedAt,
            lastStatus: "error",
            lastError: errMsg,
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

  return { queued: total, succeeded, updatedGameIds, failed, permanentlySkipped };
}
