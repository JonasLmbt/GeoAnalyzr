import Dexie, { Table } from "dexie";

export const DB_V2_NAME = "gg_analyzer_v2";
export type ModeFamily = "duels" | "teamduels" | "standard" | "streak" | "other";
export type MovementType = "moving" | "no_move" | "nmpz";
export type DetailFetchStatus = "ok" | "not_found" | "error" | "timeout";

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

  // Self (all game types)
  selfId?: string;
  selfName?: string;
  selfCountry?: string;   // ISO2
  selfScore?: number;     // duels: final health; solo: total score
  selfVictory?: boolean;  // duels: win/loss; solo: undefined

  // Ratings (duels / teamduels)
  selfRatingBefore?: number;
  selfRatingAfter?: number;

  // Opponent (duels / teamduels)
  oppId?: string;
  oppName?: string;
  oppCountry?: string;
  oppRatingBefore?: number;
  oppRatingAfter?: number;

  // Teammate (teamduels only)
  mateId?: string;
  mateName?: string;
  mateCountry?: string;
  mateRatingBefore?: number;
  mateRatingAfter?: number;

  // Opponent's teammate (teamduels only)
  oppMateId?: string;
  oppMateName?: string;
  oppMateCountry?: string;
  oppMateRatingBefore?: number;
  oppMateRatingAfter?: number;
}

// ─── Processed: Rounds ───────────────────────────────────────────────────────

export interface RoundRow {
  gameId: string;       // composite PK part 1
  roundNumber: number;  // composite PK part 2
  startTime?: number;   // unix ms, when this round began
  durationSec?: number;
  movementType?: MovementType;

  // True location
  trueLat?: number;
  trueLng?: number;
  trueCountry?: string; // ISO2, from API

  // Self guess
  selfGuessLat?: number;
  selfGuessLng?: number;
  selfGuessCountry?: string; // ISO2, derived from coordinates client-side
  selfScore?: number;
  selfDistanceKm?: number;
  selfTimeSec?: number;

  // Opponent (duels / teamduels)
  oppGuessLat?: number;
  oppGuessLng?: number;
  oppGuessCountry?: string;
  oppScore?: number;
  oppDistanceKm?: number;

  // Teammate (teamduels)
  mateGuessLat?: number;
  mateGuessLng?: number;
  mateGuessCountry?: string;
  mateScore?: number;
  mateDistanceKm?: number;

  // Opponent's teammate (teamduels)
  oppMateGuessLat?: number;
  oppMateGuessLng?: number;
  oppMateGuessCountry?: string;
  oppMateScore?: number;
  oppMateDistanceKm?: number;

  // Duel health progression
  selfHealthAfter?: number;
  oppHealthAfter?: number;
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
  rawFeedEntries!: Table<RawFeedEntry, string>;
  rawGameDetails!: Table<RawGameDetail, string>;
  detailFetchLog!: Table<DetailFetchLog, string>;
  syncState!: Table<SyncStateRow, string>;

  constructor(name: string = DB_V2_NAME) {
    super(name);

    this.version(1).stores({
      games: [
        "gameId",
        "playedAt",
        "modeFamily",
        "[modeFamily+playedAt]",
        "selfVictory",
        "selfId",
        "oppId",
        "detailFetchedAt",
      ].join(", "),

      rounds: [
        "[gameId+roundNumber]",
        "gameId",
        "startTime",
        "trueCountry",
        "selfGuessCountry",
        "movementType",
      ].join(", "),

      rawFeedEntries: "gameId, fetchedAt",
      rawGameDetails: "gameId, fetchedAt",

      detailFetchLog: [
        "gameId",
        "lastAttemptAt",
        "lastStatus",
      ].join(", "),

      syncState: "key",
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
