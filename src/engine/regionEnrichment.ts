import { resolveIdKabupatenByLatLng, resolveIdProvinceByLatLng } from "../geo/idRegions";
import { resolveDeDistrictByLatLng, resolveDeStateByLatLng } from "../geo/deRegions";
import { resolveCaProvinceByLatLng, resolveUsStateByLatLng } from "../geo/naRegions";
import { resolvePhProvinceByLatLng, resolveVnProvinceByLatLng } from "../geo/seaRegions";
import { db } from "../db";

const ADMIN_DIM_TO_COUNTRY: Record<string, string> = {
  true_state: "de",
  guess_state: "de",
  true_district: "de",
  guess_district: "de",
  true_us_state: "us",
  guess_us_state: "us",
  true_ca_province: "ca",
  guess_ca_province: "ca",
  true_id_province: "id",
  guess_id_province: "id",
  true_id_kabupaten: "id",
  guess_id_kabupaten: "id",
  true_ph_province: "ph",
  guess_ph_province: "ph",
  true_vn_province: "vn",
  guess_vn_province: "vn",
};

const SUPPORTED_ADMIN_DIMS = new Set(Object.keys(ADMIN_DIM_TO_COUNTRY));

type AdminEnabledCacheEntry = { enabled: boolean; fetchedAt: number };
const ADMIN_ENABLED_CACHE = new Map<string, AdminEnabledCacheEntry>();
const ADMIN_ENABLED_CACHE_TTL_MS = 2_000;

export function getAdminEnrichmentRequiredCountry(dimId: string): string | null {
  const iso2 = ADMIN_DIM_TO_COUNTRY[dimId];
  return typeof iso2 === "string" && iso2 ? iso2 : null;
}

export function invalidateAdminEnrichmentEnabledCache(countryIso2?: string): void {
  if (typeof countryIso2 === "string" && countryIso2.trim()) {
    ADMIN_ENABLED_CACHE.delete(countryIso2.trim().toLowerCase());
    return;
  }
  ADMIN_ENABLED_CACHE.clear();
}

export async function isAdminEnrichmentEnabledForCountry(countryIso2: string): Promise<boolean> {
  const iso2 = typeof countryIso2 === "string" ? countryIso2.trim().toLowerCase() : "";
  if (!iso2) return false;

  const cached = ADMIN_ENABLED_CACHE.get(iso2);
  if (cached && Date.now() - cached.fetchedAt < ADMIN_ENABLED_CACHE_TTL_MS) return cached.enabled;

  try {
    const meta = await db.meta.get(`admin_enrichment_enabled_${iso2}`);
    const v = (meta?.value as any) ?? {};
    const enabled =
      v.enabled === true ||
      (v.levels && typeof v.levels === "object" && Object.values(v.levels).some((x: any) => x && x.enabled === true));
    ADMIN_ENABLED_CACHE.set(iso2, { enabled, fetchedAt: Date.now() });
    return enabled;
  } catch {
    ADMIN_ENABLED_CACHE.set(iso2, { enabled: false, fetchedAt: Date.now() });
    return false;
  }
}

export async function isAdminEnrichmentEnabledForDimension(dimId: string): Promise<boolean> {
  const iso2 = getAdminEnrichmentRequiredCountry(dimId);
  if (!iso2) return true;
  const meta = await db.meta.get(`admin_enrichment_enabled_${iso2}`);
  const v = (meta?.value as any) ?? {};
  const anyEnabled =
    v.enabled === true ||
    (v.levels && typeof v.levels === "object" && Object.values(v.levels).some((x: any) => x && x.enabled === true));
  if (!anyEnabled) return false;

  // New format: gate by enabled level that owns the dim id.
  if (v.levels && typeof v.levels === "object") {
    for (const lvl of Object.values(v.levels) as any[]) {
      const enabled = lvl?.enabled === true;
      const ids = Array.isArray(lvl?.dimIds) ? lvl.dimIds : [];
      if (enabled && ids.includes(dimId)) return true;
    }
    return false;
  }

  // Legacy format: simple per-country enabled toggle + done list.
  const done: string[] = Array.isArray(v.dimIdsDone) ? v.dimIdsDone : Array.isArray(v.dimIds) ? v.dimIds : [];
  return done.includes(dimId);
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  const n = Math.max(1, Math.min(32, Math.floor(concurrency)));
  let idx = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    let localCount = 0;
    for (;;) {
      const i = idx++;
      if (i >= items.length) return;
      await fn(items[i]);
      // Yield regularly so large enrichments don't freeze the tab.
      localCount++;
      if (localCount % 25 === 0) await new Promise<void>((r) => setTimeout(r, 0));
    }
  });
  await Promise.all(workers);
}

