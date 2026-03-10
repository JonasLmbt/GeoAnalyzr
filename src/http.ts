import { getGmXmlhttpRequest, hasGmXmlhttpRequest } from "./gm";

type HttpResult = {
  status: number;
  text: string;
  headers: Record<string, string>;
  json: () => any;
};

function parseRawHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof raw !== "string" || !raw.trim()) return out;
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim().toLowerCase();
    const v = line.slice(idx + 1).trim();
    if (!k) continue;
    if (out[k]) out[k] = `${out[k]}, ${v}`;
    else out[k] = v;
  }
  return out;
}

function gmRequest(url: string, opts?: { headers?: Record<string, string> }): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const gm = getGmXmlhttpRequest();
    if (!gm) return reject(new Error("GM_xmlhttpRequest is not available."));
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(opts?.headers || {})
    };
    gm({
      method: "GET",
      url,
      headers,
      onload: (res: any) => {
        const text = typeof res?.responseText === "string" ? res.responseText : "";
        const rawHeaders = typeof res?.responseHeaders === "string" ? res.responseHeaders : "";
        resolve({
          status: Number(res?.status) || 0,
          text,
          headers: parseRawHeaders(rawHeaders),
          json: () => JSON.parse(text)
        });
      },
      onerror: (err: any) => {
        reject(err);
      },
      ontimeout: () => reject(new Error("GM_xmlhttpRequest timeout"))
    });
  });
}

export async function httpGetJson(
  url: string,
  opts?: { forceGm?: boolean; headers?: Record<string, string> }
): Promise<{ status: number; data: any; headers: Record<string, string>; text?: string }> {
  if (opts?.forceGm && hasGmXmlhttpRequest()) {
    const res = await gmRequest(url, { headers: opts?.headers });
    try {
      return { status: res.status, data: res.json(), headers: res.headers, text: res.text };
    } catch {
      return { status: res.status, data: null, headers: res.headers, text: res.text };
    }
  }

  const res = await fetch(url, { credentials: "include", headers: opts?.headers });
  const headers: Record<string, string> = {};
  try {
    res.headers.forEach((v, k) => {
      headers[String(k).toLowerCase()] = String(v);
    });
  } catch {
    // ignore
  }
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text), headers, text };
  } catch {
    return { status: res.status, data: null, headers, text };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function retryDelayMs(attempt: number, baseMs: number, maxMs: number): number {
  const exp = Math.min(maxMs, Math.floor(baseMs * Math.pow(2, attempt)));
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(maxMs, exp + jitter);
}

function parseRetryAfterMs(h: Record<string, string>): number | null {
  const ra = h["retry-after"];
  if (!ra) return null;
  const n = Number(ra);
  if (Number.isFinite(n) && n >= 0) return Math.floor(n * 1000);
  const t = Date.parse(ra);
  if (Number.isFinite(t)) {
    const ms = t - Date.now();
    return ms > 0 ? ms : 0;
  }
  return null;
}

export async function httpGetJsonWithRetry(
  url: string,
  opts?: { forceGm?: boolean; headers?: Record<string, string>; retries?: number; baseDelayMs?: number; maxDelayMs?: number }
): Promise<{ status: number; data: any; headers: Record<string, string>; text?: string }> {
  const retries = typeof opts?.retries === "number" && Number.isFinite(opts.retries) ? Math.max(0, Math.floor(opts.retries)) : 4;
  const baseDelayMs =
    typeof opts?.baseDelayMs === "number" && Number.isFinite(opts.baseDelayMs) ? Math.max(50, Math.floor(opts.baseDelayMs)) : 400;
  const maxDelayMs =
    typeof opts?.maxDelayMs === "number" && Number.isFinite(opts.maxDelayMs) ? Math.max(baseDelayMs, Math.floor(opts.maxDelayMs)) : 8000;

  let last: { status: number; data: any; headers: Record<string, string>; text?: string } | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await httpGetJson(url, { forceGm: opts?.forceGm, headers: opts?.headers });
    last = res;

    const status = res.status;
    const shouldRetry =
      status === 429 || status === 408 || status === 500 || status === 502 || status === 503 || status === 504 || status === 0;

    if (!shouldRetry) return res;
    if (attempt >= retries) return res;

    const ra = status === 429 ? parseRetryAfterMs(res.headers) : null;
    const waitMs = ra !== null ? Math.min(maxDelayMs, Math.max(0, ra)) : retryDelayMs(attempt, baseDelayMs, maxDelayMs);
    await sleep(waitMs);
  }
  return last ?? { status: 0, data: null, headers: {} };
}
