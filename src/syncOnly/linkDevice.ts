import { saveServerSyncSettings } from "../serverSync";
import { getGmXmlhttpRequest } from "../gm";

const LINK_ORIGIN = "https://geoanalyzr.lmbt.app";

export async function linkDeviceViaDiscord(): Promise<{ token: string; endpointUrl?: string }> {
  const gm = getGmXmlhttpRequest();
  if (!gm) throw new Error("GM_xmlhttpRequest is not available.");

  const pairStartUrl = `${LINK_ORIGIN}/pair/start`;
  const pair = await new Promise<{ linkUrl: string }>((resolve, reject) => {
    gm({
      method: "GET",
      url: pairStartUrl,
      headers: { Accept: "application/json" },
      onload: (res: any) => {
        const text = typeof res?.responseText === "string" ? res.responseText : "";
        try {
          const parsed = JSON.parse(text);
          if (!parsed?.ok || typeof parsed?.linkUrl !== "string" || !parsed.linkUrl) {
            return reject(new Error("Pairing failed (invalid response)."));
          }
          resolve({ linkUrl: String(parsed.linkUrl) });
        } catch {
          reject(new Error("Pairing failed (invalid JSON)."));
        }
      },
      onerror: (err: any) => reject(err instanceof Error ? err : new Error("Pairing failed")),
      ontimeout: () => reject(new Error("Pairing timeout"))
    });
  });

  // No overlay/popups: open a regular tab and wait for postMessage.
  const linkTab = window.open(pair.linkUrl, "_blank", "noopener,noreferrer");
  if (!linkTab) throw new Error("Could not open linking tab (popup blocked).");

  const token = await new Promise<{ token: string; endpointUrl?: string }>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Link timeout"));
    }, 2 * 60 * 1000);

    const onMsg = (ev: MessageEvent) => {
      if (ev.origin !== LINK_ORIGIN) return;
      const d: any = ev.data;
      if (!d || d.type !== "geoanalyzr_sync_token") return;
      const t = typeof d.token === "string" ? d.token.trim() : "";
      const endpointUrl = typeof d.endpointUrl === "string" ? d.endpointUrl.trim() : "";
      if (!t) return;
      cleanup();
      resolve({ token: t, endpointUrl: endpointUrl || undefined });
    };

    const cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMsg as any);
      try {
        linkTab.close();
      } catch {
        // ignore
      }
    };

    window.addEventListener("message", onMsg as any);
  });

  saveServerSyncSettings({ token: token.token, ...(token.endpointUrl ? { endpointUrl: token.endpointUrl } : {}) });
  return token;
}

