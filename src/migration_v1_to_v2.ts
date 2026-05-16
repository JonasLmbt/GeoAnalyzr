import { GGDB, MAIN_DB_NAME } from "./db";
import { dbV2, GameRow, RoundRow, ModeFamily, MovementType } from "./db_v2";

export interface MigrationProgress {
  phase: "games" | "rounds" | "done";
  processed: number;
  total: number;
  errors: number;
}

// ─── Field mappers ────────────────────────────────────────────────────────────

function toModeFamily(raw: string | undefined, isTeamDuels?: boolean): ModeFamily {
  if (isTeamDuels) return "teamduels";
  const m = String(raw || "").toLowerCase();
  if (m === "duels") return "duels";
  if (m === "teamduels") return "teamduels";
  if (m === "standard") return "standard";
  if (m === "streak") return "streak";
  return "other";
}

function toMovementType(raw: string | undefined): MovementType | "mixed" | undefined {
  if (raw === "moving" || raw === "no_move" || raw === "nmpz" || raw === "mixed") return raw;
  return undefined;
}

function bool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === 1) return true;
  if (v === 0) return false;
  return undefined;
}

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

// ─── Migration ────────────────────────────────────────────────────────────────

export async function migrateV1ToV2(
  onProgress?: (p: MigrationProgress) => void
): Promise<{ games: number; rounds: number; errors: number }> {
  const oldDb = new GGDB(MAIN_DB_NAME);
  await oldDb.open();

  let totalErrors = 0;

  // ── Games ─────────────────────────────────────────────────────────────────

  const [oldGames, oldDetails] = await Promise.all([
    oldDb.games.toArray(),
    oldDb.details.toArray(),
  ]);

  const detailsByGameId = new Map(oldDetails.map((d) => [d.gameId, d]));

  const total = oldGames.length;
  let processed = 0;

  const GAME_CHUNK = 200;
  for (let i = 0; i < oldGames.length; i += GAME_CHUNK) {
    const chunk = oldGames.slice(i, i + GAME_CHUNK);
    const mapped: GameRow[] = [];

    for (const feed of chunk) {
      try {
        const det = detailsByGameId.get(feed.gameId) as any;
        const modeFamily = toModeFamily(feed.modeFamily ?? (det?.modeFamily), feed.isTeamDuels ?? det?.isTeamDuels);

        const row: GameRow = {
          gameId: feed.gameId,
          playedAt: feed.playedAt,
          modeFamily,
          mapSlug: str(det?.mapSlug),
          mapName: str(det?.mapName),
          movementType: toMovementType(det?.movementType),
          isRated: bool(det?.isRated),
          totalRounds: num(det?.totalRounds),
          detailFetchedAt: num(det?.fetchedAt),

          selfId: str(det?.player_self_id),
          selfName: str(det?.player_self_name),
          selfCountry: str(det?.player_self_country),
          selfVictory: bool(det?.player_self_victory),
          selfScore: num(det?.player_self_finalHealth ?? det?.points),
          selfRatingBefore: num(det?.player_self_startRating ?? det?.player_self_movingRatingBefore),
          selfRatingAfter: num(det?.player_self_endRating ?? det?.player_self_movingRatingAfter),

          oppId: str(det?.player_opponent_id),
          oppName: str(det?.player_opponent_name),
          oppCountry: str(det?.player_opponent_country),
          oppRatingBefore: num(det?.player_opponent_startRating ?? det?.player_opponent_movingRatingBefore),
          oppRatingAfter: num(det?.player_opponent_endRating ?? det?.player_opponent_movingRatingAfter),

          mateId: str(det?.player_mate_id),
          mateName: str(det?.player_mate_name),
          mateCountry: str(det?.player_mate_country),
          mateRatingBefore: num(det?.player_mate_startRating),
          mateRatingAfter: num(det?.player_mate_endRating),

          oppMateId: str(det?.player_opponent_mate_id),
          oppMateName: str(det?.player_opponent_mate_name),
          oppMateCountry: str(det?.player_opponent_mate_country),
          oppMateRatingBefore: num(det?.player_opponent_mate_startRating),
          oppMateRatingAfter: num(det?.player_opponent_mate_endRating),
        };

        // Strip undefined fields to keep IndexedDB storage lean
        for (const k of Object.keys(row) as (keyof GameRow)[]) {
          if (row[k] === undefined) delete row[k];
        }

        mapped.push(row);
      } catch {
        totalErrors++;
      }
    }

    await dbV2.games.bulkPut(mapped);
    processed += chunk.length;
    onProgress?.({ phase: "games", processed, total, errors: totalErrors });
  }

  // ── Rounds ────────────────────────────────────────────────────────────────

  const oldRounds = await oldDb.rounds.toArray();
  const roundTotal = oldRounds.length;
  let roundProcessed = 0;

  const ROUND_CHUNK = 500;
  for (let i = 0; i < oldRounds.length; i += ROUND_CHUNK) {
    const chunk = oldRounds.slice(i, i + ROUND_CHUNK);
    const mapped: RoundRow[] = [];

    for (const r of chunk as any[]) {
      try {
        const startTime = num(r.startTime);
        const endTime = num(r.endTime);
        const durationSec =
          startTime && endTime && endTime > startTime
            ? (endTime - startTime) / 1000
            : num(r.durationSeconds);

        const row: RoundRow = {
          gameId: String(r.gameId || ""),
          roundNumber: Number(r.roundNumber ?? 0),
          startTime,
          durationSec,
          movementType: toMovementType(r.movementType) as MovementType | undefined,

          trueLat: num(r.trueLat),
          trueLng: num(r.trueLng),
          trueCountry: str(r.trueCountry),

          selfGuessLat: num(r.player_self_guessLat),
          selfGuessLng: num(r.player_self_guessLng),
          selfGuessCountry: str(r.player_self_guessCountry),
          selfScore: num(r.player_self_score),
          selfDistanceKm: num(r.player_self_distanceKm),

          oppGuessLat: num(r.player_opponent_guessLat),
          oppGuessLng: num(r.player_opponent_guessLng),
          oppGuessCountry: str(r.player_opponent_guessCountry),
          oppScore: num(r.player_opponent_score),
          oppDistanceKm: num(r.player_opponent_distanceKm),

          mateGuessLat: num(r.player_mate_guessLat),
          mateGuessLng: num(r.player_mate_guessLng),
          mateGuessCountry: str(r.player_mate_guessCountry),
          mateScore: num(r.player_mate_score),
          mateDistanceKm: num(r.player_mate_distanceKm),

          oppMateGuessLat: num(r.player_opponent_mate_guessLat),
          oppMateGuessLng: num(r.player_opponent_mate_guessLng),
          oppMateGuessCountry: str(r.player_opponent_mate_guessCountry),
          oppMateScore: num(r.player_opponent_mate_score),
          oppMateDistanceKm: num(r.player_opponent_mate_distanceKm),

          selfHealthAfter: num(r.team_self_healthAfter ?? r.player_self_healthAfter),
          oppHealthAfter: num(r.team_opponent_healthAfter ?? r.player_opponent_healthAfter),
        };

        if (!row.gameId || row.roundNumber == null) continue;

        for (const k of Object.keys(row) as (keyof RoundRow)[]) {
          if (row[k] === undefined) delete row[k];
        }

        mapped.push(row);
      } catch {
        totalErrors++;
      }
    }

    await dbV2.rounds.bulkPut(mapped);
    roundProcessed += chunk.length;
    onProgress?.({ phase: "rounds", processed: roundProcessed, total: roundTotal, errors: totalErrors });
  }

  oldDb.close();

  onProgress?.({ phase: "done", processed: roundTotal, total: roundTotal, errors: totalErrors });
  return { games: processed, rounds: roundProcessed, errors: totalErrors };
}

export async function isMigrationNeeded(): Promise<boolean> {
  const [oldCount, newCount] = await Promise.all([
    new GGDB(MAIN_DB_NAME).games.count().catch(() => 0),
    dbV2.games.count().catch(() => 0),
  ]);
  // Migration needed if old DB has data but new DB is significantly behind
  return oldCount > 0 && newCount < oldCount * 0.9;
}
