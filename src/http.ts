type HttpResult = {
  status: number;
  text: string;
  json: () => any;
};

function hasGmXhr(): boolean {
  return typeof (globalThis as any).GM_xmlhttpRequest === "function";
}

function gmRequest(url: string, opts?: { ncfa?: string; headers?: Record<string, string> }): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const gm = (globalThis as any).GM_xmlhttpRequest;
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(opts?.headers || {})
    };
    if (opts?.ncfa) headers.Cookie = `_ncfa=${opts.ncfa}`;
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
  const ncfa = opts?.ncfa;
  if ((opts?.forceGm || ncfa) && hasGmXhr()) {
    const res = await gmRequest(url, { ncfa, headers: opts?.headers });
    return { status: res.status, data: res.json() };
  }

  const res = await fetch(url, { credentials: "include", headers: opts?.headers });
  const data = await res.json();
  return { status: res.status, data };
}
