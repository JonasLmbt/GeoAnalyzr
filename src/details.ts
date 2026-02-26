import {
  db,
  FeedGameRow,
  GameRow,
  GameRowDuel,
  GameRowTeamDuel,
  ModeFamily,
  RoundRow,
  RoundRowDuel,
  RoundRowTeamDuel
} from "./db";
import { httpGetJson } from "./http";
import { resolveCountryCodeByLatLng } from "./countries";
import { computeGameAggFromRounds } from "./engine/gameAgg";

let cachedOwnPlayerId: string | null | undefined;
const profileCache = new Map<string, { nick?: string; countryCode?: string; countryName?: string }>();
const regionDisplay =
  typeof Intl !== "undefined" && typeof (Intl as any).DisplayNames === "function"
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;

function etaLabel(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1e3));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function toTs(isoMaybe: unknown): number | undefined {
  if (typeof isoMaybe !== "string") return undefined;
  const t = Date.parse(isoMaybe);
  return Number.isFinite(t) ? t : undefined;
}

function asNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const parsed = Number(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asBool(v: unknown): boolean | undefined {
  if (v === true) return true;
  if (v === false) return false;
  return undefined;
}

function normalizeCountryCode(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const x = v.trim().toLowerCase();
  return x || undefined;
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

function normalizeIso2(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const x = v.trim().toLowerCase();
  if (!x) return undefined;
  return /^[a-z]{2}$/.test(x) ? x : undefined;
}

function extractGuessLatLng(guess: any): { lat?: number; lng?: number } {
  const lat = asNum(
    pickFirst(guess, [
      "lat",
      "latitude",
      "location.lat",
      "position.lat",
      "coordinates.1"
    ])
  );
  const lng = asNum(
    pickFirst(guess, [
      "lng",
      "lon",
      "longitude",
      "location.lng",
      "location.lon",
      "position.lng",
      "position.lon",
      "coordinates.0"
    ])
  );
  return { lat, lng };
}

function extractGuessCountryCode(guess: any): string | undefined {
  return normalizeIso2(
    pickFirst(guess, [
      "countryCode",
      "country_code",
      "country"
    ])
  );
}

async function resolveGuessCountryFallback(lat?: number, lng?: number): Promise<string | undefined> {
  try {
    return await resolveCountryCodeByLatLng(lat, lng);
  } catch {
    return undefined;
  }
}

function roundId(gameId: string, roundNumber: number): string {
  return `${gameId}:${roundNumber}`;
}

function countryNameFromIso2(iso?: string): string | undefined {
  if (typeof iso !== "string" || !iso.trim()) return undefined;
  const upper = iso.trim().toUpperCase();
  if (!regionDisplay) return upper;
  try {
    const name = regionDisplay.of(upper);
    return typeof name === "string" && name.trim() ? name : upper;
  } catch {
    return upper;
  }
}

function toIsoDate(ts?: number): string | undefined {
  if (!ts) return undefined;
  return new Date(ts).toISOString().slice(0, 10);
}

function toIsoTime(ts?: number): string | undefined {
  if (!ts) return undefined;
  return new Date(ts).toISOString().slice(11, 23);
}

function classifyFamily(game: FeedGameRow): ModeFamily {
  if (game.modeFamily) return game.modeFamily;
  const m = String(game.gameMode || game.mode || "").toLowerCase();
  if (m.includes("team")) return "teamduels";
  if (m.includes("duel")) return "duels";
  return "other";
}

async function getOwnPlayerId(): Promise<string | undefined> {
  if (cachedOwnPlayerId !== undefined) return cachedOwnPlayerId || undefined;

  const candidates = [
    "https://www.geoguessr.com/api/v3/profiles",
    "https://www.geoguessr.com/api/v4/profiles",
    "https://www.geoguessr.com/api/v3/users/me"
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) continue;
      const data = await res.json();
      const id = pickFirst(data, ["user.id", "id", "player.id", "playerId", "user.userId"]);
      if (typeof id === "string" && id.trim()) {
        cachedOwnPlayerId = id.trim();
        return cachedOwnPlayerId;
      }
    } catch {
      // ignore and continue
    }
  }

  cachedOwnPlayerId = null;
  return undefined;
}