export async function maybeEnrichRoundRowsForDimension(dimId: string, rows: any[]): Promise<void> {
  if (!Array.isArray(rows) || rows.length === 0) return;
  if (!SUPPORTED_ADMIN_DIMS.has(dimId)) return;

  const requiredCountry = getAdminEnrichmentRequiredCountry(dimId);

  // By default, admin-level enrichment is opt-in (triggered from the Country Insight "Start detailed analysis" widget).
  if (requiredCountry && !(await isAdminEnrichmentEnabledForDimension(dimId))) return;

  const guessLatLngOf = (r: any): { lat: number; lng: number } | null => {
    const lat =
      typeof r?.player_self_guessLat === "number"
        ? r.player_self_guessLat
        : typeof r?.p1_guessLat === "number"
          ? r.p1_guessLat
          : typeof r?.guessLat === "number"
            ? r.guessLat
            : null;
    const lng =
      typeof r?.player_self_guessLng === "number"
        ? r.player_self_guessLng
        : typeof r?.p1_guessLng === "number"
          ? r.p1_guessLng
          : typeof r?.guessLng === "number"
            ? r.guessLng
            : null;
    if (!isFiniteNum(lat) || !isFiniteNum(lng)) return null;
    return { lat, lng };
  };

  const todo: any[] = [];
  for (const r of rows) {
    const tc = typeof r?.trueCountry === "string" ? r.trueCountry.trim().toLowerCase() : "";
    const lat = r?.trueLat;
    const lng = r?.trueLng;

    const g = guessLatLngOf(r);

    const wantTrue = dimId.startsWith("true_");
    const wantGuess = dimId.startsWith("guess_");
    if (wantTrue && (!isFiniteNum(lat) || !isFiniteNum(lng))) continue;
    if (wantGuess && !g) continue;

    if (dimId === "true_state") {
      if (tc !== "de") continue;
      const has = typeof r?.trueState === "string" && r.trueState.trim().length > 0;
      if (!has) todo.push(r);
    } else if (dimId === "true_district") {
      if (tc !== "de") continue;
      const has = typeof r?.trueDistrict === "string" && r.trueDistrict.trim().length > 0;
      if (!has) todo.push(r);
    } else if (dimId === "true_us_state") {
      if (tc !== "us") continue;
      const has = typeof r?.trueUsState === "string" && r.trueUsState.trim().length > 0;
      if (!has) todo.push(r);
    } else if (dimId === "true_ca_province") {
      if (tc !== "ca") continue;
      const has = typeof r?.trueCaProvince === "string" && r.trueCaProvince.trim().length > 0;
      if (!has) todo.push(r);
    } else if (dimId === "guess_state") {
      if (tc !== "de") continue;
      const has = typeof r?.guessState === "string" && r.guessState.trim().length > 0;
      if (!has) todo.push(r);
    } else if (dimId === "guess_district") {
      if (tc !== "de") continue;
      const has = typeof r?.guessDistrict === "string" && r.guessDistrict.trim().length > 0;
      if (!has) todo.push(r);
    } else if (dimId === "guess_us_state") {
      if (tc !== "us") continue;
      const has = typeof r?.guessUsState === "string" && r.guessUsState.trim().length > 0;
      if (!has) todo.push(r);
    } else if (dimId === "guess_ca_province") {
      if (tc !== "ca") continue;
      const has = typeof r?.guessCaProvince === "string" && r.guessCaProvince.trim().length > 0;
      if (!has) todo.push(r);
    } else if (dimId === "true_id_province") {
      if (tc !== "id") continue;
      const has = typeof r?.trueIdProvince === "string" && r.trueIdProvince.trim().length > 0;
      if (!has) todo.push(r);
    } else if (dimId === "true_id_kabupaten") {
      if (tc !== "id") continue;
      const has = typeof r?.trueIdKabupaten === "string" && r.trueIdKabupaten.trim().length > 0;
      if (!has) todo.push(r);
    } else if (dimId === "true_ph_province") {
      if (tc !== "ph") continue;
      const has = typeof r?.truePhProvince === "string" && r.truePhProvince.trim().length > 0;
      if (!has) todo.push(r);
    } else if (dimId === "true_vn_province") {
      if (tc !== "vn") continue;
      const has = typeof r?.trueVnProvince === "string" && r.trueVnProvince.trim().length > 0;
      if (!has) todo.push(r);
    } else if (dimId === "guess_id_province") {
      if (tc !== "id") continue;
      const has = typeof r?.guessIdProvince === "string" && r.guessIdProvince.trim().length > 0;
      if (!has) todo.push(r);
    } else if (dimId === "guess_id_kabupaten") {
      if (tc !== "id") continue;
      const has = typeof r?.guessIdKabupaten === "string" && r.guessIdKabupaten.trim().length > 0;
      if (!has) todo.push(r);
    } else if (dimId === "guess_ph_province") {
      if (tc !== "ph") continue;
      const has = typeof r?.guessPhProvince === "string" && r.guessPhProvince.trim().length > 0;
      if (!has) todo.push(r);
    } else if (dimId === "guess_vn_province") {
      if (tc !== "vn") continue;
      const has = typeof r?.guessVnProvince === "string" && r.guessVnProvince.trim().length > 0;
      if (!has) todo.push(r);
    }
  }
  if (todo.length === 0) return;

  await runPool(todo, 6, async (r) => {
    const tc = typeof r?.trueCountry === "string" ? r.trueCountry.trim().toLowerCase() : "";
    const lat = r.trueLat as number;
    const lng = r.trueLng as number;
    const g = guessLatLngOf(r);
    if (dimId === "true_state") {
      const s = await resolveDeStateByLatLng(lat, lng);
      if (s) r.trueState = s;
    } else if (dimId === "true_district") {
      const d = await resolveDeDistrictByLatLng(lat, lng);
      if (d) r.trueDistrict = d;
    } else if (dimId === "true_us_state") {
      const s = await resolveUsStateByLatLng(lat, lng);
      if (s) r.trueUsState = s;
    } else if (dimId === "true_ca_province") {
      const p = await resolveCaProvinceByLatLng(lat, lng);
      if (p) r.trueCaProvince = p;
    } else if (dimId === "guess_state" && g && tc === "de") {
      const s = await resolveDeStateByLatLng(g.lat, g.lng);
      if (s) r.guessState = s;
    } else if (dimId === "guess_district" && g && tc === "de") {
      const d = await resolveDeDistrictByLatLng(g.lat, g.lng);
      if (d) r.guessDistrict = d;
    } else if (dimId === "guess_us_state" && g && tc === "us") {
      const s = await resolveUsStateByLatLng(g.lat, g.lng);
      if (s) r.guessUsState = s;
    } else if (dimId === "guess_ca_province" && g && tc === "ca") {
      const p = await resolveCaProvinceByLatLng(g.lat, g.lng);
      if (p) r.guessCaProvince = p;
    } else if (dimId === "true_id_province") {
      const p = await resolveIdProvinceByLatLng(lat, lng);
      if (p) r.trueIdProvince = p;
    } else if (dimId === "true_id_kabupaten") {
      const k = await resolveIdKabupatenByLatLng(lat, lng);
      if (k) r.trueIdKabupaten = k;
    } else if (dimId === "true_ph_province") {
      const p = await resolvePhProvinceByLatLng(lat, lng);
      if (p) r.truePhProvince = p;
    } else if (dimId === "true_vn_province") {
      const p = await resolveVnProvinceByLatLng(lat, lng);
      if (p) r.trueVnProvince = p;
    } else if (dimId === "guess_id_province" && g && tc === "id") {
      const p = await resolveIdProvinceByLatLng(g.lat, g.lng);
      if (p) r.guessIdProvince = p;
    } else if (dimId === "guess_id_kabupaten" && g && tc === "id") {
      const k = await resolveIdKabupatenByLatLng(g.lat, g.lng);
      if (k) r.guessIdKabupaten = k;
    } else if (dimId === "guess_ph_province" && g && tc === "ph") {
      const p = await resolvePhProvinceByLatLng(g.lat, g.lng);
      if (p) r.guessPhProvince = p;
    } else if (dimId === "guess_vn_province" && g && tc === "vn") {
      const p = await resolveVnProvinceByLatLng(g.lat, g.lng);
      if (p) r.guessVnProvince = p;
    }
  });
}
