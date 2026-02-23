import { httpGetJson } from "./http";
import { iso1A2Code } from "@rapideditor/country-coder";

const guessCountryCache = new Map<string, string | undefined>();

function isInBoundingBox(lat: number, lng: number, box: { minLat: number; maxLat: number; minLng: number; maxLng: number }): boolean {
  return lat >= box.minLat && lat <= box.maxLat && lng >= box.minLng && lng <= box.maxLng;
}

// Special-case regions where some datasets/libraries may disagree on ISO2 attribution.
// GeoGuessr panorama.countryCode uses HK/MO, while some boundary datasets may return CN for those coordinates.
const HONG_KONG_BOX = { minLat: 22.13, maxLat: 22.57, minLng: 113.83, maxLng: 114.45 };
const MACAU_BOX = { minLat: 22.10, maxLat: 22.24, minLng: 113.52, maxLng: 113.61 };

function normalizeIso2(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const x = v.trim().toLowerCase();
  return /^[a-z]{2}$/.test(x) ? x : undefined;
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function normalizeLatLng(lat?: number, lng?: number): { lat?: number; lng?: number } {
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return { lat: undefined, lng: undefined };

  // Auto-swap if caller likely passed (lng, lat)
  const latLooksLikeLng = Math.abs(lat) > 90 && Math.abs(lat) <= 180;
  const lngLooksLikeLat = Math.abs(lng) <= 90;
  if (latLooksLikeLng && lngLooksLikeLat) return { lat: lng, lng: lat };

  // Hard validation
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return { lat: undefined, lng: undefined };

  return { lat, lng };
}

async function reverseGeocodeCountry(lat: number, lng: number): Promise<string | undefined> {
  const url =
    `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(String(lat))}` +
    `&longitude=${encodeURIComponent(String(lng))}&localityLanguage=en`;

  try {
    const res = await httpGetJson(url, { forceGm: true });
    if (res.status < 200 || res.status >= 300) return undefined;

    return normalizeIso2(
      (res.data as any)?.countryCode ??
        (res.data as any)?.country_code ??
        (res.data as any)?.countryCodeAlpha2
    );
  } catch {
    return undefined;
  }
}

/**
 * Resolve ISO2 country code for a coordinate.
 * Note: country-coder expects [longitude, latitude].
 */
async function resolveCountryCodeByLatLngInternal(lat?: number, lng?: number, allowNetworkFallback = true): Promise<string | undefined> {
  const norm = normalizeLatLng(lat, lng);
  if (!isFiniteNumber(norm.lat) || !isFiniteNumber(norm.lng)) return undefined;

  const key = `${norm.lat.toFixed(5)},${norm.lng.toFixed(5)}`;
  if (guessCountryCache.has(key)) return guessCountryCache.get(key);

  // Override: HK/MO should remain distinct (not collapsed into CN).
  if (isInBoundingBox(norm.lat, norm.lng, HONG_KONG_BOX)) {
    guessCountryCache.set(key, "hk");
    return "hk";
  }
  if (isInBoundingBox(norm.lat, norm.lng, MACAU_BOX)) {
    guessCountryCache.set(key, "mo");
    return "mo";
  }

  // 1) Fast local lookup (no network)
  const local = iso1A2Code([norm.lng, norm.lat]); // IMPORTANT: [lng, lat]
  const isoLocal = normalizeIso2(local);

  if (isoLocal) {
    guessCountryCache.set(key, isoLocal);
    return isoLocal;
  }

  // 2) Optional fallback (network) for edge cases / disputed borders / coastal points
  if (allowNetworkFallback) {
    const fallback = await reverseGeocodeCountry(norm.lat, norm.lng);
    if (fallback) {
      guessCountryCache.set(key, fallback);
      return fallback;
    }
  }

  guessCountryCache.set(key, undefined);
  return undefined;
}

export async function resolveCountryCodeByLatLng(lat?: number, lng?: number): Promise<string | undefined> {
  return resolveCountryCodeByLatLngInternal(lat, lng, true);
}

// For UI-time repair / best-effort enrichment without spamming network requests.
export async function resolveCountryCodeByLatLngLocalOnly(lat?: number, lng?: number): Promise<string | undefined> {
  return resolveCountryCodeByLatLngInternal(lat, lng, false);
}