async function getProfile(playerId?: string, ncfa?: string): Promise<{ nick?: string; countryCode?: string; countryName?: string } | undefined> {
  if (typeof playerId !== "string" || !playerId.trim()) return undefined;
  const key = playerId.trim();
  if (profileCache.has(key)) return profileCache.get(key);
  try {
    const url = `https://www.geoguessr.com/api/v3/users/${encodeURIComponent(key)}`;
    const res = await httpGetJson(url, { ncfa });
    if (res.status < 200 || res.status >= 300) {
      profileCache.set(key, {});
      return profileCache.get(key);
    }
    const nick = typeof res.data?.nick === "string" ? res.data.nick : undefined;
    const cc = typeof res.data?.countryCode === "string" ? res.data.countryCode : undefined;
    const profile = { nick, countryCode: cc, countryName: countryNameFromIso2(cc) };
    profileCache.set(key, profile);
    return profile;
  } catch {
    profileCache.set(key, {});
    return profileCache.get(key);
  }
}

function buildDetailCandidates(gameId: string, family: ModeFamily): string[] {
  const gameServer = [`https://game-server.geoguessr.com/api/duels/${gameId}`];
  const team = [
    ...gameServer,
    `https://www.geoguessr.com/api/team-duels/${gameId}`,
    `https://www.geoguessr.com/api/v3/team-duels/${gameId}`,
    `https://www.geoguessr.com/api/v4/team-duels/${gameId}`,
    `https://www.geoguessr.com/api/v4/competitive-games/${gameId}`,
    `https://www.geoguessr.com/api/v3/games/${gameId}`
  ];
  const duels = [
    ...gameServer,
    `https://www.geoguessr.com/api/duels/${gameId}`,
    `https://www.geoguessr.com/api/v3/duels/${gameId}`,
    `https://www.geoguessr.com/api/v4/duels/${gameId}`,
    `https://www.geoguessr.com/api/v4/competitive-games/${gameId}`,
    `https://www.geoguessr.com/api/v3/games/${gameId}`
  ];
  return family === "teamduels" ? [...team, ...duels] : [...duels, ...team];
}

function detectSimpleGameMode(movementOptions: any): string | undefined {
  if (!movementOptions || typeof movementOptions !== "object") return undefined;
  const fm = movementOptions.forbidMoving === true;
  const fz = movementOptions.forbidZooming === true;
  const fr = movementOptions.forbidRotating === true;
  if (!fm && !fz && !fr) return "moving";
  if (fm && !fz && !fr) return "no move";
  if (fm && fz && fr) return "nmpz";
  return undefined;
}

function extractRatingChange(player: any): { before?: number; after?: number } {
  const paths = [
    "progressChange.rankedSystemProgress",
    "progressChange.rankedTeamDuelsProgress",
    "progressChange.rankedProgress",
    "progressChange.ratingProgress"
  ];
  for (const p of paths) {
    const obj = getByPath(player, p);
    const before = asNum(obj?.ratingBefore);
    const after = asNum(obj?.ratingAfter);
    if (before !== undefined || after !== undefined) return { before, after };
  }
  return {};
}

