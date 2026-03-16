import { logoSvgMarkup } from "./ui/logo";
import { loadServerSyncSettings, runServerSyncOnceWithOptions, runServerUnsync, saveServerSyncSettings } from "./serverSync";
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

  onUpdateClick: (handler: () => void | Promise<void>) => void;
  onResetClick: (handler: () => void | Promise<void>) => void;
  onOpenAnalysisClick: (handler: () => void | Promise<void>) => void;
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
    if (name === "gear") {
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path ${common} d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/><path ${common} d="M19.4 15a7.9 7.9 0 0 0 .1-1l2-1.6-2-3.4-2.4.5a7.2 7.2 0 0 0-1.7-1l-.4-2.5H9l-.4 2.5a7.2 7.2 0 0 0-1.7 1L4.5 9l-2 3.4 2 1.6a7.9 7.9 0 0 0 .1 1l-2 1.6 2 3.4 2.4-.5a7.2 7.2 0 0 0 1.7 1l.4 2.5h6l.4-2.5a7.2 7.2 0 0 0 1.7-1l2.4.5 2-3.4-2-1.6z"/></svg>`;
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

  const fetchBtn = mkBtn({ label: "Fetch Data", bg: "rgba(255,255,255,0.10)", icon: iconSvg("download") });
  const fetchGearBtn = mkIconBtn({ icon: iconSvg("gear"), title: "Fetch filters" });
  const fetchTrashBtn = mkIconBtn({ icon: iconSvg("trash"), title: "Reset local database", danger: true });

  const syncBtn = mkBtn({
    label: "Sync",
    bg: "rgba(0,162,254,0.18)",
    icon: iconSvg("upload"),
    title: "Upload a compact delta to your server (Shift = full snapshot)"
  });
  const syncGearBtn = mkIconBtn({ icon: iconSvg("gear"), title: "Sync filters" });
  const syncTrashBtn = mkIconBtn({ icon: iconSvg("trash"), title: "Unsync (delete server data)", danger: true });

  const analysisBtn = mkBtn({ label: "Open Analysis Window", bg: "rgba(35,95,160,0.28)", icon: iconSvg("chart") });

  const counts = el("div");
  counts.className = "ga-ui-counts";
  counts.textContent = "Data: 0 games, 0 rounds.";

  const actions = el("div");
  actions.className = "ga-ui-actions";
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

  const analysisRow = el("div");
  analysisRow.className = "ga-ui-row";
  analysisRow.style.gridTemplateColumns = "1fr";
  analysisRow.appendChild(analysisBtn);
  actions.appendChild(analysisRow);

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
  let openAnalysisHandler: (() => void | Promise<void>) | null = null;

  const openModal = (opts: { title: string; body: HTMLElement; onSave?: () => void }) => {
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
    cancelBtn.textContent = "Cancel";
    actions.appendChild(cancelBtn);

    const saveBtn = el("button");
    saveBtn.className = "ga-ui-btn";
    saveBtn.type = "button";
    saveBtn.style.background = "rgba(0,162,254,0.18)";
    saveBtn.textContent = "Save";
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

  fetchBtn.addEventListener("click", () => void updateHandler?.());
  fetchTrashBtn.addEventListener("click", () => void resetHandler?.());
  fetchGearBtn.addEventListener("click", () => {
    const cur = loadFetchGameFilter();
    const wrap = el("div");
    const label = el("div");
    label.className = "ga-ui-modal-help";
    label.textContent = "Game filter (applies on game level only; never partial rounds):";
    const sel = el("select");
    sel.className = "ga-ui-modal-input" as any;
    sel.innerHTML =
      `<option value="all">All games</option>` +
      `<option value="duels">Duels only</option>` +
      `<option value="teamduels">Team Duels only</option>`;
    sel.value = cur.modeFamily;
    const help = el("div");
    help.className = "ga-ui-modal-help";
    help.textContent =
      "Fetch Data will only store/fetch games that match this filter. Games outside the filter are skipped (cursor still advances).";
    wrap.appendChild(label);
    wrap.appendChild(sel);
    wrap.appendChild(help);
    openModal({
      title: "Fetch filters",
      body: wrap,
      onSave: () => {
        const v = String((sel as any).value || "");
        const modeFamily = v === "duels" || v === "teamduels" ? (v as any) : "all";
        saveFetchGameFilter({ modeFamily });
        status.textContent = `Fetch filter saved: ${modeFamily}.`;
      }
    });
  });

  syncBtn.addEventListener("click", async (ev) => {
    syncBtn.disabled = true;
    syncTrashBtn.disabled = true;
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
      syncTrashBtn.disabled = false;
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
    const wrap = el("div");

    const label1 = el("div");
    label1.className = "ga-ui-modal-help";
    label1.textContent = "Mode filter (game level only):";
    const selMode = el("select");
    selMode.className = "ga-ui-modal-input" as any;
    selMode.innerHTML =
      `<option value="all">All games</option>` +
      `<option value="duels">Duels only</option>` +
      `<option value="teamduels">Team Duels only</option>`;
    selMode.value = cur.filterModeFamily;

    const label2 = el("div");
    label2.className = "ga-ui-modal-help";
    label2.textContent = "Movement filter (game level only):";
    const selMove = el("select");
    selMove.className = "ga-ui-modal-input" as any;
    selMove.innerHTML =
      `<option value="all">All</option>` +
      `<option value="moving">Moving</option>` +
      `<option value="no_move">No move</option>` +
      `<option value="nmpz">NMPZ</option>` +
      `<option value="unknown">Unknown</option>`;
    selMove.value = cur.filterMovement;

    const help = el("div");
    help.className = "ga-ui-modal-help";
    help.textContent =
      "Sync only sends games that match these filters (no partial rounds). Changing filters later may require a full sync (Shift+Sync) to backfill older excluded games.";

    wrap.appendChild(label1);
    wrap.appendChild(selMode);
    wrap.appendChild(label2);
    wrap.appendChild(selMove);
    wrap.appendChild(help);

    openModal({
      title: "Sync filters",
      body: wrap,
      onSave: () => {
        const modeRaw = String((selMode as any).value || "");
        const movRaw = String((selMove as any).value || "");
        const filterModeFamily = modeRaw === "duels" || modeRaw === "teamduels" ? (modeRaw as any) : "all";
        const filterMovement =
          movRaw === "moving" || movRaw === "no_move" || movRaw === "nmpz" || movRaw === "unknown" ? (movRaw as any) : "all";
        saveServerSyncSettings({ filterModeFamily, filterMovement });
        status.textContent = `Sync filter saved: ${filterModeFamily}, ${filterMovement}.`;
      }
    });
  });

  analysisBtn.addEventListener("click", () => void openAnalysisHandler?.());

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
  };
}
