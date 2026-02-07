import Dexie, { Table } from "dexie";

export type GameType = "duels" | "classic" | "other";
export type ModeFamily = "duels" | "teamduels" | "standard" | "streak" | "other";

export interface FeedGameRow {
  gameId: string;     // PK
  type: GameType;
  modeFamily?: ModeFamily;
  playedAt: number;   // unix ms
  mode?: string;      // legacy field
  gameMode?: string;  // raw game mode from feed
  isTeamDuels?: boolean;
  raw?: unknown;
}

interface RoundRowBase {
  id: string;         // PK = `${gameId}:${roundNumber}`
  gameId: string;     // indexed
  roundNumber: number;
  durationSeconds?: number;
  damageMultiplier?: number;
  isHealingRound?: boolean;
  trueLat?: number;
  trueLng?: number;
  trueCountry?: string;
  startTime?: number;
  endTime?: number;
  raw?: unknown;
}

export interface RoundRowDuel extends RoundRowBase {
  modeFamily?: "duels";
  p1_playerId?: string;
  p1_guessLat?: number;
  p1_guessLng?: number;
  p1_guessCountry?: string;
  p1_distanceKm?: number;
  p1_score?: number;
  p1_healthAfter?: number;

  p2_playerId?: string;
  p2_guessLat?: number;
  p2_guessLng?: number;
  p2_guessCountry?: string;
  p2_distanceKm?: number;
  p2_score?: number;
  p2_healthAfter?: number;

  healthDiffAfter?: number;
  // legacy fields kept for compatibility
  guessLat?: number;
  guessLng?: number;
  score?: number;
  distanceMeters?: number;
  timeMs?: number;
}

export interface RoundRowTeamDuel extends RoundRowBase {
  modeFamily?: "teamduels";
  p1_playerId?: string;
  p1_teamId?: string;
  p1_guessLat?: number;
  p1_guessLng?: number;
  p1_guessCountry?: string;
  p1_distanceKm?: number;
  p1_distanceMeters?: number; // legacy compatibility
  p1_score?: number;
  p1_healthAfter?: number;
  p1_isBestGuess?: boolean;

  p2_playerId?: string;
  p2_teamId?: string;
  p2_guessLat?: number;
  p2_guessLng?: number;
  p2_guessCountry?: string;
  p2_distanceKm?: number;
  p2_distanceMeters?: number; // legacy compatibility
  p2_score?: number;
  p2_healthAfter?: number;
  p2_isBestGuess?: boolean;

  p3_playerId?: string;
  p3_teamId?: string;
  p3_guessLat?: number;
  p3_guessLng?: number;
  p3_guessCountry?: string;
  p3_distanceKm?: number;
  p3_distanceMeters?: number; // legacy compatibility
  p3_score?: number;
  p3_healthAfter?: number;
  p3_isBestGuess?: boolean;

  p4_playerId?: string;
  p4_teamId?: string;
  p4_guessLat?: number;
  p4_guessLng?: number;
  p4_guessCountry?: string;
  p4_distanceKm?: number;
  p4_distanceMeters?: number; // legacy compatibility
  p4_score?: number;
  p4_healthAfter?: number;
  p4_isBestGuess?: boolean;
}

export interface RoundRowOther extends RoundRowBase {
  modeFamily?: Exclude<ModeFamily, "duels" | "teamduels">;
}

export type RoundRow = RoundRowDuel | RoundRowTeamDuel | RoundRowOther;

interface GameRowBase {
  gameId: string; // PK
  status: "missing" | "ok" | "error";
  fetchedAt?: number;
  error?: string;
  endpoint?: string;
  modeFamily?: ModeFamily;
  gameMode?: string;
  mapName?: string;
  mapSlug?: string;
  totalRounds?: number;
  damageMultiplierRounds?: number[];
  healingRounds?: number[];
  raw?: unknown;
}

export interface GameRowDuel extends GameRowBase {
  modeFamily?: "duels";
  date?: string;
  time?: string;
  gameModeSimple?: string;

  playerOneId?: string;
  playerOneName?: string;
  playerOneCountry?: string;
  playerOneVictory?: boolean;
  playerOneFinalHealth?: number;
  playerOneStartRating?: number;
  playerOneEndRating?: number;

  playerTwoId?: string;
  playerTwoName?: string;
  playerTwoCountry?: string;
  playerTwoVictory?: boolean;
  playerTwoFinalHealth?: number;
  playerTwoStartRating?: number;
  playerTwoEndRating?: number;
}

export interface GameRowTeamDuel extends GameRowBase {
  modeFamily?: "teamduels";
  date?: string;
  time?: string;
  gameModeSimple?: string;

