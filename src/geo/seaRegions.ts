import { loadGeoJson } from "./geoJsonFetch";

const PH_PROVINCES_GEOJSON_URL =
  "https://github.com/wmgeolab/geoBoundaries/raw/41af8f1/releaseData/gbOpen/PHL/ADM1/geoBoundaries-PHL-ADM1_simplified.geojson";
const VN_PROVINCES_GEOJSON_URL =
  "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/VNM/ADM1/geoBoundaries-VNM-ADM1_simplified.geojson";

type BBox = { minLon: number; minLat: number; maxLon: number; maxLat: number };

function bboxForCoords(coords: any, bbox: BBox): void {
  if (!Array.isArray(coords)) return;
  if (coords.length >= 2 && typeof coords[0] === "number" && typeof coords[1] === "number") {
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    bbox.minLon = Math.min(bbox.minLon, lon);
    bbox.maxLon = Math.max(bbox.maxLon, lon);
    bbox.minLat = Math.min(bbox.minLat, lat);
    bbox.maxLat = Math.max(bbox.maxLat, lat);
    return;
  }
  for (const c of coords) bboxForCoords(c, bbox);
}

function bboxForGeometry(geom: any): BBox | null {
  const coords = geom?.coordinates;
  if (!coords) return null;
  const bbox: BBox = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity };
  bboxForCoords(coords, bbox);
  if (![bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat].every((x) => Number.isFinite(x))) return null;
  return bbox;
}

function pointInRing(lon: number, lat: number, ring: any[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]?.[0];
    const yi = ring[i]?.[1];
    const xj = ring[j]?.[0];
    const yj = ring[j]?.[1];
    if (![xi, yi, xj, yj].every((x) => typeof x === "number" && Number.isFinite(x))) continue;
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lon: number, lat: number, poly: any[]): boolean {
  if (!Array.isArray(poly) || poly.length === 0) return false;
  const outer = poly[0];
  if (!Array.isArray(outer) || outer.length < 3) return false;
  if (!pointInRing(lon, lat, outer)) return false;
  for (let i = 1; i < poly.length; i++) {
    const hole = poly[i];
    if (Array.isArray(hole) && hole.length >= 3 && pointInRing(lon, lat, hole)) return false;
  }
  return true;
}

function pointInGeometry(lon: number, lat: number, geom: any): boolean {
  const type = geom?.type;
  const coords = geom?.coordinates;
  if (!type || !coords) return false;
  if (type === "Polygon") return pointInPolygon(lon, lat, coords);
  if (type === "MultiPolygon") {
    for (const poly of coords as any[]) {
      if (pointInPolygon(lon, lat, poly)) return true;
    }
  }
  return false;
}

type FeatureIndexItem = { name: string; bbox: BBox; geom: any };

let phIndexPromise: Promise<FeatureIndexItem[]> | null = null;
let vnIndexPromise: Promise<FeatureIndexItem[]> | null = null;

async function loadPhIndex(): Promise<FeatureIndexItem[]> {
  if (!phIndexPromise) {
    phIndexPromise = (async () => {
      const geo = await loadGeoJson(PH_PROVINCES_GEOJSON_URL);
      const feats = Array.isArray(geo?.features) ? geo.features : [];
      const out: FeatureIndexItem[] = [];
      for (const f of feats) {
        const name = typeof f?.properties?.shapeName === "string" ? f.properties.shapeName.trim() : "";
        const bbox = bboxForGeometry(f?.geometry);
        if (!name || !bbox || !f?.geometry) continue;
        out.push({ name, bbox, geom: f.geometry });
      }
      return out;
    })();
  }
  return phIndexPromise;
}

async function loadVnIndex(): Promise<FeatureIndexItem[]> {
  if (!vnIndexPromise) {
    vnIndexPromise = (async () => {
      const geo = await loadGeoJson(VN_PROVINCES_GEOJSON_URL);
      const feats = Array.isArray(geo?.features) ? geo.features : [];
      const out: FeatureIndexItem[] = [];
      for (const f of feats) {
        const name = typeof f?.properties?.shapeName === "string" ? f.properties.shapeName.trim() : "";
        const bbox = bboxForGeometry(f?.geometry);
        if (!name || !bbox || !f?.geometry) continue;
        out.push({ name, bbox, geom: f.geometry });
      }
      return out;
    })();
  }
  return vnIndexPromise;
}

function memoKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

function bboxContains(b: BBox, lon: number, lat: number): boolean {
  return lon >= b.minLon && lon <= b.maxLon && lat >= b.minLat && lat <= b.maxLat;
}

const phMemo = new Map<string, string>();
const vnMemo = new Map<string, string>();

export async function resolvePhProvinceByLatLng(lat: number, lng: number): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const key = memoKey(lat, lng);
  const cached = phMemo.get(key);
  if (cached) return cached;
  const lon = lng;
  const items = await loadPhIndex();
  for (const it of items) {
    if (!bboxContains(it.bbox, lon, lat)) continue;
    if (pointInGeometry(lon, lat, it.geom)) {
      phMemo.set(key, it.name);
      return it.name;
    }
  }
  return null;
}

export async function resolveVnProvinceByLatLng(lat: number, lng: number): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const key = memoKey(lat, lng);
  const cached = vnMemo.get(key);
  if (cached) return cached;
  const lon = lng;
  const items = await loadVnIndex();
  for (const it of items) {
    if (!bboxContains(it.bbox, lon, lat)) continue;
    if (pointInGeometry(lon, lat, it.geom)) {
      vnMemo.set(key, it.name);
      return it.name;
    }
  }
  return null;
}