async function fetchDetailJson(game: FeedGameRow, ncfa?: string): Promise<{ data: any; endpoint: string }> {
  const family = classifyFamily(game);
  const endpoints = buildDetailCandidates(game.gameId, family);
  const failures: string[] = [];

  for (const endpoint of endpoints) {
    try {
      const res = await httpGetJson(endpoint, { ncfa });
      if (res.status < 200 || res.status >= 300) {
        failures.push(`${endpoint} -> HTTP ${res.status}`);
        continue;
      }
      return { data: res.data, endpoint };
    } catch (e) {
      failures.push(`${endpoint} -> ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  throw new Error(`No endpoint worked for ${game.gameId}: ${failures.join(" | ")}`);
}

function healthByRound(team: any): Map<number, number> {
  const map = new Map<number, number>();
  const rows = Array.isArray(team?.roundResults) ? team.roundResults : [];
  for (const r of rows) {
    const rn = asNum(r?.roundNumber);
    if (rn === undefined) continue;
    const health = asNum(r?.healthAfter);
    if (health !== undefined) map.set(rn, health);
  }
  return map;
}

function guessByRound(player: any): Map<number, any> {
  const map = new Map<number, any>();
  const guesses = Array.isArray(player?.guesses) ? player.guesses : [];
  for (const g of guesses) {
    const rn = asNum(g?.roundNumber);
    if (rn === undefined) continue;
    map.set(rn, g);
  }
  return map;
}

function readPlayerId(player: any): string | undefined {
  const v = player?.playerId ?? player?.id ?? player?.userId ?? player?.user?.id;
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function orderedPlayers(gameData: any, ownPlayerId?: string): Array<{ teamId: string; player: any; healthMap: Map<number, number> }> {
  const teams = Array.isArray(gameData?.teams) ? gameData.teams : [];
  if (teams.length === 0) return [];

  let ownTeamIndex = 0;
  if (ownPlayerId) {
    const found = teams.findIndex(
      (t: any) => Array.isArray(t?.players) && t.players.some((p: any) => readPlayerId(p) === ownPlayerId)
    );
    if (found >= 0) {
      ownTeamIndex = found;
    } else {
      console.warn("[GeoAnalyzr] ownPlayerId not found in teams for game detail payload.", {
        ownPlayerId,
        teamIds: teams.map((t: any) => String(t?.id || "")),
        teamPlayers: teams.map((t: any) => (Array.isArray(t?.players) ? t.players.map((p: any) => readPlayerId(p)) : []))
      });
    }
  }

  const ownTeam = teams[ownTeamIndex];
  const otherTeams = teams.filter((_: any, i: number) => i !== ownTeamIndex);
  const ownPlayers = Array.isArray(ownTeam?.players) ? [...ownTeam.players] : [];
  const ownHealth = healthByRound(ownTeam);

  if (ownPlayerId) {
    ownPlayers.sort((a: any, b: any) => {
      if (readPlayerId(a) === ownPlayerId) return -1;
      if (readPlayerId(b) === ownPlayerId) return 1;
      return 0;
    });
  }

  const out: Array<{ teamId: string; player: any; healthMap: Map<number, number> }> = [];
  for (const p of ownPlayers) out.push({ teamId: String(ownTeam?.id || ""), player: p, healthMap: ownHealth });
  for (const t of otherTeams) {
    const teamHealth = healthByRound(t);
    for (const p of Array.isArray(t?.players) ? t.players : []) {
      out.push({ teamId: String(t?.id || ""), player: p, healthMap: teamHealth });
    }
  }

  return out.slice(0, 4);
}

function averageDefined(values: Array<number | undefined>): number | undefined {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return undefined;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

async function normalizeGameAndRounds(
  game: FeedGameRow,
  gameData: any,
  endpoint: string,
  ownPlayerId?: string,
  ncfa?: string,
  existingByRoundNumber?: Map<number, any>
): Promise<{ detail: GameRow; rounds: RoundRow[] }> {
  const teams = Array.isArray(gameData?.teams) ? gameData.teams : [];
  const rounds = Array.isArray(gameData?.rounds) ? gameData.rounds : [];
  const startTime = toTs(rounds[0]?.startTime);
  const family = classifyFamily(game);
  const winningTeamId = String(gameData?.result?.winningTeamId || "");

  const damageMultiplierRounds = rounds
    .filter((r: any) => (asNum(r?.damageMultiplier) || 1) > 1)
    .map((r: any) => asNum(r?.roundNumber))
    .filter((v: any): v is number => v !== undefined);

  const healingRounds = rounds
    .filter((r: any) => Boolean(r?.isHealingRound))
    .map((r: any) => asNum(r?.roundNumber))
    .filter((v: any): v is number => v !== undefined);

  const mapName = pickFirst(gameData, ["options.map.name"]);
  const mapSlug = pickFirst(gameData, ["options.map.slug"]);
  const isRated = asBool(pickFirst(gameData, ["options.isRated"]));
  const missingFields: string[] = [];
  if (typeof mapSlug !== "string" || !mapSlug.trim()) missingFields.push("mapSlug");
  if (typeof mapName !== "string" || !mapName.trim()) missingFields.push("mapName");
  if (isRated === undefined) missingFields.push("isRated");

  const commonBase = {
    gameId: game.gameId,
    status: "ok" as const,
    fetchedAt: Date.now(),
    endpoint,
    gameMode: game.gameMode || game.mode,
    modeFamily: family,
    mapName: typeof mapName === "string" ? mapName : undefined,
    mapSlug: typeof mapSlug === "string" ? mapSlug : undefined,
    isRated,
    missingFields: missingFields.length > 0 ? missingFields : undefined,
    missingFieldsCheckedAt: missingFields.length > 0 ? Date.now() : undefined,
    totalRounds: asNum(gameData?.currentRoundNumber) ?? rounds.length,
    damageMultiplierRounds,
    healingRounds,
    raw: gameData
  };

  const players = orderedPlayers(gameData, ownPlayerId);
  if (family === "teamduels" && ownPlayerId) {
    const p1IdDebug = readPlayerId(players[0]?.player);
    if (p1IdDebug !== ownPlayerId) {
      console.warn("[GeoAnalyzr] TeamDuel ordering mismatch: p1 is not own player.", {
        gameId: game.gameId,
        ownPlayerId,
        p1Id: p1IdDebug,
        orderedIds: players.map((x) => x?.player?.playerId)
      });
    }
  }
  const guessMaps = players.map((x) => guessByRound(x.player));

  const p1 = players[0]?.player;
  const p2 = players[1]?.player;
  const p3 = players[2]?.player;
  const p4 = players[3]?.player;
  const p1Id = readPlayerId(p1);
  const p2Id = readPlayerId(p2);
  const p3Id = readPlayerId(p3);
  const p4Id = readPlayerId(p4);

  const uniqueIds = [...new Set([p1Id, p2Id, p3Id, p4Id].filter((x): x is string => !!x))];
  const profiles = new Map<string, { nick?: string; countryCode?: string; countryName?: string }>();
  await Promise.all(
    uniqueIds.map(async (id) => {
      const p = await getProfile(id, ncfa);
      if (p) profiles.set(id, p);
    })
  );

  const p1Rc = extractRatingChange(p1);
  const p2Rc = extractRatingChange(p2);
  const p3Rc = extractRatingChange(p3);
  const p4Rc = extractRatingChange(p4);

  let detail: GameRow;
  if (family === "teamduels" && teams.length >= 2) {
    const ownTeamId = players[0]?.teamId || String(teams[0]?.id || "");
    const teamOne = teams.find((t: any) => String(t?.id || "") === ownTeamId) || teams[0];
    const teamTwo = teams.find((t: any) => String(t?.id || "") !== String(teamOne?.id || "")) || teams[1];
    const teamOnePlayers = Array.isArray(teamOne?.players) ? teamOne.players : [];
    const teamTwoPlayers = Array.isArray(teamTwo?.players) ? teamTwo.players : [];

    const teamDetail: GameRowTeamDuel = {
      ...commonBase,
      modeFamily: "teamduels",
      date: toIsoDate(startTime),
      time: toIsoTime(startTime),
      gameModeSimple: detectSimpleGameMode(gameData?.movementOptions),
      // role-based aliases
      player_self_id: p1Id,
      player_self_name: (p1Id ? profiles.get(p1Id)?.nick : undefined) ?? (typeof p1?.nick === "string" ? p1.nick : undefined),
      player_self_country: p1Id ? profiles.get(p1Id)?.countryName : undefined,
      player_self_startRating: p1Rc.before,
      player_self_endRating: p1Rc.after,
      player_mate_id: p2Id,
      player_mate_name: (p2Id ? profiles.get(p2Id)?.nick : undefined) ?? (typeof p2?.nick === "string" ? p2.nick : undefined),
      player_mate_country: p2Id ? profiles.get(p2Id)?.countryName : undefined,
      player_mate_startRating: p2Rc.before,
      player_mate_endRating: p2Rc.after,
      player_opponent_id: p3Id,
      player_opponent_name: (p3Id ? profiles.get(p3Id)?.nick : undefined) ?? (typeof p3?.nick === "string" ? p3.nick : undefined),
      player_opponent_country: p3Id ? profiles.get(p3Id)?.countryName : undefined,
      player_opponent_startRating: p3Rc.before,
      player_opponent_endRating: p3Rc.after,
      player_opponent_mate_id: p4Id,
      player_opponent_mate_name: (p4Id ? profiles.get(p4Id)?.nick : undefined) ?? (typeof p4?.nick === "string" ? p4.nick : undefined),
      player_opponent_mate_country: p4Id ? profiles.get(p4Id)?.countryName : undefined,
      player_opponent_mate_startRating: p4Rc.before,
      player_opponent_mate_endRating: p4Rc.after,
      teamOneId: String(teamOne?.id || ""),
      teamOneVictory: winningTeamId ? String(teamOne?.id || "") === winningTeamId : undefined,
      teamOneFinalHealth: asNum(teamOne?.health),
      teamOneStartRating: averageDefined(teamOnePlayers.map((pl: any) => extractRatingChange(pl).before)),
      teamOneEndRating: averageDefined(teamOnePlayers.map((pl: any) => extractRatingChange(pl).after)),
      teamOnePlayerOneId: typeof teamOnePlayers[0]?.playerId === "string" ? teamOnePlayers[0].playerId : undefined,
      teamOnePlayerOneName:
        (typeof teamOnePlayers[0]?.playerId === "string" ? profiles.get(teamOnePlayers[0].playerId)?.nick : undefined) ??
        (typeof teamOnePlayers[0]?.nick === "string" ? teamOnePlayers[0].nick : undefined),
      teamOnePlayerOneCountry:
        typeof teamOnePlayers[0]?.playerId === "string" ? profiles.get(teamOnePlayers[0].playerId)?.countryName : undefined,
      teamOnePlayerTwoId: typeof teamOnePlayers[1]?.playerId === "string" ? teamOnePlayers[1].playerId : undefined,
      teamOnePlayerTwoName:
        (typeof teamOnePlayers[1]?.playerId === "string" ? profiles.get(teamOnePlayers[1].playerId)?.nick : undefined) ??
        (typeof teamOnePlayers[1]?.nick === "string" ? teamOnePlayers[1].nick : undefined),
      teamOnePlayerTwoCountry:
        typeof teamOnePlayers[1]?.playerId === "string" ? profiles.get(teamOnePlayers[1].playerId)?.countryName : undefined,
      teamTwoId: String(teamTwo?.id || ""),
      teamTwoVictory: winningTeamId ? String(teamTwo?.id || "") === winningTeamId : undefined,
      teamTwoFinalHealth: asNum(teamTwo?.health),
      teamTwoStartRating: averageDefined(teamTwoPlayers.map((pl: any) => extractRatingChange(pl).before)),
      teamTwoEndRating: averageDefined(teamTwoPlayers.map((pl: any) => extractRatingChange(pl).after)),
      teamTwoPlayerOneId: typeof teamTwoPlayers[0]?.playerId === "string" ? teamTwoPlayers[0].playerId : undefined,
      teamTwoPlayerOneName:
        (typeof teamTwoPlayers[0]?.playerId === "string" ? profiles.get(teamTwoPlayers[0].playerId)?.nick : undefined) ??
        (typeof teamTwoPlayers[0]?.nick === "string" ? teamTwoPlayers[0].nick : undefined),
      teamTwoPlayerOneCountry:
        typeof teamTwoPlayers[0]?.playerId === "string" ? profiles.get(teamTwoPlayers[0].playerId)?.countryName : undefined,
      teamTwoPlayerTwoId: typeof teamTwoPlayers[1]?.playerId === "string" ? teamTwoPlayers[1].playerId : undefined,
      teamTwoPlayerTwoName:
        (typeof teamTwoPlayers[1]?.playerId === "string" ? profiles.get(teamTwoPlayers[1].playerId)?.nick : undefined) ??
        (typeof teamTwoPlayers[1]?.nick === "string" ? teamTwoPlayers[1].nick : undefined),
      teamTwoPlayerTwoCountry:
        typeof teamTwoPlayers[1]?.playerId === "string" ? profiles.get(teamTwoPlayers[1].playerId)?.countryName : undefined
    };
    detail = teamDetail;
  } else {
    const ownTeamId = players[0]?.teamId || String(teams[0]?.id || "");
    const teamOne = teams.find((t: any) => String(t?.id || "") === ownTeamId) || teams[0];
    const teamTwo = teams.find((t: any) => String(t?.id || "") !== String(teamOne?.id || "")) || teams[1];

    const duelDetail: GameRowDuel = {
      ...commonBase,
      modeFamily: "duels",
      date: toIsoDate(startTime),
      time: toIsoTime(startTime),
      gameModeSimple: detectSimpleGameMode(gameData?.movementOptions),
      // role-based aliases
      player_self_id: p1Id,
      player_self_name: (p1Id ? profiles.get(p1Id)?.nick : undefined) ?? (typeof p1?.nick === "string" ? p1.nick : undefined),
      player_self_country: p1Id ? profiles.get(p1Id)?.countryName : undefined,
      player_self_victory: winningTeamId ? String(teamOne?.id || "") === winningTeamId : undefined,
      player_self_finalHealth: asNum(teamOne?.health),
      player_self_startRating: p1Rc.before,
      player_self_endRating: p1Rc.after,
      player_opponent_id: p2Id,
      player_opponent_name: (p2Id ? profiles.get(p2Id)?.nick : undefined) ?? (typeof p2?.nick === "string" ? p2.nick : undefined),
      player_opponent_country: p2Id ? profiles.get(p2Id)?.countryName : undefined,
      player_opponent_victory: winningTeamId ? String(teamTwo?.id || "") === winningTeamId : undefined,
      player_opponent_finalHealth: asNum(teamTwo?.health),
      player_opponent_startRating: p2Rc.before,
      player_opponent_endRating: p2Rc.after,
      playerOneId: p1Id,
      playerOneName: (p1Id ? profiles.get(p1Id)?.nick : undefined) ?? (typeof p1?.nick === "string" ? p1.nick : undefined),
      playerOneCountry: p1Id ? profiles.get(p1Id)?.countryName : undefined,
      playerOneVictory: winningTeamId ? String(teamOne?.id || "") === winningTeamId : undefined,
      playerOneFinalHealth: asNum(teamOne?.health),
      playerOneStartRating: p1Rc.before,
      playerOneEndRating: p1Rc.after,
      playerTwoId: p2Id,
      playerTwoName: (p2Id ? profiles.get(p2Id)?.nick : undefined) ?? (typeof p2?.nick === "string" ? p2.nick : undefined),
      playerTwoCountry: p2Id ? profiles.get(p2Id)?.countryName : undefined,
      playerTwoVictory: winningTeamId ? String(teamTwo?.id || "") === winningTeamId : undefined,
      playerTwoFinalHealth: asNum(teamTwo?.health),
      playerTwoStartRating: p2Rc.before,
      playerTwoEndRating: p2Rc.after
    };
    detail = duelDetail;
  }

  const normalizedRounds: RoundRow[] = [];
  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    const rn = asNum(r?.roundNumber) ?? i + 1;

    const roundBase = {
      id: roundId(game.gameId, rn),
      gameId: game.gameId,
      roundNumber: rn,
      mapName: commonBase.mapName,
      mapSlug: commonBase.mapSlug,
      isRated: commonBase.isRated,
      trueLat: asNum(r?.panorama?.lat),
      trueLng: asNum(r?.panorama?.lng),
      trueCountry: normalizeIso2(r?.panorama?.countryCode),
      damageMultiplier: asNum(r?.damageMultiplier),
      isHealingRound: Boolean(r?.isHealingRound),
      startTime: toTs(r?.startTime),
      endTime: toTs(r?.endTime),
      durationSeconds: (() => {
        const s = toTs(r?.startTime);
        const e = toTs(r?.endTime);
        return s !== undefined && e !== undefined && e >= s ? (e - s) / 1000 : undefined;
      })(),
      raw: r
    };

    if (family === "teamduels") {
      const round: RoundRowTeamDuel = { ...roundBase, modeFamily: "teamduels" };
      const prev = existingByRoundNumber?.get(rn);
      const roleByPos: Record<number, "player_self" | "player_mate" | "player_opponent" | "player_opponent_mate"> = {
        1: "player_self",
        2: "player_mate",
        3: "player_opponent",
        4: "player_opponent_mate"
      };
      for (let p = 0; p < Math.min(players.length, 4); p++) {
        const playerIndex = p + 1 as 1 | 2 | 3 | 4;
        const { teamId, player, healthMap } = players[p];
        const role = roleByPos[playerIndex];
        const guess = guessMaps[p].get(rn);
        const guessPos = extractGuessLatLng(guess);
        const guessLat = guessPos.lat;
        const guessLng = guessPos.lng;
        const distanceMeters = asNum(guess?.distance);

        (round as any)[`${role}_playerId`] = readPlayerId(player);
        (round as any)[`${role}_teamId`] = teamId || undefined;
        (round as any)[`${role}_guessLat`] = guessLat;
        (round as any)[`${role}_guessLng`] = guessLng;
        (round as any)[`${role}_distanceKm`] = distanceMeters !== undefined ? distanceMeters / 1e3 : undefined;
        const prevCountry = normalizeIso2((prev as any)?.[`${role}_guessCountry`]);
        (round as any)[`${role}_guessCountry`] = extractGuessCountryCode(guess) ?? prevCountry ?? (await resolveGuessCountryFallback(guessLat, guessLng));
        (round as any)[`${role}_score`] = asNum(guess?.score);
        (round as any)[`${role}_healthAfter`] = healthMap.get(rn);
        (round as any)[`${role}_isBestGuess`] = Boolean(guess?.isTeamsBestGuessOnRound);
      }
      normalizedRounds.push(round);
    } else {
      const round: RoundRowDuel = { ...roundBase, modeFamily: "duels" };
      const prev = existingByRoundNumber?.get(rn);
      for (let p = 0; p < Math.min(players.length, 2); p++) {
        const role = p === 0 ? "player_self" : "player_opponent";
        const { player, healthMap } = players[p];
        const guess = guessMaps[p].get(rn);
        const guessPos = extractGuessLatLng(guess);
        const guessLat = guessPos.lat;
        const guessLng = guessPos.lng;
        const distanceMeters = asNum(guess?.distance);

        (round as any)[`${role}_playerId`] = readPlayerId(player);
        (round as any)[`${role}_guessLat`] = guessLat;
        (round as any)[`${role}_guessLng`] = guessLng;
        (round as any)[`${role}_distanceKm`] = distanceMeters !== undefined ? distanceMeters / 1e3 : undefined;
        const prevCountry = normalizeIso2((prev as any)?.[`${role}_guessCountry`]);
        (round as any)[`${role}_guessCountry`] = extractGuessCountryCode(guess) ?? prevCountry ?? (await resolveGuessCountryFallback(guessLat, guessLng));
        (round as any)[`${role}_score`] = asNum(guess?.score);
        (round as any)[`${role}_healthAfter`] = healthMap.get(rn);
      }

      if (typeof round.player_self_healthAfter === "number" && typeof round.player_opponent_healthAfter === "number") {
        round.healthDiffAfter = round.player_self_healthAfter - round.player_opponent_healthAfter;
      }

      normalizedRounds.push(round);
    }
  }

  return { detail, rounds: normalizedRounds };
}

export async function fetchMissingDuelsDetails(opts: {
  onStatus: (msg: string) => void;
  limitGames?: number;
  concurrency?: number;
  retryErrors?: boolean;
  verifyCompleteness?: boolean;
  ncfa?: string;
}) {
  const limitGames = opts.limitGames;
  const recent = typeof limitGames === "number"
    ? await db.games.orderBy("playedAt").reverse().limit(limitGames).toArray()
    : await db.games.orderBy("playedAt").reverse().toArray();

  await fetchDetailsForGames({
    onStatus: opts.onStatus,
    games: recent,
    concurrency: opts.concurrency,
    retryErrors: opts.retryErrors,
    verifyCompleteness: opts.verifyCompleteness,
    ncfa: opts.ncfa,
    reason: "missing-details-scan"
  });
}

export async function fetchDetailsForGames(opts: {
  onStatus: (msg: string) => void;
  games: FeedGameRow[];
  concurrency?: number;
  retryErrors?: boolean;
  verifyCompleteness?: boolean;
  ncfa?: string;
  reason?: string;
}): Promise<{ queued: number; ok: number; fail: number; skipped: number }> {
  const concurrency = opts.concurrency ?? 4;
  const retryErrors = opts.retryErrors ?? true;
  const verifyCompleteness = opts.verifyCompleteness ?? true;
  const reason = opts.reason ? ` (${opts.reason})` : "";

  const ownPlayerId = await getOwnPlayerId();
  opts.onStatus(`Detected own playerId: ${ownPlayerId ?? "not found"}${reason}`);

  const missingRetryAfterMs = 7 * 24 * 60 * 60 * 1000;
  const enrichmentRetryAfterMs = 30 * 24 * 60 * 60 * 1000;

  const candidates = (opts.games || []).filter((g) => {
    const family = classifyFamily(g);
    if (family === "duels" || family === "teamduels") return true;
    const m = String(g.gameMode || g.mode || "").toLowerCase();
    return m.includes("duel");
  });

  if (candidates.length === 0) {
    opts.onStatus(`No duel candidates to fetch.${reason}`);
    return { queued: 0, ok: 0, fail: 0, skipped: 0 };
  }

  const existing = await db.details.bulkGet(candidates.map((g) => g.gameId));

  let roundCountByGame: Map<string, number> | null = null;
  if (verifyCompleteness) {
    const ids = candidates.map((g) => g.gameId);
    const rr = await db.rounds.where("gameId").anyOf(ids).toArray();
    roundCountByGame = new Map<string, number>();
    for (const r of rr as any[]) {
      const gid = typeof r?.gameId === "string" ? r.gameId : "";
      if (!gid) continue;
      roundCountByGame.set(gid, (roundCountByGame.get(gid) || 0) + 1);
    }
  }

  const shouldRefetchForEnrichment = (detail: any): boolean => {
    if (!detail || detail.status !== "ok") return false;
    const missing: string[] = [];
    if (typeof detail.mapSlug !== "string" || !detail.mapSlug.trim()) missing.push("mapSlug");
    if (typeof detail.mapName !== "string" || !detail.mapName.trim()) missing.push("mapName");
    if (typeof detail.isRated !== "boolean") missing.push("isRated");
    if (missing.length === 0) return false;

    const checkedAt = typeof detail.missingFieldsCheckedAt === "number" ? detail.missingFieldsCheckedAt : 0;
    const prevMissing = Array.isArray(detail.missingFields) ? detail.missingFields : [];
    const alreadyKnown = missing.every((m) => prevMissing.includes(m));
    if (alreadyKnown && checkedAt && Date.now() - checkedAt < enrichmentRetryAfterMs) return false;
    return true;
  };

  const queue: FeedGameRow[] = [];
  const markMissing: GameRow[] = [];
  let skipped = 0;

  for (let i = 0; i < candidates.length; i++) {
    const game = candidates[i];
    const detail = existing[i] as any;
    if (!detail) {
      markMissing.push({ gameId: game.gameId, status: "missing", modeFamily: classifyFamily(game), gameMode: game.gameMode || game.mode });
      queue.push(game);
      continue;
    }

    if (detail.status === "ok") {
      if (verifyCompleteness && roundCountByGame) {
        const have = roundCountByGame.get(game.gameId) || 0;
        const expected = detail.totalRounds;
        const incomplete = have === 0 || (typeof expected === "number" && expected > 0 && have < expected);
        if (incomplete) {
          queue.push(game);
          continue;
        }
      }
      if (shouldRefetchForEnrichment(detail)) {
        queue.push(game);
        continue;
      }
      skipped++;
      continue;
    }

    if (detail.status === "missing") {
      const lastTry = detail.fetchedAt || 0;
      const shouldRetry = !lastTry || Date.now() - lastTry >= missingRetryAfterMs;
      if (shouldRetry) queue.push(game);
      else skipped++;
      continue;
    }

    if (retryErrors && detail.status === "error") {
      queue.push(game);
      continue;
    }

    skipped++;
  }

  if (markMissing.length > 0) await db.details.bulkPut(markMissing);
  if (queue.length === 0) {
    opts.onStatus(`No detail fetch needed (skipped ${skipped}).${reason}`);
    return { queued: 0, ok: 0, fail: 0, skipped };
  }

  // Preserve existing per-round fields (e.g. externally resolved guessCountry) when re-fetching details.
  const existingByGameAndRound = new Map<string, Map<number, any>>();
  try {
    const ids = queue.map((g) => g.gameId);
    const existingRounds = await db.rounds.where("gameId").anyOf(ids).toArray();
    for (const r of existingRounds as any[]) {
      const gid = typeof r?.gameId === "string" ? r.gameId : "";
      const rn = typeof r?.roundNumber === "number" ? r.roundNumber : asNum(r?.roundNumber);
      if (!gid || rn === undefined) continue;
      let byRn = existingByGameAndRound.get(gid);
      if (!byRn) {
        byRn = new Map<number, any>();
        existingByGameAndRound.set(gid, byRn);
      }
      byRn.set(rn, r);
    }
  } catch {
    // ignore - enrichment will still work, just without preservation.
  }

  opts.onStatus(`Fetching details for ${queue.length} duel games...${reason}`);
  const total = queue.length;

  let done = 0;
  let ok = 0;
  let fail = 0;
  const startedAt = Date.now();

  async function worker() {
    while (queue.length > 0) {
      const game = queue.shift();
      if (!game) return;

      try {
        const { data, endpoint } = await fetchDetailJson(game, opts.ncfa);
        const prev = existingByGameAndRound.get(game.gameId);
        const normalized = await normalizeGameAndRounds(game, data, endpoint, ownPlayerId, opts.ncfa, prev);

        const agg = computeGameAggFromRounds(game.gameId, normalized.rounds as any[]);

        await db.transaction("rw", db.details, db.rounds, db.gameAgg, async () => {
          await db.details.put(normalized.detail);
          await db.rounds.bulkPut(normalized.rounds);
          await db.gameAgg.put(agg);
        });

        ok++;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const likelyUnavailable = /HTTP (403|404|410)\b/.test(message);
        await db.details.put({
          gameId: game.gameId,
          status: likelyUnavailable ? "missing" : "error",
          fetchedAt: Date.now(),
          gameMode: game.gameMode || game.mode,
          modeFamily: classifyFamily(game),
          error: message
        });
        if (!likelyUnavailable) fail++;
      } finally {
        done++;
        const elapsed = Date.now() - startedAt;
        const rate = done / Math.max(1, elapsed);
        const etaMs = rate > 0 ? (total - done) / rate : 0;
        opts.onStatus(`Details ${done}/${total} (ok ${ok}, fail ${fail}) ETA ~${etaLabel(etaMs)}${reason}`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  opts.onStatus(`Details done. ok=${ok}, fail=${fail}, skipped=${skipped}${reason}`);
  return { queued: total, ok, fail, skipped };
}
