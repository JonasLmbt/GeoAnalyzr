import { dbV2, GameRow, RoundRow, ClassicGameRow, ClassicRoundRow, ModeFamily, MovementType, CURRENT_NORMALIZE_VERSION } from "./db_v2";
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
  selfIdFixed: number;
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

const _regionNames: Intl.DisplayNames | undefined = (() => {
  try { return new Intl.DisplayNames(["en"], { type: "region" }); } catch { return undefined; }
})();

function iso2ToName(code: string | undefined): string | undefined {
  if (!code) return undefined;
  if (!_regionNames) return code;
  try {
    const name = _regionNames.of(code.toUpperCase());
    return name && name !== code.toUpperCase() ? name : code;
  } catch {
    return code;
  }
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
  return iso2ToName(normalizeIso2(
    player?.countryCode ?? player?.country ?? player?.user?.countryCode ?? player?.user?.country
  ));
}

async function resolveGuessCountry(
  guess: any,
  lat?: number,
  lng?: number
): Promise<string | undefined> {
  const fromApi = normalizeIso2(
    guess?.countryCode ?? guess?.country_code ?? guess?.country
  );
  if (fromApi) return iso2ToName(fromApi);
  const iso = await resolveCountryCodeByLatLng(lat, lng).catch(() => undefined);
  return iso2ToName(iso);
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

interface TeamRoundEntry {
  healthBefore?: number;
  healthAfter?: number;
  damageDealt?: number;
}

function teamResultsByRound(team: any): Map<number, TeamRoundEntry> {
  const map = new Map<number, TeamRoundEntry>();
  for (const r of Array.isArray(team?.roundResults) ? team.roundResults : []) {
    const rn = asNum(r?.roundNumber);
    if (rn === undefined) continue;
    const entry: TeamRoundEntry = {};
    const hb = asNum(r?.healthBefore);
    const ha = asNum(r?.healthAfter);
    const dd = asNum(r?.damageDealt);
    if (hb !== undefined) entry.healthBefore = hb;
    if (ha !== undefined) entry.healthAfter  = ha;
    if (dd !== undefined) entry.damageDealt  = dd;
    map.set(rn, entry);
  }
  return map;
}

/**
 * Returns players in natural API order (unpersonalized):
 *   Duels:     [team[0].players[0], team[1].players[0]]
 *   Teamduels: [team[0].players[0], team[0].players[1], team[1].players[0], team[1].players[1]]
 *
 * Each entry also carries teamIdx (0 or 1) so callers can determine which team won.
 */
function rawTeamPlayers(
  gameData: any
): Array<{ player: any; teamResults: Map<number, TeamRoundEntry>; teamIdx: number }> {
  const teams: any[] = Array.isArray(gameData?.teams) ? gameData.teams : [];
  const result: Array<{ player: any; teamResults: Map<number, TeamRoundEntry>; teamIdx: number }> = [];
  for (let ti = 0; ti < teams.length; ti++) {
    const team = teams[ti];
    const tr = teamResultsByRound(team);
    for (const p of Array.isArray(team?.players) ? team.players : []) {
      result.push({ player: p, teamResults: tr, teamIdx: ti });
    }
  }
  return result.slice(0, 4);
}

async function normalizeDuelsRounds(
  gameId: string,
  gameData: any,
): Promise<RoundRow[]> {
  const rounds: any[] = Array.isArray(gameData?.rounds) ? gameData.rounds : [];
  const players = rawTeamPlayers(gameData);
  const guessMaps = players.map((x) => guessByRound(x.player));

  const result: RoundRow[] = [];

  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    const rn = asNum(r?.roundNumber) ?? i + 1;
    const startTs = toTs(r?.startTime);
    const endTs = toTs(r?.endTime);

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
    const trueCountry = iso2ToName(normalizeIso2(r?.panorama?.countryCode));
    const panoId = typeof r?.panorama?.panoId === "string" ? r.panorama.panoId : undefined;
    const truePitch = asNum(r?.panorama?.pitch ?? r?.panorama?.initialPitch);
    const trueZoom  = asNum(r?.panorama?.zoom  ?? r?.panorama?.initialZoom);
    const isHealing = r?.isHealRound === true || r?.isHealingRound === true || r?.isHeal === true || undefined;
    const damageMultiplier = asNum(r?.damageMultiplier);

    // Build per-player guess data (in raw API team/player order: p1, p2, p3, p4)
    type GuessEntry = {
      lat?: number; lng?: number; country?: string; score?: number;
      distance?: number; timeSec?: number; timedOut?: boolean;
      teamHealthAfter?: number; teamHealthBefore?: number; teamDamageDealt?: number;
    };
    const guessData: GuessEntry[] = [];

    for (let p = 0; p < players.length; p++) {
      const entry = players[p];
      const guess = guessMaps[p].get(rn);
      const teamR = entry.teamResults.get(rn);
      const lat = asNum(guess?.lat ?? guess?.latitude);
      const lng = asNum(guess?.lng ?? guess?.lon ?? guess?.longitude);
      const distanceMeters = asNum(guess?.distance ?? guess?.distanceInMeters);
      const country = await resolveGuessCountry(guess, lat, lng);
      guessData.push({
        lat, lng, country,
        score:            asNum(guess?.score),
        distance:         distanceMeters !== undefined ? distanceMeters / 1e3 : undefined,
        timeSec:          asNum(guess?.time),
        timedOut:         asBool(guess?.timedOut),
        teamHealthAfter:  teamR?.healthAfter,
        teamHealthBefore: teamR?.healthBefore,
        teamDamageDealt:  teamR?.damageDealt,
      });
    }

    const [p1g, p2g, p3g, p4g] = [guessData[0] ?? {}, guessData[1] ?? {}, guessData[2] ?? {}, guessData[3] ?? {}];

    // For teamduels (4 players): determine which guess was used per team
    // team[0] = p1+p2; team[1] = p3+p4
    const hasP2 = p2g.score !== undefined || p2g.lat !== undefined;
    const p1IsBetterGuess = hasP2 ? ((p1g.score ?? -1) >= (p2g.score ?? -1)) : undefined;
    const p2IsBetterGuess = hasP2 ? !p1IsBetterGuess : undefined;
    const hasP4 = p4g.score !== undefined || p4g.lat !== undefined;
    const p3IsBetterGuess = hasP4 ? ((p3g.score ?? -1) >= (p4g.score ?? -1)) : undefined;
    const p4IsBetterGuess = hasP4 ? !p3IsBetterGuess : undefined;

    // Team health: p1 and p2 share team[0] health; p3 and p4 share team[1] health
    const team0Health = p1g.teamHealthAfter !== undefined ? p1g : p2g;
    const team1Health = p3g.teamHealthAfter !== undefined ? p3g : p4g;

    const row: RoundRow = {
      gameId,
      roundNumber: rn,
      startTime: startTs,
      durationSec,
      trueLat, trueLng, trueHeadingDeg, trueCountry, panoId, truePitch, trueZoom,
      isHealing: isHealing as boolean | undefined,
      damageMultiplier,
      p1Lat: p1g.lat, p1Lng: p1g.lng, p1Country: p1g.country,
      p1Score: p1g.score, p1Distance: p1g.distance,
      p1TimeSec: p1g.timeSec, p1TimedOut: p1g.timedOut,
      p1IsBetterGuess,
      p2Lat: p2g.lat, p2Lng: p2g.lng, p2Country: p2g.country,
      p2Score: p2g.score, p2Distance: p2g.distance,
      p2TimeSec: p2g.timeSec, p2TimedOut: p2g.timedOut,
      p2IsBetterGuess,
      p3Lat: p3g.lat, p3Lng: p3g.lng, p3Country: p3g.country,
      p3Score: p3g.score, p3Distance: p3g.distance,
      p3TimeSec: p3g.timeSec, p3TimedOut: p3g.timedOut,
      p3IsBetterGuess,
      p4Lat: p4g.lat, p4Lng: p4g.lng, p4Country: p4g.country,
      p4Score: p4g.score, p4Distance: p4g.distance,
      p4IsBetterGuess,
      team0HealthAfter:  team0Health.teamHealthAfter,
      team0HealthBefore: team0Health.teamHealthBefore,
      team0DamageDealt:  team0Health.teamDamageDealt,
      team1HealthAfter:  team1Health.teamHealthAfter,
      team1HealthBefore: team1Health.teamHealthBefore,
      team1DamageDealt:  team1Health.teamDamageDealt,
    };

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
    const trueCountry = iso2ToName(normalizeIso2(r?.streakLocationCode ?? r?.countryCode));

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
      p1Lat: guessLat,
      p1Lng: guessLng,
      p1Country: guessCountry,
      p1Score: asNum(guess?.roundScoreInPoints ?? guess?.roundScore?.amount ?? guess?.score),
      p1Distance: distanceMeters !== undefined ? distanceMeters / 1e3 : undefined,
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
      trueCountry: iso2ToName(normalizeIso2(r?.streakLocationCode ?? r?.countryCode)),
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
    normalizeVersion: CURRENT_NORMALIZE_VERSION,
    mapName,
    mapSlug,
    isRated,
    totalRounds,
    movementType: movementType ?? undefined,
  };

  if (isDuelType) {
    const initialHealth = asNum(gameData?.options?.initialHealth);
    const winnerStyle = typeof gameData?.result?.winnerStyle === "string"
      ? gameData.result.winnerStyle
      : undefined;
    if (initialHealth !== undefined) updates.initialHealth = initialHealth;
    if (winnerStyle !== undefined) updates.winnerStyle = winnerStyle;

    const teams: any[] = Array.isArray(gameData?.teams) ? gameData.teams : [];
    const winningTeamId = String(gameData?.result?.winningTeamId || "");

    // Players in natural API order (unpersonalized)
    const players = rawTeamPlayers(gameData);
    const p = [0, 1, 2, 3].map((i) => players[i]?.player ?? null);
    const rc = p.map(extractRatingChange);
    const gm = p.map(extractGameModeRating);

    // Winner: find which team index won
    let winnerTeamIdx: number | undefined;
    if (winningTeamId) {
      const winIdx = teams.findIndex((t: any) => String(t?.id || "") === winningTeamId);
      if (winIdx >= 0) winnerTeamIdx = winIdx;
    }
    if (winnerTeamIdx === undefined) {
      const h0 = asNum(teams[0]?.health);
      const h1 = asNum(teams[1]?.health);
      if (h0 !== undefined && h1 !== undefined) {
        winnerTeamIdx = h0 >= h1 ? 0 : 1;
      }
    }

    // Movement ratings for p1 (team[0].players[0]) and p3/p2 (opponent)
    // For duels: p1=players[0], opponent=players[1]. For teamduels: p1=players[0], opp=players[2].
    const isDuels = game.modeFamily === "duels";
    const mt = movementType;
    const p1Gm = gm[0];
    const oppGm = isDuels ? gm[1] : gm[2]; // opponent slot differs by mode

    Object.assign(updates, {
      p1Id:      readPlayerId(p[0]) ?? undefined,
      p1Name:    typeof p[0]?.nick === "string" ? p[0].nick : undefined,
      p1Country: extractCountry(p[0]),
      p1Score:   asNum(teams[0]?.health),
      winnerTeamIdx,
      p1RatingBefore: rc[0].before,
      p1RatingAfter:  rc[0].after,
      p1MovingRatingBefore:  mt === "moving"  ? p1Gm.before : undefined,
      p1MovingRatingAfter:   mt === "moving"  ? p1Gm.after  : undefined,
      p1NoMoveRatingBefore:  mt === "no_move" ? p1Gm.before : undefined,
      p1NoMoveRatingAfter:   mt === "no_move" ? p1Gm.after  : undefined,
      p1NmpzRatingBefore:    mt === "nmpz"    ? p1Gm.before : undefined,
      p1NmpzRatingAfter:     mt === "nmpz"    ? p1Gm.after  : undefined,
    } satisfies Partial<GameRow>);

    if (isDuels) {
      // Duels: p2 = team[1].players[0]
      Object.assign(updates, {
        p2Id:      readPlayerId(p[1]) ?? undefined,
        p2Name:    typeof p[1]?.nick === "string" ? p[1].nick : undefined,
        p2Country: extractCountry(p[1]),
        p2RatingBefore: rc[1].before,
        p2RatingAfter:  rc[1].after,
        p2MovingRatingBefore:  mt === "moving"  ? oppGm.before : undefined,
        p2MovingRatingAfter:   mt === "moving"  ? oppGm.after  : undefined,
        p2NoMoveRatingBefore:  mt === "no_move" ? oppGm.before : undefined,
        p2NoMoveRatingAfter:   mt === "no_move" ? oppGm.after  : undefined,
        p2NmpzRatingBefore:    mt === "nmpz"    ? oppGm.before : undefined,
        p2NmpzRatingAfter:     mt === "nmpz"    ? oppGm.after  : undefined,
      } satisfies Partial<GameRow>);
    } else {
      // Teamduels: p2 = team[0].players[1], p3 = team[1].players[0], p4 = team[1].players[1]
      Object.assign(updates, {
        p2Id:      readPlayerId(p[1]) ?? undefined,
        p2Name:    typeof p[1]?.nick === "string" ? p[1].nick : undefined,
        p2Country: extractCountry(p[1]),
        p2RatingBefore: rc[1].before,
        p2RatingAfter:  rc[1].after,
        p3Id:      readPlayerId(p[2]) ?? undefined,
        p3Name:    typeof p[2]?.nick === "string" ? p[2].nick : undefined,
        p3Country: extractCountry(p[2]),
        p3RatingBefore: rc[2].before,
        p3RatingAfter:  rc[2].after,
        p3MovingRatingBefore:  mt === "moving"  ? oppGm.before : undefined,
        p3MovingRatingAfter:   mt === "moving"  ? oppGm.after  : undefined,
        p3NoMoveRatingBefore:  mt === "no_move" ? oppGm.before : undefined,
        p3NoMoveRatingAfter:   mt === "no_move" ? oppGm.after  : undefined,
        p3NmpzRatingBefore:    mt === "nmpz"    ? oppGm.before : undefined,
        p3NmpzRatingAfter:     mt === "nmpz"    ? oppGm.after  : undefined,
        p4Id:      readPlayerId(p[3]) ?? undefined,
        p4Name:    typeof p[3]?.nick === "string" ? p[3].nick : undefined,
        p4Country: extractCountry(p[3]),
        p4RatingBefore: rc[3].before,
        p4RatingAfter:  rc[3].after,
      } satisfies Partial<GameRow>);
    }
  } else {
    // Solo
    const player = gameData?.player;
    const totalScore = asNum(
      player?.totalScore?.amount ?? player?.totalScore ?? gameData?.totalScore?.amount
    );
    Object.assign(updates, {
      p1Id:    readPlayerId(player) ?? undefined,
      p1Name:  typeof player?.nick === "string" ? player.nick : undefined,
      p1Score: totalScore,
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
    if (game.winnerTeamIdx === undefined) m.push("winnerTeamIdx");
    if (game.p1Id === undefined) m.push("p1Id");
    if (game.p2Id === undefined) m.push("p2Id");
    if (game.isRated && game.p1RatingBefore === undefined && game.detailFetchedAt === undefined) m.push("p1RatingBefore");
  }
  if (game.modeFamily === "teamduels") {
    if (game.p3Id === undefined) m.push("p3Id");
  }
  return m;
}

function isDetailIncomplete(game: GameRow): boolean {
  return getMissingFields(game).length > 0;
}

/**
 * Returns true when the game's normalization version is behind
 * CURRENT_NORMALIZE_VERSION and new fields should be extracted from the
 * raw cache (no API call needed).
 */
export function needsRenormalize(game: GameRow): boolean {
  return (game.normalizeVersion ?? 0) < CURRENT_NORMALIZE_VERSION;
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
  /** During force, skip games older than this many days (default: no cutoff). */
  maxAgeDays?: number;
}): Promise<DetailFetchResult> {
  const concurrency = Math.max(1, opts.concurrency ?? 2);
  const delayMs = opts.delayMs ?? 500;
  const maxRetries = opts.maxRetries ?? 3;
  const cutoffMs = opts.force && opts.maxAgeDays != null
    ? Date.now() - opts.maxAgeDays * 24 * 60 * 60 * 1000
    : undefined;

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
      if (cutoffMs != null && (g.playedAt ?? 0) < cutoffMs) return false;
      if (isDetailIncomplete(g)) {
        // Respect maxRetries for normal API fetches to avoid hammering the API.
        if (!opts.force && (attemptsByGame.get(g.gameId) ?? 0) >= maxRetries) return false;
        return true;
      }
      // Re-normalization bypasses maxRetries: it reads only from the local raw
      // cache (no API calls), so exhausting retries is not a risk.
      if (needsRenormalize(g)) return true;
      return false;
    });
  }

  const total = games.length;
  let processed = 0;
  let succeeded = 0;
  const updatedGameIds: string[] = [];
  let failed = 0;
  const selfIdFixed = 0;

  // Process in batches of `concurrency`
  for (let i = 0; i < games.length; i += concurrency) {
    const batch = games.slice(i, i + concurrency);

    await Promise.all(
      batch.map(async (game) => {
        const missing = getMissingFields(game);
        const gameIsIncomplete = missing.length > 0;
        const gameNeedsRenorm = needsRenormalize(game);
        opts.onGameEvent?.({ gameId: game.gameId, playedAt: game.playedAt, mode: game.modeFamily, missing, status: "checking" });

        const attemptedAt = Date.now();

        // ── Cache-first: try to re-parse stored raw response before hitting the API ──
        // This path handles two cases:
        //   1. Game has missing fields → re-extract from raw cache to avoid an API call.
        //   2. Game needs re-normalization (new fields) → re-extract + re-write rounds.
        const cached = await dbV2.rawGameDetails.get(game.gameId);
        if (cached?.json) {
          try {
            const updates = extractGameUpdates(cached.json, game.modeFamily);
            const hypothetical = { ...game, ...updates } as GameRow;
            // Proceed if cache satisfies all required fields OR this is a renorm-only pass.
            if (getMissingFields(hypothetical).length === 0 || gameNeedsRenorm) {
              await dbV2.games.update(game.gameId, updates);
              // Re-normalize rounds with the (potentially updated) field set.
              const isDuelType = game.modeFamily === "duels" || game.modeFamily === "teamduels";
              if (isDuelType) {
                const rounds = await normalizeDuelsRounds(game.gameId, cached.json);
                if (rounds.length > 0) await dbV2.rounds.bulkPut(rounds);
              }
              opts.onGameEvent?.({ gameId: game.gameId, playedAt: game.playedAt, mode: game.modeFamily, missing, status: "ok", source: "cache" });
              updatedGameIds.push(game.gameId);
              succeeded++;
              return;
            }
          } catch { /* ignore, fall through to API */ }
        }

        // ── Re-normalize only (no cache available) ────────────────────────────────
        // The game is complete (no missing fields) but its normalizeVersion is
        // behind CURRENT_NORMALIZE_VERSION.  There is no raw cache to re-extract
        // from, so just bump the version stamp to prevent repeated retries.
        if (gameNeedsRenorm && !gameIsIncomplete) {
          await dbV2.games.update(game.gameId, { normalizeVersion: CURRENT_NORMALIZE_VERSION });
          opts.onGameEvent?.({ gameId: game.gameId, playedAt: game.playedAt, mode: game.modeFamily, missing, status: "ok" });
          succeeded++;
          updatedGameIds.push(game.gameId);
          return;
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
            ? await normalizeDuelsRounds(game.gameId, data)
            : await normalizeSoloRounds(game.gameId, data);

          // Write rounds
          if (rounds.length > 0) {
            await dbV2.rounds.bulkPut(rounds);
          }

          // For standard/classic games, also write to dedicated classic tables
          if (game.modeFamily === "standard") {
            const selfId = opts.currentPlayerId ?? readPlayerId(data?.player) ?? "";
            const classicGame = normalizeClassicGame(game.gameId, selfId, data);
            const classicRounds = await normalizeClassicRounds(game.gameId, data);
            await dbV2.classicGames.put(classicGame);
            if (classicRounds.length > 0) await dbV2.classicRounds.bulkPut(classicRounds);
          }

          // Update game row with extracted fields
          const updates = extractGameUpdates(data, game.modeFamily);
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

  return { queued: total, succeeded, updatedGameIds, failed, permanentlySkipped, selfIdFixed };
}
