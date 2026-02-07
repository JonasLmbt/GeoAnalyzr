import { httpGetJson } from "./http";

type Position = [number, number];
type Ring = Position[];
type PolygonCoords = Ring[];
type MultiPolygonCoords = PolygonCoords[];

interface CountryFeature {
  iso2: string;
  geometryType: "Polygon" | "MultiPolygon";
  coordinates: PolygonCoords | MultiPolygonCoords;
  bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number };
}

let countriesPromise: Promise<CountryFeature[]> | null = null;
const guessCountryCache = new Map<string, string | undefined>();

function computeBboxPolygon(coords: PolygonCoords): { minLng: number; minLat: number; maxLng: number; maxLat: number } {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const ring of coords) {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return { minLng, minLat, maxLng, maxLat };
}

function mergeBbox(
  a: { minLng: number; minLat: number; maxLng: number; maxLat: number },
  b: { minLng: number; minLat: number; maxLng: number; maxLat: number }
) {
  return {
    minLng: Math.min(a.minLng, b.minLng),
    minLat: Math.min(a.minLat, b.minLat),
    maxLng: Math.max(a.maxLng, b.maxLng),
    maxLat: Math.max(a.maxLat, b.maxLat)
  };
}

function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lng: number, lat: number, poly: PolygonCoords): boolean {
  if (poly.length === 0) return false;
  if (!pointInRing(lng, lat, poly[0])) return false;
  for (let i = 1; i < poly.length; i++) {
    if (pointInRing(lng, lat, poly[i])) return false;
  }
  return true;
}

function pointInMultiPolygon(lng: number, lat: number, mpoly: MultiPolygonCoords): boolean {
  for (const poly of mpoly) {
    if (pointInPolygon(lng, lat, poly)) return true;
  }
  return false;
}

async function loadCountries(): Promise<CountryFeature[]> {
  if (countriesPromise) return countriesPromise;

  countriesPromise = (async () => {
    const urls = [
      "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson",
      "https://cdn.jsdelivr.net/gh/datasets/geo-countries@master/data/countries.geojson"
    ];
    let geo: any = null;
    let lastErr: unknown = null;
    for (const url of urls) {
      try {
        const res = await httpGetJson(url, { forceGm: true });
        if (res.status >= 200 && res.status < 300) {
          geo = res.data;
          break;
        }
        lastErr = new Error(`Country GeoJSON HTTP ${res.status}`);
      } catch (e) {
        lastErr = e;
      }
    }
    if (!geo) throw lastErr instanceof Error ? lastErr : new Error("Country GeoJSON load failed");
    const features = Array.isArray(geo?.features) ? geo.features : [];

    const out: CountryFeature[] = [];
    for (const f of features) {
      const isoRaw = f?.properties?.ISO_A2;
      const iso2 = typeof isoRaw === "string" ? isoRaw.toLowerCase() : "";
      const type = f?.geometry?.type;
      const coordinates = f?.geometry?.coordinates;
      if (!iso2 || iso2 === "-99") continue;
      if (type === "Polygon" && Array.isArray(coordinates)) {
        const bbox = computeBboxPolygon(coordinates as PolygonCoords);
        out.push({ iso2, geometryType: "Polygon", coordinates: coordinates as PolygonCoords, bbox });
      } else if (type === "MultiPolygon" && Array.isArray(coordinates)) {
        const polys = coordinates as MultiPolygonCoords;
        let bbox = { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity };
        for (const p of polys) bbox = mergeBbox(bbox, computeBboxPolygon(p));
        out.push({ iso2, geometryType: "MultiPolygon", coordinates: polys, bbox });
      }
    }
    return out;
  })();

  return countriesPromise;
}

export async function resolveCountryCodeByLatLng(lat?: number, lng?: number): Promise<string | undefined> {
  if (lat === undefined || lng === undefined) return undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;

  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (guessCountryCache.has(key)) return guessCountryCache.get(key);

  try {
    const countries = await loadCountries();
    for (const c of countries) {
      if (lng < c.bbox.minLng || lng > c.bbox.maxLng || lat < c.bbox.minLat || lat > c.bbox.maxLat) continue;
      const hit = c.geometryType === "Polygon"
        ? pointInPolygon(lng, lat, c.coordinates as PolygonCoords)
        : pointInMultiPolygon(lng, lat, c.coordinates as MultiPolygonCoords);
      if (hit) {
        guessCountryCache.set(key, c.iso2);
        return c.iso2;
      }
    }
  } catch {
    // Fail soft; caller keeps undefined.
  }

  guessCountryCache.set(key, undefined);
  return undefined;
}
