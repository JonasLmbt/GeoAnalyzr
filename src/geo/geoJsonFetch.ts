import { unzipSync, strFromU8 } from "fflate";
import { getGmXmlhttpRequest } from "../gm";

function hasGmXhr(): boolean {
  return typeof getGmXmlhttpRequest() === "function";
}

function gmGet(url: string, opts: { accept?: string; responseType?: "text" | "arraybuffer" }): Promise<{ status: number; text?: string; buf?: ArrayBuffer }> {
  return new Promise((resolve, reject) => {
    const gm = getGmXmlhttpRequest();
    if (!gm) return reject(new Error("GM_xmlhttpRequest is not available."));
    const accept = opts.accept ?? "application/json";
    const responseType = opts.responseType ?? "text";
    gm({
      method: "GET",
      url,
      headers: { Accept: accept },
      responseType,
      onload: (res: any) => {
        const status = typeof res?.status === "number" ? res.status : 0;
        if (status >= 400) return reject(new Error(`HTTP ${status} for ${url}`));
        if (responseType === "arraybuffer") {
          const buf = res?.response;
          if (buf instanceof ArrayBuffer) return resolve({ status, buf });
          try {
            // Some managers expose `response` as Uint8Array.
            if (buf && typeof buf === "object" && typeof buf.byteLength === "number") {
              const u8 = new Uint8Array(buf as any);
              return resolve({ status, buf: u8.buffer });
            }
          } catch {
            // ignore
          }
          return reject(new Error(`No arraybuffer response for ${url}`));
        }
        const text = typeof res?.responseText === "string" ? res.responseText : "";
        resolve({ status, text });
      },
      onerror: (err: any) => reject(err instanceof Error ? err : new Error(`GM_xmlhttpRequest failed for ${url}`)),
      ontimeout: () => reject(new Error("GM_xmlhttpRequest timeout"))
    });
  });
}

async function fetchText(url: string, accept?: string): Promise<string> {
  if (hasGmXhr()) {
    const res = await gmGet(url, { accept, responseType: "text" });
    return res.text ?? "";
  }
  const res = await fetch(url, { headers: { Accept: accept ?? "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function fetchArrayBuffer(url: string, accept?: string): Promise<ArrayBuffer> {
  if (hasGmXhr()) {
    const res = await gmGet(url, { accept, responseType: "arraybuffer" });
    if (!res.buf) throw new Error(`No arraybuffer for ${url}`);
    return res.buf;
  }
  const res = await fetch(url, { headers: { Accept: accept ?? "application/octet-stream" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.arrayBuffer();
}

function isGitLfsPointer(text: string): boolean {
  return text.startsWith("version https://git-lfs.github.com/spec/v1");
}

function parseGeoBoundariesPrefixFromUrl(url: string): { prefix: string; baseName: string; zipUrl: string; entryName: string } | null {
  const baseName = url.split("/").pop() ?? "";
  const m = baseName.match(/^(geoBoundaries-[A-Z]{3}-ADM\\d)_simplified\\.geojson$/);
  if (!m) return null;
  const prefix = m[1];
  const zipUrl = url.slice(0, url.length - baseName.length) + `${prefix}-all.zip`;
  const entryName = `${prefix}_simplified.geojson`;
  return { prefix, baseName, zipUrl, entryName };
}

const geoJsonCache = new Map<string, Promise<any>>();

export function loadGeoJson(url: string): Promise<any> {
  const existing = geoJsonCache.get(url);
  if (existing) return existing;

  const p = (async () => {
    let text: string;
    try {
      text = await fetchText(url, "application/json");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`GeoJSON fetch failed for ${url}: ${msg}`);
    }
    if (!text) throw new Error(`Empty response for ${url}`);

    if (isGitLfsPointer(text)) {
      const parsed = parseGeoBoundariesPrefixFromUrl(url);
      if (!parsed) throw new Error(`Git LFS pointer returned for ${url}`);
      let zipBuf: ArrayBuffer;
      try {
        zipBuf = await fetchArrayBuffer(parsed.zipUrl, "application/zip");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`GeoJSON zip fetch failed for ${parsed.zipUrl}: ${msg}`);
      }
      const files = unzipSync(new Uint8Array(zipBuf));
      const entry = (files as any)[parsed.entryName] as Uint8Array | undefined;
      const found = entry ?? Object.entries(files).find(([k]) => k.endsWith(parsed.entryName))?.[1];
      if (!found) throw new Error(`Missing ${parsed.entryName} in ${parsed.zipUrl}`);
      return JSON.parse(strFromU8(found as Uint8Array));
    }

    return JSON.parse(text);
  })();

  geoJsonCache.set(url, p);
  return p;
}
