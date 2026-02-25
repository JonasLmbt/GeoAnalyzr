import { resolveIdKabupatenByLatLng, resolveIdProvinceByLatLng } from "../geo/idRegions";

function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  const n = Math.max(1, Math.min(32, Math.floor(concurrency)));
  let idx = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    for (;;) {
      const i = idx++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

export async function maybeEnrichRoundRowsForDimension(dimId: string, rows: any[]): Promise<void> {
  if (!Array.isArray(rows) || rows.length === 0) return;
  if (dimId !== "true_id_province" && dimId !== "true_id_kabupaten") return;

  const todo: any[] = [];
  for (const r of rows) {
    const tc = typeof r?.trueCountry === "string" ? r.trueCountry.trim().toLowerCase() : "";
    if (tc !== "id") continue;
    const lat = r?.trueLat;
    const lng = r?.trueLng;
    if (!isFiniteNum(lat) || !isFiniteNum(lng)) continue;

    if (dimId === "true_id_province") {
      const has = typeof r?.trueIdProvince === "string" && r.trueIdProvince.trim().length > 0;
      if (!has) todo.push(r);
    } else {
      const has = typeof r?.trueIdKabupaten === "string" && r.trueIdKabupaten.trim().length > 0;
      if (!has) todo.push(r);
    }
  }
  if (todo.length === 0) return;

  await runPool(todo, 6, async (r) => {
    const lat = r.trueLat as number;
    const lng = r.trueLng as number;
    if (dimId === "true_id_province") {
      const p = await resolveIdProvinceByLatLng(lat, lng);
      if (p) r.trueIdProvince = p;
    } else {
      const k = await resolveIdKabupatenByLatLng(lat, lng);
      if (k) r.trueIdKabupaten = k;
    }
  });
}