  teamOneId?: string;
  teamOneVictory?: boolean;
  teamOneFinalHealth?: number;
  teamOneStartRating?: number;
  teamOneEndRating?: number;
  teamOnePlayerOneId?: string;
  teamOnePlayerOneName?: string;
  teamOnePlayerOneCountry?: string;
  teamOnePlayerTwoId?: string;
  teamOnePlayerTwoName?: string;
  teamOnePlayerTwoCountry?: string;

  teamTwoId?: string;
  teamTwoVictory?: boolean;
  teamTwoFinalHealth?: number;
  teamTwoStartRating?: number;
  teamTwoEndRating?: number;
  teamTwoPlayerOneId?: string;
  teamTwoPlayerOneName?: string;
  teamTwoPlayerOneCountry?: string;
  teamTwoPlayerTwoId?: string;
  teamTwoPlayerTwoName?: string;
  teamTwoPlayerTwoCountry?: string;
}

export interface GameRowStandard extends GameRowBase {
  modeFamily?: "standard";
  gameNumber?: number;
  date?: string;
  clock?: string;
  points?: number;
  gameToken?: string;
}

export interface GameRowStreak extends GameRowBase {
  modeFamily?: "streak";
  gameNumber?: number;
  date?: string;
  clock?: string;
  points?: number;
  gameToken?: string;
}

export interface GameRowOther extends GameRowBase {
  modeFamily?: "other";
  isTeamDuels?: boolean;
  startTime?: number;
  // legacy fields kept for compatibility during migration
  p1_playerId?: string;
  p1_playerName?: string;
  p1_ratingBefore?: number;
  p1_ratingAfter?: number;
  p2_playerId?: string;
  p2_playerName?: string;
  p2_ratingBefore?: number;
  p2_ratingAfter?: number;
  p3_playerId?: string;
  p3_playerName?: string;
  p3_ratingBefore?: number;
  p3_ratingAfter?: number;
  p4_playerId?: string;
  p4_playerName?: string;
  p4_ratingBefore?: number;
  p4_ratingAfter?: number;
  playerOneVictory?: boolean;
  playerOneFinalHealth?: number;
  playerTwoVictory?: boolean;
  playerTwoFinalHealth?: number;
  gameModeSimple?: string;
}

export type GameRow =
  | GameRowDuel
  | GameRowTeamDuel
  | GameRowStandard
  | GameRowStreak
  | GameRowOther;

export interface LegacyDetailsRowCompat {
  gameId: string; // PK
  status: "missing" | "ok" | "error";
  fetchedAt?: number;
  error?: string;
  endpoint?: string;
  gameMode?: string;
  modeFamily?: ModeFamily;
  isTeamDuels?: boolean;
  mapName?: string;
  mapSlug?: string;
  totalRounds?: number;
  startTime?: number;
  p1_playerId?: string;
  p1_playerName?: string;
  p1_ratingBefore?: number;
  p1_ratingAfter?: number;
  p2_playerId?: string;
  p2_playerName?: string;
  p2_ratingBefore?: number;
  p2_ratingAfter?: number;
  p3_playerId?: string;
  p3_playerName?: string;
  p3_ratingBefore?: number;
  p3_ratingAfter?: number;
  p4_playerId?: string;
  p4_playerName?: string;
  p4_ratingBefore?: number;
  p4_ratingAfter?: number;
  playerOneVictory?: boolean;
  playerOneFinalHealth?: number;
  playerTwoVictory?: boolean;
  playerTwoFinalHealth?: number;
  damageMultiplierRounds?: number[];
  healingRounds?: number[];
  gameModeSimple?: string;
  raw?: unknown;
}

export interface MetaRow {
  key: string;        // PK e.g. "sync"
  value: unknown;
  updatedAt: number;
}

export class GGDB extends Dexie {
  games!: Table<FeedGameRow, string>;
  rounds!: Table<RoundRow, string>;
  details!: Table<GameRow, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super("gg_analyzer_db");

    // v1 (old)
    this.version(1).stores({
      games: "gameId, playedAt, type, mode",
      rounds: "id, gameId, roundNumber",
      meta: "key, updatedAt"
    });

    // v2 (add details table)
    this.version(2).stores({
      games: "gameId, playedAt, type, mode",
      rounds: "id, gameId, roundNumber",
      details: "gameId, status, fetchedAt",
      meta: "key, updatedAt"
    });

    // v3: expanded mode and normalized round/detail fields
    this.version(3).stores({
      games: "gameId, playedAt, type, mode, gameMode, modeFamily, isTeamDuels",
      rounds: "id, gameId, roundNumber, [gameId+roundNumber]",
      details: "gameId, status, fetchedAt, modeFamily, isTeamDuels",
      meta: "key, updatedAt"
    });
  }
}

export const db = new GGDB();
