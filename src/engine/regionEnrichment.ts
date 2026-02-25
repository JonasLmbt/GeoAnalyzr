import { resolveIdKabupatenByLatLng, resolveIdProvinceByLatLng } from "../geo/idRegions";
import { resolveDeDistrictByLatLng, resolveDeStateByLatLng } from "../geo/deRegions";
import { resolveCaProvinceByLatLng, resolveUsStateByLatLng } from "../geo/naRegions";
import { resolvePhProvinceByLatLng, resolveVnProvinceByLatLng } from "../geo/seaRegions";

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
  const supported = new Set([
    "true_state",
    "true_district",
    "true_us_state",
    "true_ca_province",
    "true_id_province",
    "true_id_kabupaten",
    "true_ph_province",
    "true_vn_province",
  ]);
  if (!supported.has(dimId)) return;

  const todo: any[] = [];
  for (const r of rows) {
    const tc = typeof r?.trueCountry === "string" ? r.trueCountry.trim().toLowerCase() : "";
    const lat = r?.trueLat;
    const lng = r?.trueLng;
    if (!isFiniteNum(lat) || !isFiniteNum(lng)) continue;

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
    }
  }
  if (todo.length === 0) return;

  await runPool(todo, 6, async (r) => {
    const lat = r.trueLat as number;
    const lng = r.trueLng as number;
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
    }
  });
}
