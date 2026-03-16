import { logoSvgMarkup } from "./ui/logo";
import { loadServerSyncSettings, runServerSyncOnceWithOptions, runServerUnsync, saveServerSyncSettings } from "./serverSync";
import { getGmXmlhttpRequest } from "./gm";

type Counts = {
  games: number;
  rounds: number;
  detailsOk: number;
  detailsError: number;
  detailsMissing: number;
};

export type UIOverlay = {
  setVisible: (visible: boolean) => void;
  setStatus: (message: string) => void;
  setCounts: (counts: Counts) => void;

  onUpdateClick: (handler: () => void | Promise<void>) => void;
  onResetClick: (handler: () => void | Promise<void>) => void;
  onExportClick: (handler: () => void | Promise<void>) => void;
  onOpenAnalysisClick: (handler: () => void | Promise<void>) => void;
  onDiscordClick: (handler: () => void | Promise<void>) => void;
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
  return document.createElement(tag);
}

function cssOnce(): void {
  const id = "geoanalyzr-ui-overlay-css";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .ga-ui-icon {
      position: fixed;
      left: 16px;
      bottom: 16px;
      z-index: 999999;
      width: 44px;
      height: 44px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.25);
      background: rgba(20,20,20,0.95);
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 6px 20px rgba(0,0,0,0.35);
    }
    .ga-ui-icon:active { transform: translateY(1px); }

    .ga-ui-panel {
      position: fixed;
      left: 16px;
      bottom: 68px;
      z-index: 999999;
      width: 360px;
      max-width: calc(100vw - 32px);
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.2);
      background: rgba(20,20,20,0.92);
      color: white;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      box-shadow: 0 10px 30px rgba(0,0,0,0.45);
      padding: 10px;
      display: none;
    }

    .ga-ui-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .ga-ui-title {
      font-weight: 700;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .ga-ui-title svg { display: block; filter: drop-shadow(0 0 10px rgba(0,162,254,0.35)); }
    .ga-ui-icon svg { display: block; filter: drop-shadow(0 0 14px rgba(0,162,254,0.40)); }
    .ga-ui-close {
      border: none;
      background: transparent;
      color: white;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      padding: 2px 6px;
    }

    .ga-ui-status {
      font-size: 12px;
      opacity: 0.95;
      white-space: pre-wrap;
      margin-bottom: 10px;
    }

    .ga-ui-btn {
      width: 100%;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.25);
      color: white;
      cursor: pointer;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
    }
    .ga-ui-btn:active { transform: translateY(1px); }
    .ga-ui-btn:disabled { opacity: 0.65; cursor: not-allowed; }
    .ga-ui-btn-icon { display: inline-flex; width: 16px; height: 16px; opacity: 0.95; }
    .ga-ui-btn-icon svg { width: 16px; height: 16px; display: block; }
    .ga-ui-actions { display:flex; flex-direction: column; gap: 8px; }

    .ga-ui-counts {
      margin-top: 10px;
      font-size: 12px;
      opacity: 0.92;
      white-space: normal;
    }

    .ga-ui-modal {
      position: fixed;
      inset: 0;
      z-index: 1000000;
      background: rgba(0,0,0,0.62);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .ga-ui-modal-card {
      width: 520px;
      max-width: calc(100vw - 32px);
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.18);
      background: rgba(20,20,20,0.94);
      box-shadow: 0 18px 60px rgba(0,0,0,0.45);
      color: white;
      padding: 12px;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    }
    .ga-ui-modal-head {
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:10px;
      margin-bottom: 10px;
    }
    .ga-ui-modal-head-title { font-weight: 700; }
    .ga-ui-modal-x { border:0; background: transparent; color: white; cursor:pointer; font-size: 18px; line-height: 1; }
    .ga-ui-modal-input {
      width: 100%;
      box-sizing: border-box;
      background: rgba(0,0,0,0.25);
      color: white;
      border: 1px solid rgba(255,255,255,0.20);
      border-radius: 10px;
      padding: 10px 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
    }
    .ga-ui-modal-help {
      margin-top: 8px;
      font-size: 12px;
      opacity: 0.90;
      white-space: pre-wrap;
    }
    .ga-ui-modal-actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-top: 12px;
    }
  `;
  (document.head ?? document.documentElement ?? document.body ?? document).appendChild(style as any);
}

export function createUIOverlay(): UIOverlay {
  const isDevBuild = (): boolean => {
    const info = (globalThis as any)?.GM_info;
    const ns = String(info?.script?.namespace || "");
    const name = String(info?.script?.name || "");
    return ns === "geoanalyzr-dev" || /\bdev\b/i.test(name);
  };

  const formatBytes = (n: number): string => {
    if (!Number.isFinite(n) || n <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let v = n;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  };

  const mount = () => {
    cssOnce();
    if (!document.documentElement.contains(iconBtn)) document.documentElement.appendChild(iconBtn);
    if (!document.documentElement.contains(panel)) document.documentElement.appendChild(panel);
  };

  const iconBtn = el("button");
  iconBtn.className = "ga-ui-icon";
  iconBtn.title = "GeoAnalyzr";
  iconBtn.type = "button";
  iconBtn.innerHTML = logoSvgMarkup({ size: 28, idPrefix: "ga-overlay-icon", variant: "light", decorative: true });

  const panel = el("div");
  panel.className = "ga-ui-panel";

  const header = el("div");
  header.className = "ga-ui-head";

  const title = el("div");
  title.className = "ga-ui-title";
  const titleLogo = el("span");
  titleLogo.innerHTML = logoSvgMarkup({ size: 16, idPrefix: "ga-overlay-title", variant: "light", decorative: true });
  const titleText = el("span");
  titleText.textContent = "GeoAnalyzr";
  title.appendChild(titleLogo);
  title.appendChild(titleText);

  const closeBtn = el("button");
  closeBtn.className = "ga-ui-close";
  closeBtn.type = "button";
  closeBtn.textContent = "x";

  header.appendChild(title);
  header.appendChild(closeBtn);

  const status = el("div");
  status.className = "ga-ui-status";
  status.textContent = "Ready.";

  const iconSvg = (name: string): string => {
    const common = `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
    if (name === "download") {
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path ${common} d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path ${common} d="M7 10l5 5 5-5"/><path ${common} d="M12 15V3"/></svg>`;
    }
    if (name === "upload") {
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path ${common} d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path ${common} d="M17 8l-5-5-5 5"/><path ${common} d="M12 3v12"/></svg>`;
    }
    if (name === "chart") {
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path ${common} d="M4 19V5"/><path ${common} d="M4 19h16"/><path ${common} d="M8 17v-6"/><path ${common} d="M12 17V7"/><path ${common} d="M16 17v-9"/></svg>`;
    }
    if (name === "chat") {
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path ${common} d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>`;
    }
    if (name === "file") {
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path ${common} d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path ${common} d="M14 2v6h6"/><path ${common} d="M8 13h8"/><path ${common} d="M8 17h6"/></svg>`;
    }
    if (name === "trash") {
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path ${common} d="M3 6h18"/><path ${common} d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path ${common} d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path ${common} d="M10 11v6"/><path ${common} d="M14 11v6"/></svg>`;
    }
    if (name === "refresh") {
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path ${common} d="M21 12a9 9 0 1 1-2.64-6.36"/><path ${common} d="M21 3v6h-6"/></svg>`;
    }
    return "";
  };

  const mkBtn = (opts: { label: string; bg: string; title?: string; icon?: string }): HTMLButtonElement => {
    const b = el("button");
    b.className = "ga-ui-btn";
    b.type = "button";
    b.style.background = opts.bg;
    if (opts.title) b.title = opts.title;

    if (opts.icon) {
      const ic = el("span");
      ic.className = "ga-ui-btn-icon";
      ic.innerHTML = opts.icon;
      b.appendChild(ic);
    }

    const t = el("span");
    t.textContent = opts.label;
    b.appendChild(t);
    return b;
  };

  const updateBtn = mkBtn({ label: "Fetch Data", bg: "rgba(255,255,255,0.10)", icon: iconSvg("download") });
  const syncBtn = mkBtn({
    label: "Sync",
    bg: "rgba(0,162,254,0.18)",
    icon: iconSvg("upload"),
    title: "Upload a compact delta to your server (Shift = full snapshot)"
  });
  const unsyncBtn = mkBtn({
    label: "Unsync",
    bg: "rgba(160,35,35,0.26)",
    icon: iconSvg("trash"),
    title: "Delete your data from the server and unlink this device"
  });
  const analysisBtn = mkBtn({ label: "Open Analysis Window", bg: "rgba(35,95,160,0.28)", icon: iconSvg("chart") });
  const discordBtn = mkBtn({ label: "Join Discord", bg: "rgba(121,80,229,0.30)", icon: iconSvg("chat") });
  const exportBtn = mkBtn({ label: "Export Excel", bg: "rgba(40,120,50,0.35)", icon: iconSvg("file") });
  const resetBtn = mkBtn({
    label: "Reset Database",
    bg: "rgba(160,35,35,0.35)",
    icon: iconSvg("refresh"),
    title: "Delete all local GeoAnalyzr data in this browser"
  });

  const counts = el("div");
  counts.className = "ga-ui-counts";
  counts.textContent = "Data: 0 games, 0 rounds.";

  const actions = el("div");
  actions.className = "ga-ui-actions";
  actions.appendChild(updateBtn);
  actions.appendChild(syncBtn);
  actions.appendChild(unsyncBtn);
  actions.appendChild(analysisBtn);
  actions.appendChild(discordBtn);
  actions.appendChild(exportBtn);
  actions.appendChild(resetBtn);

  panel.appendChild(header);
  panel.appendChild(status);
  panel.appendChild(actions);
  panel.appendChild(counts);

  let open = false;
  const setOpen = (next: boolean) => {
    open = next;
    panel.style.display = open ? "block" : "none";
  };
  iconBtn.addEventListener("click", () => setOpen(!open));
  closeBtn.addEventListener("click", () => setOpen(false));

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();

  let updateHandler: (() => void | Promise<void>) | null = null;
  let resetHandler: (() => void | Promise<void>) | null = null;
  let exportHandler: (() => void | Promise<void>) | null = null;
  let openAnalysisHandler: (() => void | Promise<void>) | null = null;
  let discordHandler: (() => void | Promise<void>) | null = null;

  updateBtn.addEventListener("click", () => void updateHandler?.());
  syncBtn.addEventListener("click", async (ev) => {
    syncBtn.disabled = true;
    unsyncBtn.disabled = true;
    const forceFull = !!(ev && (ev as any).shiftKey);
    status.textContent = forceFull ? "Syncing full snapshot..." : "Syncing...";
    try {
      let settings = loadServerSyncSettings();
      if (!settings.token) {
        const gm = getGmXmlhttpRequest();
        if (!gm) throw new Error("GM_xmlhttpRequest is not available.");

        status.textContent = "Linking device...";
        const linkOrigin = "https://geoanalyzr.lmbt.app";
        const pairStartUrl = `${linkOrigin}/pair/start`;

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

        const linkWin = window.open(pair.linkUrl, "geoanalyzr_link", "popup,width=520,height=700");
        if (!linkWin) {
          status.textContent = "Popup blocked. Allow popups for geoanalyzr.lmbt.app.";
          return;
        }

        const token = await new Promise<string>((resolve, reject) => {
          const timeout = window.setTimeout(() => {
            cleanup();
            reject(new Error("Link timeout"));
          }, 2 * 60 * 1000);

          const onMsg = (ev2: MessageEvent) => {
            if (ev2.origin !== linkOrigin) return;
            const d: any = ev2.data;
            if (!d || d.type !== "geoanalyzr_sync_token") return;
            const t = typeof d.token === "string" ? d.token.trim() : "";
            const endpointUrl = typeof d.endpointUrl === "string" ? d.endpointUrl.trim() : "";
            if (!t) return;
            cleanup();
            if (endpointUrl) saveServerSyncSettings({ endpointUrl });
            resolve(t);
          };

          const cleanup = () => {
            window.clearTimeout(timeout);
            window.removeEventListener("message", onMsg as any);
            try {
              linkWin.close();
            } catch {
              // ignore
            }
          };

          window.addEventListener("message", onMsg as any);
        });

        saveServerSyncSettings({ token });
        settings = loadServerSyncSettings();
      }
      const res = await runServerSyncOnceWithOptions(settings, { forceFull });
      const rowsTotal = res.counts.games + res.counts.rounds + res.counts.details + res.counts.gameAgg;
      const modeLabel = forceFull ? "Synced full" : "Synced";
      status.textContent = res.ok ? `${modeLabel} - rows ${rowsTotal} - ${formatBytes(res.bytesGzip)}` : `Sync failed (HTTP ${res.status})`;
    } catch (e: any) {
      status.textContent = e instanceof Error ? e.message : String(e || "Sync failed");
    } finally {
      syncBtn.disabled = false;
      unsyncBtn.disabled = false;
    }
  });
  unsyncBtn.addEventListener("click", async () => {
    const settings = loadServerSyncSettings();
    if (!settings.token) {
      status.textContent = "Not linked. Sync once to link the device first.";
      return;
    }

    const input = window.prompt(
      "This will permanently delete your data from the GeoAnalyzr server and unlink this device.\n\nType DELETE to confirm."
    );
    if (input !== "DELETE") {
      status.textContent = "Cancelled.";
      return;
    }

    unsyncBtn.disabled = true;
    syncBtn.disabled = true;
    status.textContent = "Deleting server data...";
    try {
      const res = await runServerUnsync(settings, { deleteUploads: true });
      if (!res.ok) {
        status.textContent = `Unsync failed (HTTP ${res.status})`;
        return;
      }
      saveServerSyncSettings({ token: "" });
      status.textContent = "Unsynced. Server data deleted and device unlinked.";
    } catch (e: any) {
      status.textContent = e instanceof Error ? e.message : String(e || "Unsync failed");
    } finally {
      unsyncBtn.disabled = false;
      syncBtn.disabled = false;
    }
  });
  exportBtn.addEventListener("click", () => void exportHandler?.());
  resetBtn.addEventListener("click", () => void resetHandler?.());
  analysisBtn.addEventListener("click", () => void openAnalysisHandler?.());
  discordBtn.addEventListener("click", () => void discordHandler?.());

  return {
    setVisible(visible) {
      iconBtn.style.display = visible ? "flex" : "none";
      if (!visible) panel.style.display = "none";
    },
    setStatus(msg) {
      status.textContent = msg;
    },
    setCounts(value) {
      counts.textContent = `Data: ${value.games} games, ${value.rounds} rounds.`;
    },
    onUpdateClick(fn) {
      updateHandler = fn;
    },
    onResetClick(fn) {
      resetHandler = fn;
    },
    onExportClick(fn) {
      exportHandler = fn;
    },
    onOpenAnalysisClick(fn) {
      openAnalysisHandler = fn;
    },
    onDiscordClick(fn) {
      discordHandler = fn;
    },
  };
}
