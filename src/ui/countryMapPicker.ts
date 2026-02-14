const LEAFLET_JS = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js";
const LEAFLET_CSS = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css";

const WORLD_GEOJSON_URL = "https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json";
const ISO_MAP_URL = "https://cdn.jsdelivr.net/npm/world-countries@5.1.0/countries.json";

let leafletPromise: Promise<any> | null = null;
let worldPromise: Promise<{ geojson: any; iso3ToIso2: Map<string, string> }> | null = null;

function ensureLink(doc: Document, href: string): void {
  const head = doc.head ?? doc.querySelector("head");
  if (!head) return;
  const exists = Array.from(head.querySelectorAll("link[rel=\"stylesheet\"]")).some((l) => (l as HTMLLinkElement).href === href);
  if (exists) return;
  const link = doc.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  head.appendChild(link);
}

function ensureScript(doc: Document, src: string): Promise<void> {
  const head = doc.head ?? doc.querySelector("head");
  if (!head) return Promise.resolve();
  const exists = Array.from(head.querySelectorAll("script")).some((s) => (s as HTMLScriptElement).src === src);
  if (exists) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = doc.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    head.appendChild(s);
  });
}

async function ensureLeaflet(doc: Document): Promise<any> {
  const w = doc.defaultView as any;
  if (w?.L) return w.L;
  if (!leafletPromise) {
    leafletPromise = (async () => {
      ensureLink(doc, LEAFLET_CSS);
      await ensureScript(doc, LEAFLET_JS);
    })();
  }
  await leafletPromise;
  return (doc.defaultView as any)?.L;
}

async function loadIso3ToIso2(): Promise<Map<string, string>> {
  const res = await fetch(ISO_MAP_URL);
  if (!res.ok) throw new Error(`Failed to fetch ISO map (${res.status})`);
  const data = await res.json();
  const iso3ToIso2 = new Map<string, string>();
  if (Array.isArray(data)) {
    for (const c of data) {
      const iso2 = typeof c?.cca2 === "string" ? c.cca2.trim().toLowerCase() : "";
      const iso3 = typeof c?.cca3 === "string" ? c.cca3.trim().toUpperCase() : "";
      if (iso2 && iso3) iso3ToIso2.set(iso3, iso2);
    }
  }
  return iso3ToIso2;
}

async function loadWorldData(): Promise<{ geojson: any; iso3ToIso2: Map<string, string> }> {
  if (!worldPromise) {
    worldPromise = (async () => {
      const [geoRes, iso3ToIso2] = await Promise.all([fetch(WORLD_GEOJSON_URL), loadIso3ToIso2()]);
      if (!geoRes.ok) throw new Error(`Failed to fetch world geojson (${geoRes.status})`);
      const geojson = await geoRes.json();
      return { geojson, iso3ToIso2 };
    })();
  }
  return worldPromise;
}

function normalizeIso2(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const x = v.trim().toLowerCase();
  return /^[a-z]{2}$/.test(x) ? x : null;
}

export async function renderCountryMapPicker(args: {
  container: HTMLElement;
  value: string;
  onChange: (iso2: string) => void;
}): Promise<void> {
  const { container, value, onChange } = args;
  const doc = container.ownerDocument;
  container.innerHTML = "";

  const L = await ensureLeaflet(doc);
  if (!L) {
    container.textContent = "Map failed to load.";
    return;
  }

  const { geojson, iso3ToIso2 } = await loadWorldData();

  const mapEl = doc.createElement("div");
  mapEl.className = "ga-country-map";
  container.appendChild(mapEl);

  const map = L.map(mapEl, {
    zoomControl: true,
    attributionControl: false,
    worldCopyJump: true,
    preferCanvas: true
  });

  map.setView([20, 0], 2);

  let selectedIso2 = normalizeIso2(value);

  const baseStyle = (isActive: boolean) => ({
    color: "rgba(255,255,255,0.22)",
    weight: isActive ? 2 : 1,
    fillColor: isActive ? "rgba(254,205,25,0.40)" : "rgba(255,255,255,0.06)",
    fillOpacity: isActive ? 0.65 : 0.25
  });

  const features = Array.isArray(geojson?.features) ? geojson.features : [];
  for (const f of features) {
    const iso3 = typeof f?.id === "string" ? String(f.id).trim().toUpperCase() : "";
    const iso2 = iso3 ? iso3ToIso2.get(iso3) : undefined;
    if (iso2) {
      if (!f.properties || typeof f.properties !== "object") f.properties = {};
      f.properties.iso2 = iso2;
    }
  }

  const layer = L.geoJSON(geojson, {
    style: (feature: any) => {
      const iso2 = normalizeIso2(feature?.properties?.iso2);
      const active = !!iso2 && !!selectedIso2 && iso2 === selectedIso2;
      return baseStyle(active);
    },
    onEachFeature: (feature: any, lyr: any) => {
      const iso2 = normalizeIso2(feature?.properties?.iso2);
      if (!iso2) return;

      lyr.on("mouseover", () => lyr.setStyle({ fillOpacity: 0.45 }));
      lyr.on("mouseout", () => lyr.setStyle(baseStyle(iso2 === selectedIso2)));
      lyr.on("click", () => {
        selectedIso2 = iso2;
        layer.eachLayer((l: any) => {
          const f = l?.feature;
          const i2 = normalizeIso2(f?.properties?.iso2);
          if (!i2) return;
          l.setStyle(baseStyle(i2 === selectedIso2));
        });
        onChange(iso2);
      });
    }
  }).addTo(map);

  try {
    const bounds = layer.getBounds?.();
    if (bounds && bounds.isValid?.()) map.fitBounds(bounds, { padding: [6, 6] });
  } catch {
    // ignore
  }
}

