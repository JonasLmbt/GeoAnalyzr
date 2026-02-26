import { db } from "../db";
import type { RoundRow } from "../db";
import { resolveCountryCodeByLatLngLocalOnlySync } from "../countries";

type BackfillGuessCountriesResult = {
  scanned: number;
  updated: number;
};

function normalizeIso2(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const x = v.trim().toLowerCase();
  return /^[a-z]{2}$/.test(x) ? x : undefined;
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function hasRole(r: any, role: string): boolean {
  const id = r?.[`${role}_playerId`];
  const lat = r?.[`${role}_guessLat`];
  const lng = r?.[`${role}_guessLng`];
  return typeof id === "string" && id.trim().length > 0 || (isFiniteNumber(lat) && isFiniteNumber(lng));
}

function maybeFillRole(out: any, role: string): boolean {
  const existing = normalizeIso2(out?.[`${role}_guessCountry`]);
  if (existing) return false;
  const lat = out?.[`${role}_guessLat`];
  const lng = out?.[`${role}_guessLng`];
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return false;
  const iso = resolveCountryCodeByLatLngLocalOnlySync(lat, lng);
  if (!iso) return false;
  out[`${role}_guessCountry`] = iso;
  return true;
}

export async function backfillGuessCountries(opts: {
  onStatus?: (msg: string) => void;
  batchSize?: number;
  force?: boolean;
}): Promise<BackfillGuessCountriesResult> {
  const onStatus = opts.onStatus ?? (() => {});
  const batchSize = opts.batchSize ?? 500;

  const metaKey = "migration_guess_countries_v1";
  if (!opts.force) {
    const meta = await db.meta.get(metaKey);
    const doneAt = (meta?.value as any)?.doneAt as number | undefined;
    // Skip if we ran this recently to keep UX snappy.
    if (typeof doneAt === "number" && Number.isFinite(doneAt) && Date.now() - doneAt < 24 * 60 * 60 * 1000) {
      return { scanned: 0, updated: 0 };
    }
  }

  const total = await db.rounds.count();
  let scanned = 0;
  let updated = 0;
  let mutated = false;

  onStatus(`Backfilling guessCountry... (0/${total})`);

  for (let offset = 0; offset < total; offset += batchSize) {
    const chunk = await db.rounds.offset(offset).limit(batchSize).toArray();
    scanned += chunk.length;

    const patch: RoundRow[] = [];
    for (const r of chunk as any[]) {
      if (!r || typeof r !== "object") continue;
      const out: any = r;
      let changed = false;

      // Duel: self/opponent. Team duel: + mate/opponent_mate.
      if (hasRole(r, "player_self")) changed = maybeFillRole(out, "player_self") || changed;
      if (hasRole(r, "player_opponent")) changed = maybeFillRole(out, "player_opponent") || changed;
      if (hasRole(r, "player_mate")) changed = maybeFillRole(out, "player_mate") || changed;
      if (hasRole(r, "player_opponent_mate")) changed = maybeFillRole(out, "player_opponent_mate") || changed;

      if (changed) patch.push(out as RoundRow);
    }

    if (patch.length > 0) {
      await db.rounds.bulkPut(patch);
      updated += patch.length;
      mutated = true;
    }

    if (scanned % (batchSize * 5) === 0 || scanned === total) {
      onStatus(`Backfilling guessCountry... (${scanned}/${total}, updated ${updated})`);
    }
  }

  await db.meta.put({
    key: metaKey,
    value: { doneAt: Date.now(), scanned, updated },
    updatedAt: Date.now()
  });

  // guessCountry changes affect hit-rate aggregates.
  if (mutated) {
    try {
      await db.gameAgg.clear();
    } catch {
      // ignore - cache is best-effort
    }
  }

  return { scanned, updated };
}
