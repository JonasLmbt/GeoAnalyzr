import { db } from "../db";

type BackfillMovementRatingsResult = {
  scanned: number;
  updated: number;
};

function detectMovementType(v: unknown): "moving" | "no_move" | "nmpz" | null {
  const s = String(v ?? "").toLowerCase().trim();
  if (!s || s === "unknown") return null;
  if (s === "moving" || s === "move" || s === "standard") return "moving";
  if (s === "no_move" || s === "no move" || s === "nomove") return "no_move";
  if (s === "nmpz") return "nmpz";
  return null;
}

// Runs on every update, but only scans records not yet processed.
// Uses a fetchedAt cursor so already-checked records are never re-scanned.
// Records with a movement type but missing movement-specific ratings are deleted
// so updateData() re-fetches them with the current extraction logic.
export async function backfillMovementRatings(opts: {
  onStatus?: (msg: string) => void;
  batchSize?: number;
  cooldownMs?: number;
}): Promise<BackfillMovementRatingsResult> {
  const onStatus = opts.onStatus ?? (() => {});
  const batchSize = opts.batchSize ?? 300;
  const cooldownMs = opts.cooldownMs ?? 60 * 60 * 1000; // 1 hour

  const metaKey = "backfill_movement_ratings_v3";
  const meta = await db.meta.get(metaKey);
  const state: { processedUpTo?: number; lastRunAt?: number; totalDeleted?: number } =
    (meta?.value as any) ?? {};

  // Skip if we ran recently.
  if (
    typeof state.lastRunAt === "number" &&
    Date.now() - state.lastRunAt < cooldownMs
  ) {
    return { scanned: 0, updated: 0 };
  }

  const processedUpTo = typeof state.processedUpTo === "number" ? state.processedUpTo : 0;

  // Only look at records we haven't processed yet (new or re-fetched since last run).
  const unprocessed = await db.details
    .where("fetchedAt")
    .above(processedUpTo)
    .toArray();

  if (unprocessed.length === 0) {
    await db.meta.put({
      key: metaKey,
      value: { ...state, lastRunAt: Date.now() },
      updatedAt: Date.now(),
    });
    return { scanned: 0, updated: 0 };
  }

  let scanned = 0;
  let newMaxFetchedAt = processedUpTo;
  const toDelete: string[] = [];

  for (let i = 0; i < unprocessed.length; i += batchSize) {
    const chunk = unprocessed.slice(i, i + batchSize) as any[];
    scanned += chunk.length;

    for (const row of chunk) {
      if (!row || typeof row !== "object") continue;

      const fetchedAt = typeof row.fetchedAt === "number" ? row.fetchedAt : 0;
      if (fetchedAt > newMaxFetchedAt) newMaxFetchedAt = fetchedAt;

      const mt = detectMovementType(row.movementType) ?? detectMovementType(row.gameModeSimple);
      if (!mt) continue;

      // Already has movement-specific rating — nothing to do.
      if (
        row.player_self_movingRatingAfter != null ||
        row.player_self_noMoveRatingAfter != null ||
        row.player_self_nmpzRatingAfter   != null
      ) continue;

      // Missing movement rating — delete so updateData re-fetches it.
      if (typeof row.gameId === "string" && row.gameId) {
        toDelete.push(row.gameId);
      }
    }

    if (scanned % (batchSize * 5) === 0 || i + batchSize >= unprocessed.length) {
      onStatus(`Checking movement ratings... (${scanned}/${unprocessed.length})`);
    }
  }

  if (toDelete.length > 0) {
    onStatus(`Re-queuing ${toDelete.length} games for movement rating fetch...`);
    await db.details.bulkDelete(toDelete);
  }

  await db.meta.put({
    key: metaKey,
    value: {
      processedUpTo: newMaxFetchedAt,
      lastRunAt: Date.now(),
      totalDeleted: (state.totalDeleted ?? 0) + toDelete.length,
    },
    updatedAt: Date.now(),
  });

  return { scanned, updated: toDelete.length };
}
