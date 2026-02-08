import { httpGetJson } from "./http";

type Position = [number, number]; // [lng, lat]
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

function normalizeIso2(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const x = v.trim().toLowerCase();
  return /^[a-z]{2}$/.test(x) ? x : undefined;
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function normalizeLatLng(
  lat?: number,
  lng?: number
): { lat?: number; lng?: number } {
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return { lat: undefined, lng: undefined };

  // If swapped by caller (common): lat looks like a longitude and lng looks like a latitude
  const latLooksLikeLng = Math.abs(lat) > 90 && Math.abs(lat) <= 180;
  const lngLooksLikeLat = Math.abs(lng) <= 90;

  if (latLooksLikeLng && lngLooksLikeLat) {
    return { lat: lng, lng: lat };
  }

  // Hard validation
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { lat: undefined, lng: undefined };
  }

  return { lat, lng };
}

function computeBboxPolygon(coords: PolygonCoords) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;

  for (const ring of coords) {
    for (const pos of ring) {
      const lng = pos?.[0];
      const lat = pos?.[1];
      if (!isFiniteNumber(lng) || !isFiniteNumber(lat)) continue;

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
  function pointOnSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): boolean {
    const eps = 1e-12;
    const cross = (px - x1) * (y2 - y1) - (py - y1) * (x2 - x1);
    if (Math.abs(cross) > eps) return false;
    const dot = (px - x1) * (px - x2) + (py - y1) * (py - y2);
    return dot <= eps;
  }

  // Ray casting algorithm, [x,y] = [lng,lat]
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];

    // Skip invalid points (defensive)
    if (!isFiniteNumber(xi) || !isFiniteNumber(yi) || !isFiniteNumber(xj) || !isFiniteNumber(yj)) continue;

    // Treat boundary points as inside.
    if (pointOnSegment(lng, lat, xi, yi, xj, yj)) return true;

    const intersects =
      (yi > lat) !== (yj > lat) &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;

    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lng: number, lat: number, poly: PolygonCoords): boolean {
  if (!Array.isArray(poly) || poly.length === 0) return false;

  // Outer ring
  if (!pointInRing(lng, lat, poly[0])) return false;

  // Holes
  for (let i = 1; i < poly.length; i++) {
    if (pointInRing(lng, lat, poly[i])) return false;
  }
  return true;
}

function pointInMultiPolygon(lng: number, lat: number, mpoly: MultiPolygonCoords): boolean {
  if (!Array.isArray(mpoly)) return false;
  for (const poly of mpoly) {
    if (pointInPolygon(lng, lat, poly)) return true;
  }
  return false;
}

function parseGeoJsonMaybe(data: unknown): any {
  if (data && typeof data === "object") return data;
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return null;
}

function getIso2FromProperties(props: any): string {
  const candidates = [
    props?.ISO_A2,
    props?.iso_a2,
    props?.ISO2,
    props?.iso2,
    props?.ADMIN?.ISO_A2
  ];

  for (const c of candidates) {
    if (typeof c === "string" && c.length === 2 && c !== "-99") return c.toLowerCase();
  }
  return "";
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

        // res.data might be an object OR a string
        const parsed = parseGeoJsonMaybe(res.data);
        if (res.status >= 200 && res.status < 300 && parsed?.features) {
          geo = parsed;
          break;
        }

        lastErr = new Error(`Country GeoJSON invalid or HTTP ${res.status}`);
      } catch (e) {
        lastErr = e;
      }
    }

    if (!geo) throw lastErr instanceof Error ? lastErr : new Error("Country GeoJSON load failed");

    const features = Array.isArray(geo.features) ? geo.features : [];
    const out: CountryFeature[] = [];

    for (const f of features) {
      const iso2 = getIso2FromProperties(f?.properties);
      if (!iso2) continue;

      const type = f?.geometry?.type;
      const coordinates = f?.geometry?.coordinates;

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

async function reverseGeocodeCountry(lat: number, lng: number): Promise<string | undefined> {
  const urls = [
    `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(
      String(lat)
    )}&longitude=${encodeURIComponent(String(lng))}&localityLanguage=en`
  ];

  for (const url of urls) {
    try {
      const res = await httpGetJson(url, { forceGm: true });
      if (res.status < 200 || res.status >= 300) continue;
      const iso2 = normalizeIso2(
        (res.data as any)?.countryCode ??
          (res.data as any)?.country_code ??
          (res.data as any)?.countryCodeAlpha2
      );
      if (iso2) return iso2;
    } catch {
      // try next provider
    }
  }
  return undefined;
}

export async function resolveCountryCodeByLatLng(lat?: number, lng?: number): Promise<string | undefined> {
  const norm = normalizeLatLng(lat, lng);
  if (!isFiniteNumber(norm.lat) || !isFiniteNumber(norm.lng)) return undefined;

  // Cache key based on normalized values
  const key = `${norm.lat.toFixed(5)},${norm.lng.toFixed(5)}`;
  if (guessCountryCache.has(key)) return guessCountryCache.get(key);

  try {
    const countries = await loadCountries();
    if (!countries.length) {
      console.warn("No countries loaded");
      guessCountryCache.set(key, undefined);
      return undefined;
    }

    for (const c of countries) {
      const { minLng, maxLng, minLat, maxLat } = c.bbox;
      if (norm.lng < minLng || norm.lng > maxLng || norm.lat < minLat || norm.lat > maxLat) continue;

      const hit =
        c.geometryType === "Polygon"
          ? pointInPolygon(norm.lng, norm.lat, c.coordinates as PolygonCoords)
          : pointInMultiPolygon(norm.lng, norm.lat, c.coordinates as MultiPolygonCoords);

      if (hit) {
        guessCountryCache.set(key, c.iso2);
        return c.iso2;
      }
    }

    // Fallback for rare polygon misses / border quirks.
    const fallback = await reverseGeocodeCountry(norm.lat, norm.lng);
    if (fallback) {
      guessCountryCache.set(key, fallback);
      return fallback;
    }
  } catch (e) {
    console.error("resolveCountryCodeByLatLng failed:", e);
  }

  guessCountryCache.set(key, undefined);
  return undefined;
}
