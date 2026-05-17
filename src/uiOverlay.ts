import { logoSvgMarkup } from "./ui/logo";
import { loadServerSyncSettings, runServerSyncOnceWithOptions, runServerUnsync, saveServerSyncSettings } from "./serverSync";
import { syncToServerV2 } from "./serverSync_v2";
import { fetchFeed } from "./feedFetcher_v2";
import { fetchDetails, DetailGameEvent } from "./detailFetcher_v2";
import { isMigrationNeeded, migrateV1ToV2 } from "./migration_v1_to_v2";
import { getGmXmlhttpRequest } from "./gm";
import { loadFetchGameFilter, saveFetchGameFilter } from "./fetchGameFilter";

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

  onUpdateClick: (handler: (ev: MouseEvent) => void | Promise<void>) => void;
  onResetClick: (handler: (opts?: { confirm?: boolean }) => void | Promise<void>) => void;
  onOpenAnalysisClick: (handler: () => void | Promise<void>) => void;

  // Convenience for programmatic auto-fetch on page reload (no user gesture).
  runFetch?: (opts?: { auto?: boolean }) => Promise<void>;

  // Sync-variant convenience: runs fetch + sync as a single action.
  runFetchAndSync?: (opts?: { auto?: boolean; forceFull?: boolean }) => Promise<void>;
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
    .ga-ui-row { display: grid; grid-template-columns: 1fr 36px 36px; gap: 8px; align-items: stretch; }
    .ga-ui-row3 { display: grid; grid-template-columns: 1fr 36px 36px; gap: 8px; align-items: stretch; }
    .ga-ui-iconbtn {
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.22);
      background: rgba(255,255,255,0.08);
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
    }
    .ga-ui-iconbtn:active { transform: translateY(1px); }
    .ga-ui-iconbtn:disabled { opacity: 0.65; cursor: not-allowed; }
    .ga-ui-iconbtn.danger { background: rgba(160,35,35,0.24); border-color: rgba(255,255,255,0.18); }
    .ga-ui-iconbtn svg { width: 16px; height: 16px; display: block; }
    .ga-ui-actions { display:flex; flex-direction: column; gap: 10px; }

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
    .ga-ui-modal-input:focus { outline: none; border-color: rgba(0,162,254,0.55); box-shadow: 0 0 0 3px rgba(0,162,254,0.18); }

    .ga-ui-modal-body { display:flex; flex-direction: column; gap: 12px; }
    .ga-ui-modal-summary {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 12px;
      padding: 10px 12px;
      font-size: 12px;
      opacity: 0.95;
      display:flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .ga-ui-modal-summary strong { font-weight: 700; }
    .ga-ui-modal-linkbtn {
      border: 1px solid rgba(255,255,255,0.18);
      background: rgba(255,255,255,0.08);
      color: white;
      cursor: pointer;
      border-radius: 10px;
      padding: 8px 10px;
      font-size: 12px;
      font-weight: 650;
    }
    .ga-ui-modal-linkbtn:active { transform: translateY(1px); }

    .ga-ui-modal-section {
      background: rgba(0,0,0,0.16);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 12px;
      padding: 10px 12px;
    }
    .ga-ui-modal-section-title { font-weight: 800; letter-spacing: 0.02em; margin-bottom: 8px; opacity: 0.98; }
    .ga-ui-modal-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .ga-ui-modal-span2 { grid-column: 1 / -1; }
    .ga-ui-modal-field { display:flex; flex-direction: column; gap: 6px; }
    .ga-ui-modal-label { font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; opacity: 0.85; }
    .ga-ui-modal-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .ga-ui-modal-presets { display:flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
    .ga-ui-modal-preset {
      border: 1px solid rgba(255,255,255,0.16);
      background: rgba(255,255,255,0.06);
      color: white;
      cursor: pointer;
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 12px;
      font-weight: 650;
    }
    .ga-ui-modal-preset:active { transform: translateY(1px); }
    .ga-ui-modal-box {
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
    .ga-ui-modal-box-title { font-weight: 700; opacity: 0.95; margin-bottom: 8px; }
    .ga-ui-modal-check { display:flex; align-items:center; gap: 8px; padding: 4px 0; cursor: pointer; user-select: none; }
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

    @media (max-width: 520px) {
      .ga-ui-modal-grid { grid-template-columns: 1fr; }
      .ga-ui-modal-row { grid-template-columns: 1fr; }
    }
  `;
  (document.head ?? document.documentElement ?? document.body ?? document).appendChild(style as any);
}

export function createUIOverlay(): UIOverlay {
  const variant = typeof __GA_VARIANT__ === "string" ? __GA_VARIANT__ : "local";
  const analysisEnabled = variant !== "sync";
  const isSyncVariant = variant === "sync";

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
    if (name === "gear") {
      // Sliders icon (reads better than a dense gear at 16px).
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path ${common} d="M4 21v-7"/><path ${common} d="M4 10V3"/><path ${common} d="M12 21v-9"/><path ${common} d="M12 8V3"/><path ${common} d="M20 21v-5"/><path ${common} d="M20 12V3"/><path ${common} d="M2 14h4"/><path ${common} d="M10 12h4"/><path ${common} d="M18 16h4"/></svg>`;
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

  const mkIconBtn = (opts: { icon: string; title: string; danger?: boolean }): HTMLButtonElement => {
    const b = el("button");
    b.type = "button";
    b.className = `ga-ui-iconbtn${opts.danger ? " danger" : ""}`;
    b.title = opts.title;
    b.innerHTML = opts.icon;
    return b;
  };

  const fetchBtn = mkBtn({
    label: "Fetch Data",
    bg: "rgba(255,255,255,0.10)",
    icon: iconSvg("download"),
    title: "Shift+Click: re-fetch all games from the last 365 days + download fetch log"
  });
  const fetchGearBtn = mkIconBtn({
    icon: iconSvg("gear"),
    title: isSyncVariant ? "Filters (applies to fetch + sync)" : "Fetch filters"
  });
  const fetchTrashBtn = mkIconBtn({ icon: iconSvg("trash"), title: "Reset local database", danger: true });

  const syncBtn = mkBtn({
    label: "Sync",
    bg: "rgba(0,162,254,0.18)",
    icon: iconSvg("upload"),
    title: "Upload a compact delta to your server (Shift = full snapshot)"
  });
  const syncGearBtn = mkIconBtn({ icon: iconSvg("gear"), title: "Sync filters" });
  const syncTrashBtn = mkIconBtn({ icon: iconSvg("trash"), title: "Unsync (delete server data)", danger: true });

  const fetchSyncBtn = isSyncVariant
    ? mkBtn({
        label: "Fetch + Sync",
        bg: "rgba(0,162,254,0.18)",
        icon: iconSvg("refresh"),
        title: "Fetch new data, then sync it (Shift = re-fetch last 365 days + full sync)"
      })
    : null;

  const deleteBtn = isSyncVariant ? mkIconBtn({ icon: iconSvg("trash"), title: "Delete data (local/server)", danger: true }) : null;

  const analysisBtn = mkBtn({ label: "Open Analysis Window", bg: "rgba(35,95,160,0.28)", icon: iconSvg("chart") });

  const counts = el("div");
  counts.className = "ga-ui-counts";
  counts.textContent = "Data: 0 games, 0 rounds.";

  const actions = el("div");
  actions.className = "ga-ui-actions";

  if (isSyncVariant) {
    const row = el("div");
    row.className = "ga-ui-row3";
    row.appendChild(fetchSyncBtn!);
    row.appendChild(fetchGearBtn);
    row.appendChild(deleteBtn!);
    actions.appendChild(row);
  } else {
    const fetchRow = el("div");
    fetchRow.className = "ga-ui-row";
    fetchRow.appendChild(fetchBtn);
    fetchRow.appendChild(fetchGearBtn);
    fetchRow.appendChild(fetchTrashBtn);
    actions.appendChild(fetchRow);

    const syncRow = el("div");
    syncRow.className = "ga-ui-row";
    syncRow.appendChild(syncBtn);
    syncRow.appendChild(syncGearBtn);
    syncRow.appendChild(syncTrashBtn);
    actions.appendChild(syncRow);
  }

  if (analysisEnabled) {
    const analysisRow = el("div");
    analysisRow.className = "ga-ui-row";
    analysisRow.style.gridTemplateColumns = "1fr";
    analysisRow.appendChild(analysisBtn);
    actions.appendChild(analysisRow);
  }

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

  let updateHandler: ((ev: MouseEvent) => void | Promise<void>) | null = null;
  let resetHandler: ((opts?: { confirm?: boolean }) => void | Promise<void>) | null = null;
  let openAnalysisHandler: (() => void | Promise<void>) | null = null;

  const openModal = (opts: {
    title: string;
    body: HTMLElement;
    onSave?: () => void;
    cancelLabel?: string;
    saveLabel?: string;
    saveKind?: "primary" | "danger";
  }) => {
    const modal = el("div");
    modal.className = "ga-ui-modal";
    const card = el("div");
    card.className = "ga-ui-modal-card";

    const head = el("div");
    head.className = "ga-ui-modal-head";
    const headTitle = el("div");
    headTitle.className = "ga-ui-modal-head-title";
    headTitle.textContent = opts.title;
    const headX = el("button");
    headX.className = "ga-ui-modal-x";
    headX.type = "button";
    headX.textContent = "x";
    head.appendChild(headTitle);
    head.appendChild(headX);

    const actions = el("div");
    actions.className = "ga-ui-modal-actions";
    const cancelBtn = el("button");
    cancelBtn.className = "ga-ui-btn";
    cancelBtn.type = "button";
    cancelBtn.style.background = "rgba(255,255,255,0.10)";
    cancelBtn.textContent = opts.cancelLabel || "Cancel";
    actions.appendChild(cancelBtn);

    const saveBtn = el("button");
    saveBtn.className = "ga-ui-btn";
    saveBtn.type = "button";
    saveBtn.style.background = opts.saveKind === "danger" ? "rgba(160,35,35,0.28)" : "rgba(0,162,254,0.18)";
    saveBtn.textContent = opts.saveLabel || "Save";
    actions.appendChild(saveBtn);

    const close = () => {
      try {
        modal.remove();
      } catch {
        // ignore
      }
    };

    headX.addEventListener("click", close);
    cancelBtn.addEventListener("click", close);
    modal.addEventListener("click", (ev) => {
      if (ev.target === modal) close();
    });
    saveBtn.addEventListener("click", () => {
      try {
        opts.onSave?.();
      } finally {
        close();
      }
    });

    card.appendChild(head);
    card.appendChild(opts.body);
    card.appendChild(actions);
    modal.appendChild(card);
    (document.body ?? document.documentElement).appendChild(modal);
  };

  async function runSyncOnce(opts: { forceFull: boolean; allowLinking: boolean; setMsg?: (msg: string) => void; gameIds?: string[] }): Promise<void> {
    const forceFull = !!opts.forceFull;
    const setMsg = opts.setMsg ?? ((msg: string) => { status.textContent = msg; });
    setMsg(forceFull ? "Syncing full snapshot..." : "Syncing...");
    try {
      let settings = loadServerSyncSettings();
      if (!settings.token) {
        if (!opts.allowLinking) {
          setMsg("Not linked. Click Fetch + Sync once to link your device.");
          return;
        }

        const gm = getGmXmlhttpRequest();
        if (!gm) throw new Error("GM_xmlhttpRequest is not available.");

        setMsg("Linking device...");
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
          setMsg("Popup blocked. Allow popups for geoanalyzr.lmbt.app.");
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
      if (isSyncVariant) {
        const modeLabel = forceFull ? "Synced full" : "Synced";
        const v2res = await syncToServerV2({
          full: forceFull,
          gameIds: opts.gameIds,
          onProgress: (p) => {
            if (p.phase === "reconcile" && p.serverCount !== undefined) {
              setMsg(`Server: ${p.serverCount} games — local: ${p.localCount} games`);
            } else if (p.phase === "reconcile") {
              setMsg("Checking server state...");
            } else if (p.phase === "upload") {
              setMsg(`Uploading batch ${p.batch}/${p.totalBatches} — ${p.gamesUploaded} games sent...`);
            } else if (p.phase === "verify") {
              setMsg("Verifying...");
            }
          },
        });
        if (v2res.ok) {
          if (v2res.gamesUploaded === 0) {
            setMsg(`Server already up to date — ${v2res.gamesSkipped} games skipped`);
          } else {
            setMsg(`${modeLabel} — ${v2res.gamesNew} new games, ${v2res.roundsNew} new rounds (${v2res.batches} batch${v2res.batches !== 1 ? "es" : ""})`);
          }
        } else {
          const errMap: Record<string, string> = {
            no_token: "Not linked. Click Fetch + Sync to link your device.",
            no_player_id: "Could not determine player ID. Ensure you are logged in to GeoGuessr.",
          };
          setMsg(errMap[v2res.error ?? ""] ?? `Sync failed: ${v2res.error ?? "unknown"}`);
        }
      } else {
        const res = await runServerSyncOnceWithOptions(settings, { forceFull });
        const rowsTotal = res.counts.games + res.counts.rounds + res.counts.details + res.counts.gameAgg;
        const modeLabel = forceFull ? "Synced full" : "Synced";
        const chunkText = typeof res.chunks === "number" && res.chunks > 1 ? ` - ${res.chunks} chunks` : "";
        if (res.ok) {
          setMsg(`${modeLabel} - rows ${rowsTotal} - ${formatBytes(res.bytesGzip)}${chunkText}`);
        } else {
          const size = formatBytes(res.bytesGzip);
          if (res.status === 413) {
            setMsg(`Sync failed (HTTP 413) - payload ${size}. Try Compact mode or narrow Sync filters.`);
          } else if (res.status === 401 || res.status === 403) {
            setMsg(`Sync failed (HTTP ${res.status}) - token invalid/expired. Re-link your device and try again.`);
          } else {
            setMsg(`Sync failed (HTTP ${res.status})`);
          }
        }
      }
    } catch (e: any) {
      setMsg(e instanceof Error ? e.message : String(e || "Sync failed"));
    }
  }

  const openSyncLogModal = (forceFull: boolean): { log: (msg: string) => void; finish: (ok: boolean) => void } => {
    const logLines: string[] = [];

    const card = el("div");
    card.className = "ga-ui-modal-card";
    card.style.width = "520px";
    card.style.maxWidth = "90vw";

    const head = el("div");
    head.className = "ga-ui-modal-head";
    const headTitle = el("div");
    headTitle.className = "ga-ui-modal-head-title";
    headTitle.textContent = forceFull ? "Sync Log (Full)" : "Sync Log";
    const headX = el("button");
    headX.className = "ga-ui-modal-x";
    headX.type = "button";
    headX.textContent = "x";
    head.appendChild(headTitle);
    head.appendChild(headX);

    const logArea = el("div");
    logArea.style.cssText = "font-family:monospace;font-size:11px;line-height:1.5;padding:10px 12px;max-height:320px;overflow-y:auto;background:rgba(0,0,0,0.35);border-radius:4px;margin:10px 14px;white-space:pre-wrap;word-break:break-all;";

    const actions = el("div");
    actions.className = "ga-ui-modal-actions";
    const closeBtn = el("button");
    closeBtn.className = "ga-ui-btn";
    closeBtn.type = "button";
    closeBtn.style.background = "rgba(255,255,255,0.10)";
    closeBtn.textContent = "Close";

    const dlBtn = el("button");
    dlBtn.className = "ga-ui-btn";
    dlBtn.type = "button";
    dlBtn.style.background = "rgba(0,162,254,0.18)";
    dlBtn.style.display = "none";
    dlBtn.textContent = "Download";

    actions.appendChild(closeBtn);
    actions.appendChild(dlBtn);

    card.appendChild(head);
    card.appendChild(logArea);
    card.appendChild(actions);

    const modal = el("div");
    modal.className = "ga-ui-modal";
    modal.appendChild(card);

    const close = () => { try { modal.remove(); } catch { /* ignore */ } };
    headX.addEventListener("click", close);
    closeBtn.addEventListener("click", close);
    modal.addEventListener("click", (ev) => { if (ev.target === modal) close(); });

    (document.body ?? document.documentElement).appendChild(modal);

    const appendLine = (msg: string) => {
      const ts = new Date().toISOString().slice(11, 19);
      const line = `[${ts}] ${msg}`;
      logLines.push(line);
      const span = el("span");
      span.textContent = line + "\n";
      logArea.appendChild(span);
      logArea.scrollTop = logArea.scrollHeight;
    };

    const finish = (ok: boolean) => {
      const marker = ok ? "✓ Done" : "✗ Failed";
      appendLine(marker);
      dlBtn.style.display = "";
      dlBtn.addEventListener("click", () => {
        const blob = new Blob([logLines.join("\n")], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `geoanalyzr-sync-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;
        a.click();
        URL.revokeObjectURL(url);
      }, { once: true });
    };

    return { log: appendLine, finish };
  };

  const runFetchAndSyncImpl = async (opts: { forceFull: boolean; auto: boolean; showLog?: boolean; ev?: MouseEvent }): Promise<void> => {
    if (!isSyncVariant) return;

    const btns = [fetchSyncBtn, fetchGearBtn, deleteBtn].filter((b): b is HTMLButtonElement => !!b);
    if (btns.some((b) => b.disabled)) return;

    btns.forEach((b) => (b.disabled = true));

    const logModal = opts.showLog ? openSyncLogModal(opts.forceFull) : null;
    const setMsg = (msg: string) => {
      if (logModal) logModal.log(msg);
      else status.textContent = msg;
    };

    try {
      const ev = opts.ev ?? new MouseEvent("click");
      try {
        (ev as any).__gaAuto = !!opts.auto;
      } catch {
        // ignore
      }
      if (!updateHandler) {
        setMsg("Fetch handler not ready yet. Try again in a moment.");
        logModal?.finish(false);
        return;
      }
      // v2 pipeline: feed → details → server sync
      try {
        if (await isMigrationNeeded()) {
          setMsg("Migrating local data to v2 format...");
          await migrateV1ToV2();
        }
      } catch { /* non-fatal */ }

      setMsg(opts.forceFull ? "Fetching full history..." : "Fetching feed...");
      let feedNewGameIds: string[] = [];
      try {
        let prevNewGames = 0;
        const feedResult = await fetchFeed({
          full: opts.forceFull,
          maxPages: 5000,
          delayMs: 150,
          overlapThreshold: 5,
          onProgress: (p) => {
            if (logModal) {
              const pageNew = p.newGames - prevNewGames;
              prevNewGames = p.newGames;
              setMsg(`Page ${p.page}: ${pageNew > 0 ? `+${pageNew} new` : "0 new"} (total: ${p.newGames})`);
            } else {
              setMsg(`Feed page ${p.page} — ${p.newGames} new games...`);
            }
          },
        });
        feedNewGameIds = feedResult.newGameIds;
        if (logModal) setMsg(`Feed done — ${feedResult.newGames} new games, stopped: ${feedResult.stopped}`);
      } catch (e: any) {
        setMsg(`Feed error: ${e instanceof Error ? e.message : String(e)}`);
        logModal?.finish(false);
        return;
      }

      setMsg("Fetching game details...");
      let detailUpdatedGameIds: string[] = [];
      try {
        const fmtDate = (ts?: number) => ts ? new Date(ts).toISOString().slice(0, 10) : "?";
        const fmtId = (id: string) => id.length > 8 ? id.slice(0, 6) + ".." : id;
        const onGameEvent = logModal ? (e: DetailGameEvent) => {
          if (e.status === "checking") {
            setMsg(`${fmtId(e.gameId)} (${e.mode}, ${fmtDate(e.playedAt)}): missing ${e.missing.join(", ")}`);
          } else if (e.status === "ok") {
            setMsg(`  → ok${e.source === "cache" ? " (from cache)" : ""}`);
          } else {
            setMsg(`  → failed: ${e.error ?? "unknown"}`);
          }
        } : undefined;
        const detailResult = await fetchDetails({
          concurrency: logModal ? 1 : 3,
          delayMs: 400,
          force: opts.forceFull,
          onProgress: logModal ? undefined : (p) => { setMsg(`Details ${p.processed}/${p.total} — ok: ${p.succeeded}...`); },
          onGameEvent,
        });
        detailUpdatedGameIds = detailResult.updatedGameIds;
        if (logModal) setMsg(`Details done — ${detailResult.succeeded} ok, ${detailResult.failed} failed, ${detailResult.permanentlySkipped} skipped`);
      } catch { /* non-fatal */ }

      // Collect all game IDs touched this cycle; pass to sync so only those are uploaded
      const touchedIds = opts.forceFull ? undefined : [...new Set([...feedNewGameIds, ...detailUpdatedGameIds])];
      if (!opts.forceFull && touchedIds!.length === 0) {
        setMsg("Nothing to sync — no new or updated games");
        logModal?.finish(true);
        return;
      }
      if (logModal && touchedIds) setMsg(`Syncing ${touchedIds.length} touched game${touchedIds.length !== 1 ? "s" : ""}...`);

      await runSyncOnce({ forceFull: opts.forceFull, allowLinking: !opts.auto, setMsg, gameIds: touchedIds });
      logModal?.finish(true);
    } catch (e: any) {
      setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
      logModal?.finish(false);
    } finally {
      btns.forEach((b) => (b.disabled = false));
    }
  };

  fetchBtn.addEventListener("click", (ev) => void updateHandler?.(ev));
  if (fetchSyncBtn) {
    fetchSyncBtn.addEventListener("click", (ev) =>
      void runFetchAndSyncImpl({
        forceFull: !!(ev && (ev as any).shiftKey),
        auto: false,
        showLog: !!(ev && (ev as any).ctrlKey),
        ev,
      })
    );
  }
  fetchTrashBtn.addEventListener("click", () => void resetHandler?.({ confirm: true }));

  const mkHelp = (t: string) => {
    const d = el("div");
    d.className = "ga-ui-modal-help";
    d.textContent = t;
    return d;
  };

  const mkSelect = (html: string, value: string) => {
    const s = el("select");
    s.className = "ga-ui-modal-input";
    s.innerHTML = html;
    (s as any).value = value;
    return s;
  };

  const mkInput = (value: string, placeholder: string) => {
    const i = el("input");
    i.className = "ga-ui-modal-input";
    i.type = "text";
    i.placeholder = placeholder;
    i.value = value;
    return i;
  };

  const mkDateInput = (value: string, placeholder: string) => {
    const i = mkInput(value, placeholder);
    i.type = "date";
    return i;
  };

  const mkField = (labelText: string, control: HTMLElement) => {
    const field = el("div");
    field.className = "ga-ui-modal-field";
    const label = el("div");
    label.className = "ga-ui-modal-label";
    label.textContent = labelText;
    field.appendChild(label);
    field.appendChild(control);
    return field;
  };

  const mkSection = (title: string) => {
    const sec = el("div");
    sec.className = "ga-ui-modal-section";
    const t = el("div");
    t.className = "ga-ui-modal-section-title";
    t.textContent = title;
    sec.appendChild(t);
    return sec;
  };

  const mkMovementMulti = (selectedAnyOf: unknown) => {
    const box = el("div");
    box.className = "ga-ui-modal-box";

    const title = el("div");
    title.className = "ga-ui-modal-box-title";
    title.textContent = "Movement";
    box.appendChild(title);

    const allWrap = el("label");
    allWrap.className = "ga-ui-modal-check";
    const all = el("input") as HTMLInputElement;
    all.type = "checkbox";
    const selectedList = Array.isArray(selectedAnyOf) ? selectedAnyOf : [];
    all.checked = selectedList.length === 0;
    const allText = el("span");
    allText.textContent = "All";
    allWrap.appendChild(all);
    allWrap.appendChild(allText);
    box.appendChild(allWrap);

    const opts: Array<{ value: "moving" | "no_move" | "nmpz" | "unknown"; label: string }> = [
      { value: "moving", label: "Moving" },
      { value: "no_move", label: "No move" },
      { value: "nmpz", label: "NMPZ" },
      { value: "unknown", label: "Unknown" }
    ];

    const normalize = (value: unknown) => {
      const s = String(value || "").trim().toLowerCase();
      if (s === "moving" || s === "no_move" || s === "nmpz" || s === "unknown") return s as any;
      return "";
    };

    const curSet = new Set(selectedList.map(normalize).filter(Boolean));

    const optionInputs: Array<{ input: HTMLInputElement; value: "moving" | "no_move" | "nmpz" | "unknown" }> = [];
    for (const o of opts) {
      const wrap = el("label");
      wrap.className = "ga-ui-modal-check";
      const input = el("input") as HTMLInputElement;
      input.type = "checkbox";
      input.checked = curSet.has(o.value) && !all.checked;
      const text = el("span");
      text.textContent = o.label;
      wrap.appendChild(input);
      wrap.appendChild(text);
      box.appendChild(wrap);
      optionInputs.push({ input, value: o.value });
    }

    const syncAll = () => {
      const anyChecked = optionInputs.some((x) => x.input.checked);
      all.checked = !anyChecked;
    };

    const setSelectedAnyOf = (values: unknown) => {
      const next = Array.isArray(values) ? values.map(normalize).filter(Boolean) : [];
      const nextSet = new Set(next);
      const wantAll = nextSet.size === 0;
      all.checked = wantAll;
      for (const x of optionInputs) x.input.checked = wantAll ? false : nextSet.has(x.value);
      syncAll();
    };

    all.addEventListener("change", () => {
      if (all.checked) for (const x of optionInputs) x.input.checked = false;
    });
    for (const x of optionInputs) x.input.addEventListener("change", () => syncAll());

    const getSelectedAnyOf = () => optionInputs.filter((x) => x.input.checked).map((x) => x.value);

    return { box, getSelectedAnyOf, setSelectedAnyOf };
  };

  const fmtDate = (ms: number) => {
      if (!ms || !Number.isFinite(ms)) return "";
      try {
        return new Date(ms).toISOString().slice(0, 10);
      } catch {
        return "";
      }
    };

  const parseDateStartMs = (s: string): number => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
    if (!m) return 0;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return 0;
    return new Date(y, mo - 1, d, 0, 0, 0, 0).getTime();
  };

  const parseDateEndMs = (s: string): number => {
    const start = parseDateStartMs(s);
    if (!start) return 0;
    return start + 24 * 60 * 60 * 1000 - 1;
  };

  const openGameFiltersModal = (opts: {
    title: string;
    intro: string;
    note?: string;
    cur: {
      modeFamily: "all" | "duels" | "teamduels";
      movementAnyOf: Array<"moving" | "no_move" | "nmpz" | "unknown">;
      rated: "all" | "rated" | "unrated" | "unknown";
      fromMs: number;
      toMs: number;
    };
    onSave: (next: {
      modeFamily: "all" | "duels" | "teamduels";
      movementAnyOf: Array<"moving" | "no_move" | "nmpz" | "unknown">;
      rated: "all" | "rated" | "unrated" | "unknown";
      fromMs: number;
      toMs: number;
    }) => void;
    savedMessage: string;
  }) => {
    const wrap = el("div");
    wrap.className = "ga-ui-modal-body";

    wrap.appendChild(mkHelp(opts.intro));

    const summary = el("div");
    summary.className = "ga-ui-modal-summary";
    const summaryText = el("div");
    const summaryBtn = el("button");
    summaryBtn.className = "ga-ui-modal-linkbtn";
    summaryBtn.type = "button";
    summaryBtn.textContent = "Reset";
    summary.appendChild(summaryText);
    summary.appendChild(summaryBtn);
    wrap.appendChild(summary);

    const selFamily = mkSelect(
      `<option value="all">All</option>` +
        `<option value="duels">Duels only</option>` +
        `<option value="teamduels">Team Duels only</option>`,
      opts.cur.modeFamily
    );
    const selRated = mkSelect(
      `<option value="all">All</option>` +
        `<option value="rated">Rated only</option>` +
        `<option value="unrated">Unrated only</option>` +
        `<option value="unknown">Unknown only</option>`,
      opts.cur.rated
    );
    const movementMulti = mkMovementMulti(opts.cur.movementAnyOf);
    const fromInput = mkDateInput(fmtDate(opts.cur.fromMs), "YYYY-MM-DD");
    const toInput = mkDateInput(fmtDate(opts.cur.toMs), "YYYY-MM-DD");

    const applySummary = () => {
      const parts: string[] = [];
      const fam = String((selFamily as any).value || "all");
      const rated = String((selRated as any).value || "all");
      const mv = movementMulti.getSelectedAnyOf();
      const from = String(fromInput.value || "");
      const to = String(toInput.value || "");
      if (fam !== "all") parts.push(`Mode family: ${fam}`);
      if (rated !== "all") parts.push(`Rated: ${rated}`);
      if (mv.length) parts.push(`Movement: ${mv.join(", ")}`);
      if (from || to) parts.push(`Date: ${from || "…"} → ${to || "…"}`);
      summaryText.innerHTML = parts.length ? `<strong>Active:</strong> ${parts.join(" • ")}` : "<strong>Active:</strong> All games";
    };

    selFamily.addEventListener("change", applySummary);
    selRated.addEventListener("change", applySummary);
    fromInput.addEventListener("change", applySummary);
    toInput.addEventListener("change", applySummary);
    movementMulti.box.addEventListener("change", applySummary);

    const secBasics = mkSection("Scope");
    const basicsGrid = el("div");
    basicsGrid.className = "ga-ui-modal-grid";
    basicsGrid.appendChild(mkField("Mode family", selFamily));
    basicsGrid.appendChild(mkField("Rated", selRated));
    secBasics.appendChild(basicsGrid);
    wrap.appendChild(secBasics);

    const secMovement = mkSection("Movement");
    secMovement.appendChild(movementMulti.box);
    wrap.appendChild(secMovement);

    const secDate = mkSection("Date range");
    const row = el("div");
    row.className = "ga-ui-modal-row";
    row.appendChild(mkField("From", fromInput));
    row.appendChild(mkField("To", toInput));
    secDate.appendChild(row);

    const presets = el("div");
    presets.className = "ga-ui-modal-presets";
    const mkPreset = (label: string, onClick: () => void) => {
      const b = el("button");
      b.className = "ga-ui-modal-preset";
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", () => {
        onClick();
        applySummary();
      });
      return b;
    };
    const setLastDays = (days: number) => {
      const end = new Date();
      const start = new Date(end.getTime());
      start.setDate(start.getDate() - Math.max(0, days - 1));
      fromInput.value = start.toISOString().slice(0, 10);
      toInput.value = end.toISOString().slice(0, 10);
    };
    presets.appendChild(mkPreset("7d", () => setLastDays(7)));
    presets.appendChild(mkPreset("30d", () => setLastDays(30)));
    presets.appendChild(mkPreset("90d", () => setLastDays(90)));
    presets.appendChild(
      mkPreset("All time", () => {
        fromInput.value = "";
        toInput.value = "";
      })
    );
    secDate.appendChild(presets);
    wrap.appendChild(secDate);

    if (opts.note) wrap.appendChild(mkHelp(opts.note));

    const resetAll = () => {
      (selFamily as any).value = "all";
      (selRated as any).value = "all";
      fromInput.value = "";
      toInput.value = "";
      movementMulti.setSelectedAnyOf([]);
      applySummary();
    };
    summaryBtn.addEventListener("click", resetAll);

    applySummary();

    openModal({
      title: opts.title,
      body: wrap,
      onSave: () => {
        const familyRaw = String((selFamily as any).value || "");
        const ratedRaw = String((selRated as any).value || "");
        const modeFamily = familyRaw === "duels" || familyRaw === "teamduels" ? (familyRaw as any) : "all";
        const movementAnyOf = movementMulti.getSelectedAnyOf();
        const rated = ratedRaw === "rated" || ratedRaw === "unrated" || ratedRaw === "unknown" ? (ratedRaw as any) : "all";
        const fromMs = parseDateStartMs(fromInput.value);
        const toMs = parseDateEndMs(toInput.value);
        opts.onSave({ modeFamily, movementAnyOf, rated, fromMs, toMs });
        status.textContent = opts.savedMessage;
      }
    });
  };

  fetchGearBtn.addEventListener("click", () => {
    const cur = loadFetchGameFilter();
    openGameFiltersModal({
      title: isSyncVariant ? "Filters" : "Fetch filters",
      intro: isSyncVariant
        ? "Filters applied to both fetch and sync (always game-level; never partial rounds):"
        : "Fetch filters (always game-level; never partial rounds):",
      note: isSyncVariant
        ? "Tip: This minimal build syncs only the data you fetch. Adjust these filters to control what is stored and uploaded."
        : "Note: some fields (movement/rated) may only be known after details are fetched. Filters are applied consistently for storage + future fetch/sync steps.",
      cur,
      onSave: (next) => saveFetchGameFilter(next),
      savedMessage: isSyncVariant ? "Filters saved." : "Fetch filters saved."
    });
  });

  async function deleteServerDataNoPrompt(): Promise<void> {
    const settings = loadServerSyncSettings();
    if (!settings.token) {
      status.textContent = "Not linked. No server data to delete.";
      return;
    }

    status.textContent = "Deleting server data...";
    const res = await runServerUnsync(settings, { deleteUploads: true });
    if (!res.ok) {
      status.textContent = `Delete failed (HTTP ${res.status})`;
      return;
    }
    saveServerSyncSettings({ token: "" });
    status.textContent = "Server data deleted. Device unlinked.";
  }

  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      const wrap = el("div");
      wrap.style.padding = "0 6px";

      wrap.appendChild(
        mkHelp(
          "This will permanently delete your data.\n\n" +
            "Important: some games older than ~1 year may no longer be retrievable from GeoGuessr, so you might not be able to fetch them again later."
        )
      );

      const box = el("div");
      box.className = "ga-ui-modal-section";
      const title = el("div");
      title.className = "ga-ui-modal-section-title";
      title.textContent = "What do you want to delete?";
      box.appendChild(title);

      const mkChoice = (id: string, head: string, sub: string) => {
        const row = el("label");
        row.style.display = "grid";
        row.style.gridTemplateColumns = "18px 1fr";
        row.style.gap = "10px";
        row.style.alignItems = "start";
        row.style.padding = "10px 10px";
        row.style.borderRadius = "12px";
        row.style.border = "1px solid rgba(255,255,255,0.16)";
        row.style.background = "rgba(255,255,255,0.06)";
        row.style.cursor = "pointer";

        const radio = el("input");
        radio.type = "radio";
        radio.name = "ga_delete_choice_v1";
        radio.value = id;
        radio.style.marginTop = "3px";

        const text = el("div");
        const h = el("div");
        h.textContent = head;
        h.style.fontWeight = "700";
        const s = el("div");
        s.textContent = sub;
        s.style.opacity = "0.9";
        s.style.fontSize = "12px";
        s.style.marginTop = "4px";
        text.appendChild(h);
        text.appendChild(s);

        row.appendChild(radio);
        row.appendChild(text);
        return { row, radio };
      };

      const cLocal = mkChoice("local", "Local data only", "Deletes the data stored in this browser.");
      const cServer = mkChoice("server", "Server data only", "Deletes your uploaded server data and unlinks this device.");
      const cBoth = mkChoice("both", "Both local + server", "Deletes browser data and server data (and unlinks this device).");
      cLocal.radio.checked = true;

      const choices = el("div");
      choices.style.display = "grid";
      choices.style.gap = "10px";
      choices.style.marginTop = "10px";
      choices.appendChild(cLocal.row);
      choices.appendChild(cServer.row);
      choices.appendChild(cBoth.row);
      box.appendChild(choices);
      wrap.appendChild(box);

      openModal({
        title: "Delete data",
        body: wrap,
        saveLabel: "Delete",
        saveKind: "danger",
        onSave: () => {
          const selected =
            (wrap.querySelector('input[name="ga_delete_choice_v1"]:checked') as HTMLInputElement | null)?.value || "local";
          void (async () => {
            const btns = [fetchSyncBtn, fetchGearBtn, deleteBtn].filter((b): b is HTMLButtonElement => !!b);
            if (btns.some((b) => b.disabled)) return;
            btns.forEach((b) => (b.disabled = true));
            try {
              if (selected === "local" || selected === "both") {
                status.textContent = "Deleting local data...";
                await resetHandler?.({ confirm: false });
              }
              if (selected === "server" || selected === "both") {
                await deleteServerDataNoPrompt();
              }
              status.textContent = "Delete complete.";
            } catch (e: any) {
              status.textContent = e instanceof Error ? e.message : String(e || "Delete failed");
            } finally {
              btns.forEach((b) => (b.disabled = false));
            }
          })();
        }
      });
    });
  }

  syncBtn.addEventListener("click", async (ev) => {
    const btns = [syncBtn, syncGearBtn, syncTrashBtn];
    btns.forEach((b) => (b.disabled = true));
    try {
      const forceFull = !!(ev && (ev as any).shiftKey);
      await runSyncOnce({ forceFull, allowLinking: true });
    } finally {
      btns.forEach((b) => (b.disabled = false));
    }
  });

  syncTrashBtn.addEventListener("click", async () => {
    const settings = loadServerSyncSettings();
    if (!settings.token) {
      status.textContent = "Not linked. Sync once to link the device first.";
      return;
    }

    const input = window.prompt(
      "WARNING:\n" +
        "- This permanently deletes ALL your data from the GeoAnalyzr server.\n" +
        "- Your local data in this browser will NOT be deleted.\n" +
        "- Access via the website and the Discord bot will no longer be possible after this.\n\n" +
        "Type DELETE to confirm."
    );
    if (input !== "DELETE") {
      status.textContent = "Cancelled.";
      return;
    }

    syncTrashBtn.disabled = true;
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
      syncTrashBtn.disabled = false;
      syncBtn.disabled = false;
    }
  });

  syncGearBtn.addEventListener("click", () => {
    const cur = loadServerSyncSettings();
    openGameFiltersModal({
      title: "Sync filters",
      intro: "Sync filters (always game-level; never partial rounds):",
      note: "Changing filters later may require a full sync (Shift+Sync) to backfill older excluded games. Cursor still advances even for excluded games.",
      cur: {
        modeFamily: cur.filterModeFamily,
        movementAnyOf: cur.filterMovementAnyOf,
        rated: cur.filterRated,
        fromMs: cur.filterFromMs,
        toMs: cur.filterToMs
      },
      onSave: (next) =>
        saveServerSyncSettings({
          filterModeFamily: next.modeFamily,
          filterMovementAnyOf: next.movementAnyOf,
          filterRated: next.rated,
          filterFromMs: next.fromMs,
          filterToMs: next.toMs
        }),
      savedMessage: "Sync filters saved."
    });
  });

  if (analysisEnabled) analysisBtn.addEventListener("click", () => void openAnalysisHandler?.());

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
    onOpenAnalysisClick(fn) {
      openAnalysisHandler = fn;
    },
    async runFetch(opts) {
      if (!updateHandler) {
        status.textContent = "Fetch handler not ready yet. Try again in a moment.";
        return;
      }
      const ev = new MouseEvent("click");
      try {
        (ev as any).__gaAuto = Boolean(opts?.auto);
      } catch {
        // ignore
      }
      await updateHandler(ev);
    },
    async runFetchAndSync(opts) {
      await runFetchAndSyncImpl({ forceFull: Boolean(opts?.forceFull), auto: Boolean(opts?.auto) });
    }
  };
}
