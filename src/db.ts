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

// Add to RoundRowBase (recommended)
interface RoundRowBase {
  id: string;
  gameId: string;
  roundNumber: number;

  playedAt?: number; // copied from FeedGameRow.playedAt
  movementType?: "moving" | "no_move" | "nmpz" | "unknown";

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
  player_self_playerId?: string;
  player_self_guessLat?: number;
  player_self_guessLng?: number;
  player_self_guessCountry?: string;
  player_self_distanceKm?: number;
  player_self_score?: number;
  player_self_healthAfter?: number;

  player_opponent_playerId?: string;
  player_opponent_guessLat?: number;
  player_opponent_guessLng?: number;
  player_opponent_guessCountry?: string;
  player_opponent_distanceKm?: number;
  player_opponent_score?: number;
  player_opponent_healthAfter?: number;

  healthDiffAfter?: number;
}

export interface RoundRowTeamDuel extends RoundRowBase {
  modeFamily?: "teamduels";
  player_self_playerId?: string;
  player_self_teamId?: string;
  player_self_guessLat?: number;
  player_self_guessLng?: number;
  player_self_guessCountry?: string;
  player_self_distanceKm?: number;
  player_self_score?: number;
  player_self_healthAfter?: number;
  player_self_isBestGuess?: boolean;

  player_mate_playerId?: string;
  player_mate_teamId?: string;
  player_mate_guessLat?: number;
  player_mate_guessLng?: number;
  player_mate_guessCountry?: string;
  player_mate_distanceKm?: number;
  player_mate_score?: number;
  player_mate_healthAfter?: number;
  player_mate_isBestGuess?: boolean;

  player_opponent_playerId?: string;
  player_opponent_teamId?: string;
  player_opponent_guessLat?: number;
  player_opponent_guessLng?: number;
  player_opponent_guessCountry?: string;
  player_opponent_distanceKm?: number;
  player_opponent_score?: number;
  player_opponent_healthAfter?: number;
  player_opponent_isBestGuess?: boolean;

  player_opponent_mate_playerId?: string;
  player_opponent_mate_teamId?: string;
  player_opponent_mate_guessLat?: number;
  player_opponent_mate_guessLng?: number;
  player_opponent_mate_guessCountry?: string;
  player_opponent_mate_distanceKm?: number;
  player_opponent_mate_score?: number;
  player_opponent_mate_healthAfter?: number;
  player_opponent_mate_isBestGuess?: boolean;
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
  isRated?: boolean;
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

  // role-based aliases (preferred)
  player_self_id?: string;
  player_self_name?: string;
  player_self_country?: string;
  player_self_victory?: boolean;
  player_self_finalHealth?: number;
  player_self_startRating?: number;
  player_self_endRating?: number;
  player_opponent_id?: string;
  player_opponent_name?: string;
  player_opponent_country?: string;
  player_opponent_victory?: boolean;
  player_opponent_finalHealth?: number;
  player_opponent_startRating?: number;
  player_opponent_endRating?: number;

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

  // role-based aliases (preferred)
  player_self_id?: string;
  player_self_name?: string;
  player_self_country?: string;
  player_self_startRating?: number;
  player_self_endRating?: number;
  player_mate_id?: string;
  player_mate_name?: string;
  player_mate_country?: string;
  player_mate_startRating?: number;
  player_mate_endRating?: number;
  player_opponent_id?: string;
  player_opponent_name?: string;
  player_opponent_country?: string;
  player_opponent_startRating?: number;
  player_opponent_endRating?: number;
  player_opponent_mate_id?: string;
  player_opponent_mate_name?: string;
  player_opponent_mate_country?: string;
  player_opponent_mate_startRating?: number;
  player_opponent_mate_endRating?: number;

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

// Convenience "fact" row for analytics (feed + details merged, with a stable time field).
export type GameFactRow = FeedGameRow & Partial<GameRow> & { ts?: number; result?: "Win" | "Loss" };

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

    // In GGDB constructor:
    this.version(4).stores({
      games: "gameId, playedAt, type, mode, gameMode, modeFamily, isTeamDuels",
      rounds: [
        "id",
        "gameId",
        "roundNumber",
        "[gameId+roundNumber]",
        "playedAt",
        "trueCountry",
        "movementType",
        "player_self_score"
      ].join(", "),
      details: [
        "gameId",
        "status",
        "fetchedAt",
        "modeFamily",
        "isTeamDuels",
        "player_self_id",
        "player_mate_id",
        "player_opponent_country"
      ].join(", "),
      meta: "key, updatedAt"
    });
  }
}

export const db = new GGDB();
