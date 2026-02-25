import { getGmXmlhttpRequest, hasGmXmlhttpRequest } from "./gm";

type HttpResult = {
  status: number;
  text: string;
  json: () => any;
};

function readNcfaFromDocumentCookie(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const raw = typeof document.cookie === "string" ? document.cookie : "";
  if (!raw) return undefined;
  const parts = raw.split(";");
  for (const part of parts) {
    const [k, ...rest] = part.trim().split("=");
    if (k !== "_ncfa") continue;
    const value = rest.join("=").trim();
    if (value) return value;
  }
  return undefined;
}

function gmRequest(url: string, opts?: { ncfa?: string; headers?: Record<string, string> }): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const gm = getGmXmlhttpRequest();
    if (!gm) return reject(new Error("GM_xmlhttpRequest is not available."));
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(opts?.headers || {})
    };
    const ncfa = opts?.ncfa || readNcfaFromDocumentCookie();
    if (ncfa) headers.Cookie = `_ncfa=${ncfa}`;
    gm({
      method: "GET",
      url,
      headers,
      onload: (res: any) => {
        const text = typeof res?.responseText === "string" ? res.responseText : "";
        resolve({
          status: Number(res?.status) || 0,
          text,
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

export async function httpGetJson(url: string, opts?: { ncfa?: string; forceGm?: boolean; headers?: Record<string, string> }): Promise<{ status: number; data: any }> {
  const ncfa = opts?.ncfa || readNcfaFromDocumentCookie();
  if ((opts?.forceGm || ncfa) && hasGmXmlhttpRequest()) {
    const res = await gmRequest(url, { ncfa, headers: opts?.headers });
    return { status: res.status, data: res.json() };
  }

  const res = await fetch(url, { credentials: "include", headers: opts?.headers });
  const data = await res.json();
  return { status: res.status, data };
}
