import Dexie, { Table } from "dexie";

export const DB_V2_NAME = "gg_analyzer_v2";
export type ModeFamily = "duels" | "teamduels" | "standard" | "streak" | "other";
export type MovementType = "moving" | "no_move" | "nmpz";
export type DetailFetchStatus = "ok" | "not_found" | "error" | "timeout";

/**
 * Normalization version stamp for GameRow.
 * Bump this constant whenever new fields are extracted from rawGameDetails.
 * Games where (normalizeVersion ?? 0) < CURRENT_NORMALIZE_VERSION are
 * automatically re-normalized on the next fetch cycle (cache-first, no API).
 *
 * History:
 *  0 (implicit) — original fields only
 *  1 — initial versioning marker (no new fields, baseline)
 *  2 — panoId, truePitch/Zoom, timeSec, timedOut, healthBefore, damageDealt,
 *      initialHealth, winnerStyle
 *  3 — truePitch/trueZoom for classic rounds
 */
export const CURRENT_NORMALIZE_VERSION = 3;

// ─── Processed: Games ────────────────────────────────────────────────────────

export interface GameRow {
  gameId: string;          // PK
  playedAt: number;        // unix ms (from feed)
  modeFamily: ModeFamily;
  mapSlug?: string;
  mapName?: string;
  movementType?: MovementType | "mixed";
  isRated?: boolean;
  totalRounds?: number;
  durationSec?: number;
  detailFetchedAt?: number; // null/undefined = details not yet fetched
  /** Which normalization pass last wrote to this row (undefined = 0 = pre-versioning). */
  normalizeVersion?: number;
  /** Duels/teamduels: starting health per player (options.initialHealth). */
  initialHealth?: number;
  /** Duels/teamduels: 'Victory' | 'ComebackVictory' from result.winnerStyle. */
  winnerStyle?: string;

  // Players in flat API order:
  //   Duels:     p1=teams[0].players[0], p2=teams[1].players[0]
  //   Teamduels: p1=teams[0].players[0], p2=teams[0].players[1], p3=teams[1].players[0], p4=teams[1].players[1]
  //   Solo/other: p1=the player
  p1Id?: string;
  p1Name?: string;
  p1Country?: string;   // ISO2
  p1Score?: number;     // duels: final health; solo: total score

  // P1 ratings (duels / teamduels)
  p1RatingBefore?: number;
  p1RatingAfter?: number;
  p1MovingRatingBefore?: number;
  p1MovingRatingAfter?: number;
  p1NoMoveRatingBefore?: number;
  p1NoMoveRatingAfter?: number;
  p1NmpzRatingBefore?: number;
  p1NmpzRatingAfter?: number;

  // P2: duels = team[1] player; teamduels = team[0] second player (p1's teammate)
  p2Id?: string;
  p2Name?: string;
  p2Country?: string;
  p2RatingBefore?: number;
  p2RatingAfter?: number;
  // Mode ratings: duels p2 (opponent) gets mode ratings; teamduels p2 (teammate) gets none
  p2MovingRatingBefore?: number;
  p2MovingRatingAfter?: number;
  p2NoMoveRatingBefore?: number;
  p2NoMoveRatingAfter?: number;
  p2NmpzRatingBefore?: number;
  p2NmpzRatingAfter?: number;

  // P3: teamduels = team[1] first player; undefined for duels
  p3Id?: string;
  p3Name?: string;
  p3Country?: string;
  p3RatingBefore?: number;
  p3RatingAfter?: number;
  p3MovingRatingBefore?: number;
  p3MovingRatingAfter?: number;
  p3NoMoveRatingBefore?: number;
  p3NoMoveRatingAfter?: number;
  p3NmpzRatingBefore?: number;
  p3NmpzRatingAfter?: number;

  // P4: teamduels = team[1] second player; undefined for duels
  p4Id?: string;
  p4Name?: string;
  p4Country?: string;
  p4RatingBefore?: number;
  p4RatingAfter?: number;

  // 0 = teams[0] won, 1 = teams[1] won (undefined if unknown)
  winnerTeamIdx?: number;
}

// ─── Processed: Rounds ───────────────────────────────────────────────────────

export interface RoundRow {
  gameId: string;       // composite PK part 1
  roundNumber: number;  // composite PK part 2
  startTime?: number;   // unix ms, when this round began
  durationSec?: number;
  movementType?: MovementType;
  damageMultiplier?: number;
  isHealing?: boolean;

