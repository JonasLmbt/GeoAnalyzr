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

// Deletes detail records for rated movement games that lack movement-specific
// rating fields so they get re-fetched (with current extraction logic) on the
// next updateData() call. Runs exactly once per install (meta key v2).
export async function backfillMovementRatings(opts: {
  onStatus?: (msg: string) => void;
  batchSize?: number;
  force?: boolean;
}): Promise<BackfillMovementRatingsResult> {
  const onStatus = opts.onStatus ?? (() => {});
  const batchSize = opts.batchSize ?? 200;

  const metaKey = "migration_movement_ratings_v2";
  if (!opts.force) {
    const meta = await db.meta.get(metaKey);
    if ((meta?.value as any)?.doneAt) {
      return { scanned: 0, updated: 0 };
    }
  }

  const total = await db.details.count();
  let scanned = 0;
  const toDelete: string[] = [];

  onStatus(`Checking movement ratings... (0/${total})`);

  for (let offset = 0; offset < total; offset += batchSize) {
    const chunk = await db.details.offset(offset).limit(batchSize).toArray();
    scanned += chunk.length;

    for (const row of chunk as any[]) {
      if (!row || typeof row !== "object") continue;

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

    if (scanned % (batchSize * 10) === 0 || scanned >= total) {
      onStatus(`Checking movement ratings... (${scanned}/${total})`);
    }
  }

  if (toDelete.length > 0) {
    onStatus(`Re-queuing ${toDelete.length} games for movement rating fetch...`);
    await db.details.bulkDelete(toDelete);
  }

  await db.meta.put({
    key: metaKey,
    value: { doneAt: Date.now(), scanned, requeued: toDelete.length },
    updatedAt: Date.now(),
  });

  return { scanned, updated: toDelete.length };
}
