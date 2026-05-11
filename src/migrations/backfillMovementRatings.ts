import { db } from "../db";

type BackfillMovementRatingsResult = {
  scanned: number;
  updated: number;
};

const MOVEMENT_SUFFIX: Record<string, string> = {
  moving:  "movingRating",
  no_move: "noMoveRating",
  nmpz:    "nmpzRating",
};

function detectMovementType(v: unknown): "moving" | "no_move" | "nmpz" | null {
  const s = String(v ?? "").toLowerCase().trim();
  if (!s || s === "unknown") return null;
  if (s === "moving" || s === "move" || s === "standard") return "moving";
  if (s === "no_move" || s === "no move" || s === "nomove") return "no_move";
  if (s === "nmpz") return "nmpz";
  return null;
}

const ROLES = ["player_self", "player_opponent", "player_mate", "player_opponent_mate"] as const;

export async function backfillMovementRatings(opts: {
  onStatus?: (msg: string) => void;
  batchSize?: number;
  force?: boolean;
}): Promise<BackfillMovementRatingsResult> {
  const onStatus = opts.onStatus ?? (() => {});
  const batchSize = opts.batchSize ?? 200;

  const metaKey = "migration_movement_ratings_v1";
  if (!opts.force) {
    const meta = await db.meta.get(metaKey);
    // Run exactly once — skip if doneAt is set.
    if ((meta?.value as any)?.doneAt) {
      return { scanned: 0, updated: 0 };
    }
  }

  const total = await db.details.count();
  let scanned = 0;
  let updated = 0;

  onStatus(`Backfilling movement ratings... (0/${total})`);

  for (let offset = 0; offset < total; offset += batchSize) {
    const chunk = await db.details.offset(offset).limit(batchSize).toArray();
    scanned += chunk.length;

    const patch: any[] = [];
    for (const row of chunk as any[]) {
      if (!row || typeof row !== "object") continue;

      // Determine movement type from new or old field.
      const mt = detectMovementType(row.movementType) ?? detectMovementType(row.gameModeSimple);
      if (!mt) continue;

      const suffix = MOVEMENT_SUFFIX[mt];
      let changed = false;

      for (const prefix of ROLES) {
        const oldAfter  = row[`${prefix}_gameModeRatingAfter`];
        const oldBefore = row[`${prefix}_gameModeRatingBefore`];
        if (oldAfter == null || !Number.isFinite(Number(oldAfter)) || Number(oldAfter) <= 0) continue;

        // Skip if already migrated for this role.
        if (
          row[`${prefix}_movingRatingAfter`]  != null ||
          row[`${prefix}_noMoveRatingAfter`]  != null ||
          row[`${prefix}_nmpzRatingAfter`]    != null
        ) continue;

        row[`${prefix}_${suffix}After`]  = Number(oldAfter);
        if (oldBefore != null && Number.isFinite(Number(oldBefore))) {
          row[`${prefix}_${suffix}Before`] = Number(oldBefore);
        }
        changed = true;
      }

      if (changed) patch.push(row);
    }

    if (patch.length > 0) {
      await db.details.bulkPut(patch);
      updated += patch.length;
    }

    if (scanned % (batchSize * 10) === 0 || scanned >= total) {
      onStatus(`Backfilling movement ratings... (${scanned}/${total}, updated ${updated})`);
    }
  }

  await db.meta.put({
    key: metaKey,
    value: { doneAt: Date.now(), scanned, updated },
    updatedAt: Date.now(),
  });

  return { scanned, updated };
}