  // True location
  trueLat?: number;
  trueLng?: number;
  trueHeadingDeg?: number;
  trueCountry?: string; // ISO2, from API
  panoId?: string;
  truePitch?: number;
  trueZoom?: number;

  // Player guesses in flat API order:
  //   Duels:     p1=teams[0].players[0], p2=teams[1].players[0]
  //   Teamduels: p1=teams[0].players[0], p2=teams[0].players[1], p3=teams[1].players[0], p4=teams[1].players[1]
  p1Lat?: number;
  p1Lng?: number;
  p1Country?: string;
  p1Score?: number;
  p1Distance?: number; // km
  p1TimeSec?: number;
  p1TimedOut?: boolean;
  p1IsBetterGuess?: boolean; // teamduels: p1's guess was the used guess for team[0]

  p2Lat?: number;
  p2Lng?: number;
  p2Country?: string;
  p2Score?: number;
  p2Distance?: number; // km
  p2TimeSec?: number;
  p2TimedOut?: boolean;
  p2IsBetterGuess?: boolean; // teamduels: p2's guess was the used guess for team[0]

  p3Lat?: number;
  p3Lng?: number;
  p3Country?: string;
  p3Score?: number;
  p3Distance?: number; // km
  p3TimeSec?: number;
  p3TimedOut?: boolean;
  p3IsBetterGuess?: boolean; // teamduels: p3's guess was the used guess for team[1]

  p4Lat?: number;
  p4Lng?: number;
  p4Country?: string;
  p4Score?: number;
  p4Distance?: number; // km
  p4IsBetterGuess?: boolean; // teamduels: p4's guess was the used guess for team[1]

  // Team health (indexed by team position in API teams array)
  team0HealthBefore?: number;
  team0HealthAfter?: number;
  team0DamageDealt?: number;
  team1HealthBefore?: number;
  team1HealthAfter?: number;
  team1DamageDealt?: number;
}

// ─── Processed: Classic games ────────────────────────────────────────────────

export interface ClassicGameRow {
  gameId: string;          // PK (= token)
  playerId: string;
  playedAt?: number;       // unix ms, from rounds[0].startTime
  mapId?: string;          // game.map (opaque ID)
  mapName?: string;
  movement?: MovementType;
  timeLimit?: number;      // seconds, 0 = no limit
  roundCount?: number;
  totalScore?: number;
  totalDistanceM?: number;
  totalTimeSec?: number;
  totalSteps?: number;
  detailFetchedAt?: number;
}

export interface ClassicRoundRow {
  gameId: string;          // composite PK part 1
  roundNumber: number;     // composite PK part 2 (1-based)
  playedAt?: number;       // startTime of this round, unix ms
  trueLat?: number;
  trueLng?: number;
  trueHeadingDeg?: number;
  trueCountry?: string;    // ISO2
  panoId?: string;         // Street View panorama ID
  truePitch?: number;
  trueZoom?: number;
  selfLat?: number;
  selfLng?: number;
  selfCountry?: string;    // ISO2, reverse-geocoded from selfLat/selfLng
  selfScore?: number;
  selfDistance?: number;   // km
  selfTimeSec?: number;
  selfSteps?: number;
  timedOut?: boolean;
  skippedRound?: boolean;
}

// ─── Raw storage (never modified after write) ─────────────────────────────────

export interface RawFeedEntry {
  gameId: string;    // PK
  fetchedAt: number;
  json: unknown;     // raw API response entry, unmodified
}

export interface RawGameDetail {
  gameId: string;    // PK
  fetchedAt: number;
  endpoint: string;  // which URL succeeded
  json: unknown;     // raw API response, unmodified
}

// ─── Detail fetch tracking (audit / error analysis) ──────────────────────────

export interface DetailFetchLog {
  gameId: string;           // PK
  attempts: number;
  lastAttemptAt: number;
  lastStatus: DetailFetchStatus;
  lastError?: string;
  endpoint?: string;        // last endpoint tried
}

// ─── Sync state (replaces meta) ───────────────────────────────────────────────

export interface SyncStateRow {
  key: string;     // PK
  value: unknown;
  updatedAt: number;
}

// ─── Dexie DB ─────────────────────────────────────────────────────────────────

