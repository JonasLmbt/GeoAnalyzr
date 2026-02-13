import { db } from "../db";
import type { RoundRow } from "../db";

type NormalizeLegacyRoundsResult = {
  scanned: number;
  updated: number;
};

function hasAnyKeyPrefix(obj: any, prefix: string): boolean {
  if (!obj || typeof obj !== "object") return false;
  for (const k of Object.keys(obj)) {
    if (k.startsWith(prefix)) return true;
  }
  return false;
}

function inferLegacyModeFamily(r: any): "duels" | "teamduels" {
  const mf = String(r?.modeFamily ?? "").toLowerCase();
  if (mf === "teamduels") return "teamduels";
  if (mf === "duels") return "duels";
  // Legacy rows often have p3_/p4_ only for team duels.
  if (hasAnyKeyPrefix(r, "p3_") || hasAnyKeyPrefix(r, "p4_")) return "teamduels";
  return "duels";
}

function copyIfMissing(dst: any, dstKey: string, src: any, srcKey: string): boolean {
  if (!dst || !src) return false;
  if (dst[dstKey] !== undefined && dst[dstKey] !== null) return false;
  const v = src[srcKey];
  if (v === undefined || v === null) return false;
  dst[dstKey] = v;
  return true;
}

function copyMetersToKmIfMissing(dst: any, dstKey: string, src: any, metersKey: string): boolean {
  if (!dst || !src) return false;
  if (dst[dstKey] !== undefined && dst[dstKey] !== null) return false;
  const m = src[metersKey];
  if (typeof m !== "number" || !Number.isFinite(m)) return false;
  dst[dstKey] = m / 1e3;
  return true;
}

function normalizeLegacyPlayerBlock(dst: any, src: any, legacyPrefix: string, role: string): boolean {
  let changed = false;
  changed = copyIfMissing(dst, `${role}_playerId`, src, `${legacyPrefix}_playerId`) || changed;
  changed = copyIfMissing(dst, `${role}_teamId`, src, `${legacyPrefix}_teamId`) || changed;

  changed = copyIfMissing(dst, `${role}_guessLat`, src, `${legacyPrefix}_guessLat`) || changed;
  changed = copyIfMissing(dst, `${role}_guessLng`, src, `${legacyPrefix}_guessLng`) || changed;
  changed = copyIfMissing(dst, `${role}_guessCountry`, src, `${legacyPrefix}_guessCountry`) || changed;

  changed = copyIfMissing(dst, `${role}_score`, src, `${legacyPrefix}_score`) || changed;
  changed = copyIfMissing(dst, `${role}_healthAfter`, src, `${legacyPrefix}_healthAfter`) || changed;
  changed = copyIfMissing(dst, `${role}_isBestGuess`, src, `${legacyPrefix}_isBestGuess`) || changed;

  changed = copyIfMissing(dst, `${role}_distanceKm`, src, `${legacyPrefix}_distanceKm`) || changed;
  changed = copyMetersToKmIfMissing(dst, `${role}_distanceKm`, src, `${legacyPrefix}_distanceMeters`) || changed;

  return changed;
}

function normalizeLegacyRoundRow(r: any): RoundRow | null {
  if (!r || typeof r !== "object") return null;

  // Quick check: no p1_* keys => nothing to do.
  if (!hasAnyKeyPrefix(r, "p1_")) return null;

  const out: any = { ...r };
  let changed = false;

  const family = inferLegacyModeFamily(r);

  // Duel: p1=self, p2=opponent
  // Team duel: p1=self, p2=mate, p3=opponent, p4=opponent mate
  if (family === "duels") {
    changed = normalizeLegacyPlayerBlock(out, r, "p1", "player_self") || changed;
    changed = normalizeLegacyPlayerBlock(out, r, "p2", "player_opponent") || changed;
  } else {
    changed = normalizeLegacyPlayerBlock(out, r, "p1", "player_self") || changed;
    changed = normalizeLegacyPlayerBlock(out, r, "p2", "player_mate") || changed;
    changed = normalizeLegacyPlayerBlock(out, r, "p3", "player_opponent") || changed;
    changed = normalizeLegacyPlayerBlock(out, r, "p4", "player_opponent_mate") || changed;
  }

  // Some old rows used roundNumber vs roundNumber already; keep as-is.
  // Nothing else to normalize here; other fields are derived at query time.
  return changed ? (out as RoundRow) : null;
}

export async function normalizeLegacyRounds(opts: {
  onStatus?: (msg: string) => void;
  batchSize?: number;
  force?: boolean;
}): Promise<NormalizeLegacyRoundsResult> {
  const onStatus = opts.onStatus ?? (() => {});
  const batchSize = opts.batchSize ?? 500;

  const metaKey = "migration_legacy_rounds_v1";
  if (!opts.force) {
    const meta = await db.meta.get(metaKey);
    const doneAt = (meta?.value as any)?.doneAt as number | undefined;
    // If we ran this recently, skip by default to keep updates snappy.
    if (typeof doneAt === "number" && Number.isFinite(doneAt) && Date.now() - doneAt < 12 * 60 * 60 * 1000) {
      return { scanned: 0, updated: 0 };
    }
  }

  const total = await db.rounds.count();
  let scanned = 0;
  let updated = 0;

  onStatus(`Normalizing legacy rounds... (0/${total})`);

  for (let offset = 0; offset < total; offset += batchSize) {
    const chunk = await db.rounds.offset(offset).limit(batchSize).toArray();
    scanned += chunk.length;

    const patch: RoundRow[] = [];
    for (const r of chunk as any[]) {
      const normalized = normalizeLegacyRoundRow(r);
      if (normalized) {
        patch.push(normalized);
      }
    }
    if (patch.length > 0) {
      await db.rounds.bulkPut(patch);
      updated += patch.length;
    }

    if (scanned % (batchSize * 5) === 0 || scanned === total) {
      onStatus(`Normalizing legacy rounds... (${scanned}/${total}, updated ${updated})`);
    }
  }

  await db.meta.put({
    key: metaKey,
    value: { doneAt: Date.now(), scanned, updated },
    updatedAt: Date.now()
  });

  return { scanned, updated };
}

