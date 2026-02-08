import { httpGetJson } from "./http";
import { iso1A2Code } from "@rapideditor/country-coder";

const guessCountryCache = new Map<string, string | undefined>();

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
export async function resolveCountryCodeByLatLng(lat?: number, lng?: number): Promise<string | undefined> {
  const norm = normalizeLatLng(lat, lng);
  if (!isFiniteNumber(norm.lat) || !isFiniteNumber(norm.lng)) return undefined;

  const key = `${norm.lat.toFixed(5)},${norm.lng.toFixed(5)}`;
  if (guessCountryCache.has(key)) return guessCountryCache.get(key);

  // 1) Fast local lookup (no network)
  const local = iso1A2Code([norm.lng, norm.lat]); // IMPORTANT: [lng, lat]
  const isoLocal = normalizeIso2(local);

  if (isoLocal) {
    guessCountryCache.set(key, isoLocal);
    return isoLocal;
  }

  // 2) Optional fallback (network) for edge cases / disputed borders / coastal points
  const fallback = await reverseGeocodeCountry(norm.lat, norm.lng);
  if (fallback) {
    guessCountryCache.set(key, fallback);
    return fallback;
  }

  guessCountryCache.set(key, undefined);
  return undefined;
}