export class GGDB_V2 extends Dexie {
  games!: Table<GameRow, string>;
  rounds!: Table<RoundRow, [string, number]>;
  classicGames!: Table<ClassicGameRow, string>;
  classicRounds!: Table<ClassicRoundRow, [string, number]>;
  rawFeedEntries!: Table<RawFeedEntry, string>;
  rawGameDetails!: Table<RawGameDetail, string>;
  detailFetchLog!: Table<DetailFetchLog, string>;
  syncState!: Table<SyncStateRow, string>;

  constructor(name: string = DB_V2_NAME) {
    super(name);

    const GAMES_SCHEMA_V1 = [
      "gameId", "playedAt", "modeFamily", "[modeFamily+playedAt]",
      "selfVictory", "selfId", "oppId", "detailFetchedAt",
    ].join(", ");

    const GAMES_SCHEMA_V4 = [
      "gameId", "playedAt", "modeFamily", "[modeFamily+playedAt]",
      "p1Id", "p2Id", "winnerTeamIdx", "detailFetchedAt",
    ].join(", ");

    const ROUNDS_SCHEMA_V1 = [
      "[gameId+roundNumber]", "gameId", "startTime", "trueCountry", "selfGuessCountry", "movementType",
    ].join(", ");

    const ROUNDS_SCHEMA_V2 = [
      "[gameId+roundNumber]", "gameId", "startTime", "trueCountry", "selfCountry", "movementType",
    ].join(", ");

    const ROUNDS_SCHEMA_V4 = [
      "[gameId+roundNumber]", "gameId", "startTime", "trueCountry", "movementType",
    ].join(", ");

    const DETAIL_LOG_SCHEMA = ["gameId", "lastAttemptAt", "lastStatus"].join(", ");

    this.version(1).stores({
      games: GAMES_SCHEMA_V1,
      rounds: ROUNDS_SCHEMA_V1,
      rawFeedEntries: "gameId, fetchedAt",
      rawGameDetails: "gameId, fetchedAt",
      detailFetchLog: DETAIL_LOG_SCHEMA,
      syncState: "key",
    });

    const CLASSIC_GAMES_SCHEMA = ["gameId", "playerId", "playedAt", "[playerId+playedAt]"].join(", ");
    const CLASSIC_ROUNDS_SCHEMA = ["[gameId+roundNumber]", "gameId"].join(", ");

    this.version(2).stores({
      games: GAMES_SCHEMA_V1,
      rounds: ROUNDS_SCHEMA_V2,
      rawFeedEntries: "gameId, fetchedAt",
      rawGameDetails: "gameId, fetchedAt",
      detailFetchLog: DETAIL_LOG_SCHEMA,
      syncState: "key",
    }).upgrade((tx) => {
      return tx.table("rounds").toCollection().modify((r) => {
        if ("selfGuessLat"       in r) { r.selfLat       = r.selfGuessLat;       delete r.selfGuessLat; }
        if ("selfGuessLng"       in r) { r.selfLng       = r.selfGuessLng;       delete r.selfGuessLng; }
        if ("selfGuessCountry"   in r) { r.selfCountry   = r.selfGuessCountry;   delete r.selfGuessCountry; }
        if ("selfDistanceKm"     in r) { r.selfDistance  = r.selfDistanceKm;     delete r.selfDistanceKm; }
        if ("oppGuessLat"        in r) { r.oppLat        = r.oppGuessLat;        delete r.oppGuessLat; }
        if ("oppGuessLng"        in r) { r.oppLng        = r.oppGuessLng;        delete r.oppGuessLng; }
        if ("oppGuessCountry"    in r) { r.oppCountry    = r.oppGuessCountry;    delete r.oppGuessCountry; }
        if ("oppDistanceKm"      in r) { r.oppDistance   = r.oppDistanceKm;      delete r.oppDistanceKm; }
        if ("mateGuessLat"       in r) { r.mateLat       = r.mateGuessLat;       delete r.mateGuessLat; }
        if ("mateGuessLng"       in r) { r.mateLng       = r.mateGuessLng;       delete r.mateGuessLng; }
        if ("mateGuessCountry"   in r) { r.mateCountry   = r.mateGuessCountry;   delete r.mateGuessCountry; }
        if ("mateDistanceKm"     in r) { r.mateDistance  = r.mateDistanceKm;     delete r.mateDistanceKm; }
        if ("oppMateGuessLat"    in r) { r.oppMateLat    = r.oppMateGuessLat;    delete r.oppMateGuessLat; }
        if ("oppMateGuessLng"    in r) { r.oppMateLng    = r.oppMateGuessLng;    delete r.oppMateGuessLng; }
        if ("oppMateGuessCountry" in r) { r.oppMateCountry = r.oppMateGuessCountry; delete r.oppMateGuessCountry; }
        if ("oppMateDistanceKm"  in r) { r.oppMateDistance = r.oppMateDistanceKm; delete r.oppMateDistanceKm; }
        if ("isHealingRound"     in r) { r.isHealing     = r.isHealingRound;     delete r.isHealingRound; }
      });
    });

    this.version(3).stores({
      games: GAMES_SCHEMA_V1,
      rounds: ROUNDS_SCHEMA_V2,
      classicGames: CLASSIC_GAMES_SCHEMA,
      classicRounds: CLASSIC_ROUNDS_SCHEMA,
      rawFeedEntries: "gameId, fetchedAt",
      rawGameDetails: "gameId, fetchedAt",
      detailFetchLog: DETAIL_LOG_SCHEMA,
      syncState: "key",
    });

    this.version(4).stores({
      games: GAMES_SCHEMA_V4,
      rounds: ROUNDS_SCHEMA_V4,
      classicGames: CLASSIC_GAMES_SCHEMA,
      classicRounds: CLASSIC_ROUNDS_SCHEMA,
      rawFeedEntries: "gameId, fetchedAt",
      rawGameDetails: "gameId, fetchedAt",
      detailFetchLog: DETAIL_LOG_SCHEMA,
      syncState: "key",
    }).upgrade(async (tx) => {
      // Rename game fields: self→p1, opp→p2 (duels) or keep as-is for teamduels
      await tx.table("games").toCollection().modify((g: any) => {
        // selfId/selfVictory → p1Id/winnerTeamIdx (best-effort: old data had self at p1 slot)
        if ("selfId"      in g) { g.p1Id      = g.selfId;      delete g.selfId; }
        if ("selfName"    in g) { g.p1Name    = g.selfName;    delete g.selfName; }
        if ("selfCountry" in g) { g.p1Country = g.selfCountry; delete g.selfCountry; }
        if ("selfScore"   in g) { g.p1Score   = g.selfScore;   delete g.selfScore; }
        if ("selfVictory" in g) {
          // Old: selfVictory=true means self (p1) won; in v4: winnerTeamIdx=0 means team[0] won
          // Self was forced to team[0] in orderedPlayers, so selfVictory=true → winnerTeamIdx=0
          if (g.selfVictory === true)  g.winnerTeamIdx = 0;
          if (g.selfVictory === false) g.winnerTeamIdx = 1;
          delete g.selfVictory;
        }
        if ("selfRatingBefore"        in g) { g.p1RatingBefore        = g.selfRatingBefore;        delete g.selfRatingBefore; }
        if ("selfRatingAfter"         in g) { g.p1RatingAfter         = g.selfRatingAfter;          delete g.selfRatingAfter; }
        if ("selfMovingRatingBefore"  in g) { g.p1MovingRatingBefore  = g.selfMovingRatingBefore;  delete g.selfMovingRatingBefore; }
        if ("selfMovingRatingAfter"   in g) { g.p1MovingRatingAfter   = g.selfMovingRatingAfter;   delete g.selfMovingRatingAfter; }
        if ("selfNoMoveRatingBefore"  in g) { g.p1NoMoveRatingBefore  = g.selfNoMoveRatingBefore;  delete g.selfNoMoveRatingBefore; }
        if ("selfNoMoveRatingAfter"   in g) { g.p1NoMoveRatingAfter   = g.selfNoMoveRatingAfter;   delete g.selfNoMoveRatingAfter; }
        if ("selfNmpzRatingBefore"    in g) { g.p1NmpzRatingBefore    = g.selfNmpzRatingBefore;    delete g.selfNmpzRatingBefore; }
        if ("selfNmpzRatingAfter"     in g) { g.p1NmpzRatingAfter     = g.selfNmpzRatingAfter;     delete g.selfNmpzRatingAfter; }

        // duels: opp→p2; teamduels: mate→p2, opp→p3, oppMate→p4
        if (g.modeFamily === "duels") {
          if ("oppId"      in g) { g.p2Id      = g.oppId;      delete g.oppId; }
          if ("oppName"    in g) { g.p2Name    = g.oppName;    delete g.oppName; }
          if ("oppCountry" in g) { g.p2Country = g.oppCountry; delete g.oppCountry; }
          if ("oppRatingBefore"        in g) { g.p2RatingBefore        = g.oppRatingBefore;        delete g.oppRatingBefore; }
          if ("oppRatingAfter"         in g) { g.p2RatingAfter         = g.oppRatingAfter;          delete g.oppRatingAfter; }
          if ("oppMovingRatingBefore"  in g) { g.p2MovingRatingBefore  = g.oppMovingRatingBefore;  delete g.oppMovingRatingBefore; }
          if ("oppMovingRatingAfter"   in g) { g.p2MovingRatingAfter   = g.oppMovingRatingAfter;   delete g.oppMovingRatingAfter; }
          if ("oppNoMoveRatingBefore"  in g) { g.p2NoMoveRatingBefore  = g.oppNoMoveRatingBefore;  delete g.oppNoMoveRatingBefore; }
          if ("oppNoMoveRatingAfter"   in g) { g.p2NoMoveRatingAfter   = g.oppNoMoveRatingAfter;   delete g.oppNoMoveRatingAfter; }
          if ("oppNmpzRatingBefore"    in g) { g.p2NmpzRatingBefore    = g.oppNmpzRatingBefore;    delete g.oppNmpzRatingBefore; }
          if ("oppNmpzRatingAfter"     in g) { g.p2NmpzRatingAfter     = g.oppNmpzRatingAfter;     delete g.oppNmpzRatingAfter; }
        } else if (g.modeFamily === "teamduels") {
          if ("mateId"      in g) { g.p2Id      = g.mateId;      delete g.mateId; }
          if ("mateName"    in g) { g.p2Name    = g.mateName;    delete g.mateName; }
          if ("mateCountry" in g) { g.p2Country = g.mateCountry; delete g.mateCountry; }
          if ("mateRatingBefore" in g) { g.p2RatingBefore = g.mateRatingBefore; delete g.mateRatingBefore; }
          if ("mateRatingAfter"  in g) { g.p2RatingAfter  = g.mateRatingAfter;  delete g.mateRatingAfter; }
          if ("oppId"      in g) { g.p3Id      = g.oppId;      delete g.oppId; }
          if ("oppName"    in g) { g.p3Name    = g.oppName;    delete g.oppName; }
          if ("oppCountry" in g) { g.p3Country = g.oppCountry; delete g.oppCountry; }
          if ("oppRatingBefore"        in g) { g.p3RatingBefore        = g.oppRatingBefore;        delete g.oppRatingBefore; }
          if ("oppRatingAfter"         in g) { g.p3RatingAfter         = g.oppRatingAfter;          delete g.oppRatingAfter; }
          if ("oppMovingRatingBefore"  in g) { g.p3MovingRatingBefore  = g.oppMovingRatingBefore;  delete g.oppMovingRatingBefore; }
          if ("oppMovingRatingAfter"   in g) { g.p3MovingRatingAfter   = g.oppMovingRatingAfter;   delete g.oppMovingRatingAfter; }
          if ("oppNoMoveRatingBefore"  in g) { g.p3NoMoveRatingBefore  = g.oppNoMoveRatingBefore;  delete g.oppNoMoveRatingBefore; }
          if ("oppNoMoveRatingAfter"   in g) { g.p3NoMoveRatingAfter   = g.oppNoMoveRatingAfter;   delete g.oppNoMoveRatingAfter; }
          if ("oppNmpzRatingBefore"    in g) { g.p3NmpzRatingBefore    = g.oppNmpzRatingBefore;    delete g.oppNmpzRatingBefore; }
          if ("oppNmpzRatingAfter"     in g) { g.p3NmpzRatingAfter     = g.oppNmpzRatingAfter;     delete g.oppNmpzRatingAfter; }
          if ("oppMateId"      in g) { g.p4Id      = g.oppMateId;      delete g.oppMateId; }
          if ("oppMateName"    in g) { g.p4Name    = g.oppMateName;    delete g.oppMateName; }
          if ("oppMateCountry" in g) { g.p4Country = g.oppMateCountry; delete g.oppMateCountry; }
          if ("oppMateRatingBefore" in g) { g.p4RatingBefore = g.oppMateRatingBefore; delete g.oppMateRatingBefore; }
          if ("oppMateRatingAfter"  in g) { g.p4RatingAfter  = g.oppMateRatingAfter;  delete g.oppMateRatingAfter; }
        }
      });

      // Rename round fields
      await tx.table("rounds").toCollection().modify((r: any) => {
        if ("selfLat"          in r) { r.p1Lat         = r.selfLat;          delete r.selfLat; }
        if ("selfLng"          in r) { r.p1Lng         = r.selfLng;          delete r.selfLng; }
        if ("selfCountry"      in r) { r.p1Country     = r.selfCountry;      delete r.selfCountry; }
        if ("selfScore"        in r) { r.p1Score       = r.selfScore;        delete r.selfScore; }
        if ("selfDistance"     in r) { r.p1Distance    = r.selfDistance;     delete r.selfDistance; }
        if ("selfTimeSec"      in r) { r.p1TimeSec     = r.selfTimeSec;      delete r.selfTimeSec; }
        if ("selfTimedOut"     in r) { r.p1TimedOut    = r.selfTimedOut;     delete r.selfTimedOut; }
        if ("selfIsBetterGuess" in r) { r.p1IsBetterGuess = r.selfIsBetterGuess; delete r.selfIsBetterGuess; }
        if ("selfHealthAfter"  in r) { r.team0HealthAfter  = r.selfHealthAfter;  delete r.selfHealthAfter; }
        if ("selfHealthBefore" in r) { r.team0HealthBefore = r.selfHealthBefore; delete r.selfHealthBefore; }
        if ("selfDamageDealt"  in r) { r.team0DamageDealt  = r.selfDamageDealt;  delete r.selfDamageDealt; }

        if ("mateLat"          in r) { r.p2Lat         = r.mateLat;          delete r.mateLat; }
        if ("mateLng"          in r) { r.p2Lng         = r.mateLng;          delete r.mateLng; }
        if ("mateCountry"      in r) { r.p2Country     = r.mateCountry;      delete r.mateCountry; }
        if ("mateScore"        in r) { r.p2Score       = r.mateScore;        delete r.mateScore; }
        if ("mateDistance"     in r) { r.p2Distance    = r.mateDistance;     delete r.mateDistance; }

        if ("oppLat"           in r) { r.p3Lat         = r.oppLat;           delete r.oppLat; }
        if ("oppLng"           in r) { r.p3Lng         = r.oppLng;           delete r.oppLng; }
        if ("oppCountry"       in r) { r.p3Country     = r.oppCountry;       delete r.oppCountry; }
        if ("oppScore"         in r) { r.p3Score       = r.oppScore;         delete r.oppScore; }
        if ("oppDistance"      in r) { r.p3Distance    = r.oppDistance;      delete r.oppDistance; }
        if ("oppTimeSec"       in r) { r.p3TimeSec     = r.oppTimeSec;       delete r.oppTimeSec; }
        if ("oppTimedOut"      in r) { r.p3TimedOut    = r.oppTimedOut;      delete r.oppTimedOut; }
        if ("oppIsBetterGuess" in r) { r.p3IsBetterGuess = r.oppIsBetterGuess; delete r.oppIsBetterGuess; }
        if ("oppHealthAfter"   in r) { r.team1HealthAfter  = r.oppHealthAfter;   delete r.oppHealthAfter; }
        if ("oppHealthBefore"  in r) { r.team1HealthBefore = r.oppHealthBefore;  delete r.oppHealthBefore; }
        if ("oppDamageDealt"   in r) { r.team1DamageDealt  = r.oppDamageDealt;   delete r.oppDamageDealt; }

        if ("oppMateLat"      in r) { r.p4Lat      = r.oppMateLat;      delete r.oppMateLat; }
        if ("oppMateLng"      in r) { r.p4Lng      = r.oppMateLng;      delete r.oppMateLng; }
        if ("oppMateCountry"  in r) { r.p4Country  = r.oppMateCountry;  delete r.oppMateCountry; }
        if ("oppMateScore"    in r) { r.p4Score    = r.oppMateScore;    delete r.oppMateScore; }
        if ("oppMateDistance" in r) { r.p4Distance = r.oppMateDistance; delete r.oppMateDistance; }
      });
    });
  }
}

export const dbV2 = new GGDB_V2();

// ─── Sync state helpers ───────────────────────────────────────────────────────

export async function getSyncState<T>(key: string): Promise<T | undefined> {
  const row = await dbV2.syncState.get(key);
  return row?.value as T | undefined;
}

export async function setSyncState(key: string, value: unknown): Promise<void> {
  await dbV2.syncState.put({ key, value, updatedAt: Date.now() });
}
