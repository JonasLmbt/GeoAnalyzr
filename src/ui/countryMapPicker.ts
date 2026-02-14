const WORLD_GEOJSON_URL = "https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json";
const ISO_MAP_URL = "https://cdn.jsdelivr.net/npm/world-countries@5.1.0/countries.json";

let dataPromise: Promise<{ geojson: any; iso3ToIso2: Map<string, string> }> | null = null;

function hasGmXhr(): boolean {
  return typeof (globalThis as any).GM_xmlhttpRequest === "function";
}

function gmGetText(url: string, accept?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const gm = (globalThis as any).GM_xmlhttpRequest;
    gm({
      method: "GET",
      url,
      headers: { Accept: accept ?? "application/json" },
      onload: (res: any) => resolve(typeof res?.responseText === "string" ? res.responseText : ""),
      onerror: (err: any) => reject(err),
      ontimeout: () => reject(new Error("GM_xmlhttpRequest timeout"))
    });
  });
}

async function fetchJson(url: string): Promise<any> {
  if (hasGmXhr()) {
    const txt = await gmGetText(url, "application/json");
    return JSON.parse(txt);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function normalizeIso2(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const x = v.trim().toLowerCase();
  return /^[a-z]{2}$/.test(x) ? x : null;
}

async function loadData(): Promise<{ geojson: any; iso3ToIso2: Map<string, string> }> {
  if (!dataPromise) {
    dataPromise = (async () => {
      const [geojson, countries] = await Promise.all([fetchJson(WORLD_GEOJSON_URL), fetchJson(ISO_MAP_URL)]);
      const iso3ToIso2 = new Map<string, string>();
      if (Array.isArray(countries)) {
        for (const c of countries) {
          const iso2 = typeof c?.cca2 === "string" ? c.cca2.trim().toLowerCase() : "";
          const iso3 = typeof c?.cca3 === "string" ? c.cca3.trim().toUpperCase() : "";
          if (iso2 && iso3) iso3ToIso2.set(iso3, iso2);
        }
      }
      return { geojson, iso3ToIso2 };
    })();
  }
  return dataPromise;
}

type Viewport = { scale: number; tx: number; ty: number };

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function project(lon: number, lat: number, w: number, h: number): [number, number] {
  // Simple equirectangular projection.
  const x = ((lon + 180) / 360) * w;
  const y = ((90 - lat) / 180) * h;
  return [x, y];
}

function pathFromGeo(
  geometry: any,
  w: number,
  h: number
): string {
  const d: string[] = [];
  const addRing = (ring: any[]) => {
    if (!Array.isArray(ring) || ring.length < 2) return;
    const pts = ring
      .map((p) => (Array.isArray(p) && p.length >= 2 ? [Number(p[0]), Number(p[1])] : null))
      .filter((p): p is [number, number] => !!p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (pts.length < 2) return;
    const [x0, y0] = project(pts[0][0], pts[0][1], w, h);
    d.push(`M${x0.toFixed(2)},${y0.toFixed(2)}`);
    for (let i = 1; i < pts.length; i++) {
      const [x, y] = project(pts[i][0], pts[i][1], w, h);
      d.push(`L${x.toFixed(2)},${y.toFixed(2)}`);
    }
    d.push("Z");
  };

  const type = geometry?.type;
  const coords = geometry?.coordinates;
  if (!type || !coords) return "";

  if (type === "Polygon") {
    for (const ring of coords as any[]) addRing(ring);
    return d.join(" ");
  }

  if (type === "MultiPolygon") {
    for (const poly of coords as any[]) {
      for (const ring of poly as any[]) addRing(ring);
    }
    return d.join(" ");
  }

  return "";
}

function applyViewport(g: SVGGElement, vp: Viewport): void {
  g.setAttribute("transform", `translate(${vp.tx.toFixed(2)} ${vp.ty.toFixed(2)}) scale(${vp.scale.toFixed(4)})`);
}

export async function renderCountryMapPicker(args: {
  container: HTMLElement;
  value: string;
  selectableValues?: string[];
  tintSelectable?: boolean;
  onChange: (iso2: string) => void;
}): Promise<void> {
  const { container, value, onChange } = args;
  const doc = container.ownerDocument;
  container.innerHTML = "";
  container.classList.add("ga-country-map");

  const selectableMap = new Map<string, string>();
  if (Array.isArray(args.selectableValues)) {
    for (const v of args.selectableValues) {
      const norm = normalizeIso2(v);
      if (!norm) continue;
      if (!selectableMap.has(norm)) selectableMap.set(norm, String(v));
    }
  }
  const hasSelectableFilter = selectableMap.size > 0;
  const tintSelectable = args.tintSelectable !== false;

  let geojson: any;
  let iso3ToIso2: Map<string, string>;
  try {
    ({ geojson, iso3ToIso2 } = await loadData());
  } catch (e) {
    const msg = doc.createElement("div");
    msg.className = "ga-filter-map-error";
    msg.textContent = "Map unavailable (network/CSP).";
    container.appendChild(msg);
    throw e;
  }

  const wrap = doc.createElement("div");
  wrap.className = "ga-country-map-wrap";
  container.appendChild(wrap);

  const toolbar = doc.createElement("div");
  toolbar.className = "ga-country-map-toolbar";
  wrap.appendChild(toolbar);

  const btnMinus = doc.createElement("button");
  btnMinus.type = "button";
  btnMinus.className = "ga-country-map-btn";
  btnMinus.textContent = "−";
  btnMinus.title = "Zoom out";

  const btnPlus = doc.createElement("button");
  btnPlus.type = "button";
  btnPlus.className = "ga-country-map-btn";
  btnPlus.textContent = "+";
  btnPlus.title = "Zoom in";

  const hint = doc.createElement("div");
  hint.className = "ga-country-map-hint";
  hint.textContent = "Scroll to zoom, drag to pan, click to select.";

  toolbar.appendChild(btnMinus);
  toolbar.appendChild(btnPlus);
  toolbar.appendChild(hint);

  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("ga-country-map-svg");
  wrap.appendChild(svg);

  const W = 1000;
  const H = 500;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  const g = doc.createElementNS("http://www.w3.org/2000/svg", "g");
  svg.appendChild(g);

  const features = Array.isArray(geojson?.features) ? geojson.features : [];
  const pathsByIso2 = new Map<string, SVGPathElement[]>();

  for (const f of features) {
    const iso3 = typeof f?.id === "string" ? String(f.id).trim().toUpperCase() : "";
    const iso2 = iso3 ? iso3ToIso2.get(iso3) : undefined;
    if (!iso2) continue;

    const d = pathFromGeo(f.geometry, W, H);
    if (!d) continue;

    const p = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    p.setAttribute("fill-rule", "evenodd");
    p.dataset.iso2 = iso2;
    p.classList.add("ga-country-shape");
    const isSelectable = !hasSelectableFilter || selectableMap.has(iso2);
    if (isSelectable) {
      if (tintSelectable) p.classList.add("selectable");
    } else {
      p.classList.add("disabled");
    }
    g.appendChild(p);

    const list = pathsByIso2.get(iso2) ?? [];
    list.push(p);
    pathsByIso2.set(iso2, list);
  }

  let selected = normalizeIso2(value);

  const refreshActive = () => {
    for (const [iso2, list] of pathsByIso2.entries()) {
      const active = !!selected && iso2 === selected;
      for (const el of list) el.classList.toggle("active", active);
    }
  };
  refreshActive();

  for (const [iso2, list] of pathsByIso2.entries()) {
    const isSelectable = !hasSelectableFilter || selectableMap.has(iso2);
    if (!isSelectable) continue;
    for (const el of list) {
      el.addEventListener("pointerenter", () => el.classList.add("hover"));
      el.addEventListener("pointerleave", () => el.classList.remove("hover"));
    }
  }

  let vp: Viewport = { scale: 1, tx: 0, ty: 0 };
  applyViewport(g, vp);

  const zoomAt = (px: number, py: number, nextScale: number) => {
    const s0 = vp.scale;
    const sx = (px - vp.tx) / s0;
    const sy = (py - vp.ty) / s0;
    vp = {
      scale: nextScale,
      tx: px - nextScale * sx,
      ty: py - nextScale * sy
    };
    applyViewport(g, vp);
  };

  const rectPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const r = svg.getBoundingClientRect();
    const x = ((clientX - r.left) / Math.max(1, r.width)) * W;
    const y = ((clientY - r.top) / Math.max(1, r.height)) * H;
    return { x, y };
  };

  svg.addEventListener(
    "wheel",
    (ev) => {
      ev.preventDefault();
      const { x, y } = rectPoint((ev as WheelEvent).clientX, (ev as WheelEvent).clientY);
      const dir = (ev as WheelEvent).deltaY > 0 ? 0.9 : 1.1;
      const nextScale = clamp(vp.scale * dir, 1, 8);
      zoomAt(x, y, nextScale);
    },
    { passive: false }
  );

  let dragging = false;
  let moved = false;
  let dragStart: { x: number; y: number; tx: number; ty: number; hitIso2?: string | null } | null = null;
  svg.addEventListener("pointerdown", (ev) => {
    dragging = true;
    moved = false;
    (svg as any).setPointerCapture?.((ev as PointerEvent).pointerId);
    const { x, y } = rectPoint((ev as PointerEvent).clientX, (ev as PointerEvent).clientY);
    const target = (ev as PointerEvent).target as Element | null;
    const hit = target?.closest?.("path.ga-country-shape") as SVGPathElement | null;
    const hitIso2 = normalizeIso2(hit?.dataset?.iso2) ?? null;
    const isSelectable = !hasSelectableFilter || (hitIso2 ? selectableMap.has(hitIso2) : false);
    dragStart = { x, y, tx: vp.tx, ty: vp.ty, hitIso2: isSelectable ? hitIso2 : null };
  });
  svg.addEventListener("pointermove", (ev) => {
    if (!dragging || !dragStart) return;
    const { x, y } = rectPoint((ev as PointerEvent).clientX, (ev as PointerEvent).clientY);
    const dx = x - dragStart.x;
    const dy = y - dragStart.y;
    if (!moved && (dx * dx + dy * dy) > 6 * 6) moved = true;
    vp = { ...vp, tx: dragStart.tx + (x - dragStart.x), ty: dragStart.ty + (y - dragStart.y) };
    applyViewport(g, vp);
  });
  const stopDrag = () => {
    dragging = false;
    dragStart = null;
  };
  svg.addEventListener("pointerup", () => {
    if (dragging && dragStart && !moved && dragStart.hitIso2) {
      selected = dragStart.hitIso2;
      refreshActive();
      onChange(selectableMap.get(dragStart.hitIso2) ?? dragStart.hitIso2);
    }
    stopDrag();
  });
  svg.addEventListener("pointercancel", stopDrag);

  btnPlus.addEventListener("click", () => {
    zoomAt(W / 2, H / 2, clamp(vp.scale * 1.25, 1, 8));
  });
  btnMinus.addEventListener("click", () => {
    zoomAt(W / 2, H / 2, clamp(vp.scale / 1.25, 1, 8));
  });
}
