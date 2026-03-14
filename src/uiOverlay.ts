import { logoSvgMarkup } from "./ui/logo";
import { loadServerSyncSettings, runServerSyncOnce, saveServerSyncSettings } from "./serverSync";

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
      margin-top: 8px;
    }
    .ga-ui-btn:active { transform: translateY(1px); }
    .ga-ui-btn:disabled { opacity: 0.65; cursor: not-allowed; }

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

  const mkBtn = (label: string, bg: string): HTMLButtonElement => {
    const b = el("button");
    b.className = "ga-ui-btn";
    b.type = "button";
    b.textContent = label;
    b.style.background = bg;
    return b;
  };

  const updateBtn = mkBtn("Fetch Data", "rgba(255,255,255,0.10)");
  const syncBtn = isDevBuild() ? mkBtn("Sync (Dev)", "rgba(255,255,255,0.10)") : null;
  const analysisBtn = mkBtn("Open Analysis Window", "rgba(35,95,160,0.28)");
  const discordBtn = mkBtn("Join Discord", "rgba(121,80,229,0.30)");
  const exportBtn = mkBtn("Export Excel", "rgba(40,120,50,0.35)");
  const resetBtn = mkBtn("Reset Database", "rgba(160,35,35,0.35)");

  const counts = el("div");
  counts.className = "ga-ui-counts";
  counts.textContent = "Data: 0 games, 0 rounds.";

  panel.appendChild(header);
  panel.appendChild(status);
  panel.appendChild(updateBtn);
  if (syncBtn) panel.appendChild(syncBtn);
  panel.appendChild(analysisBtn);
  panel.appendChild(discordBtn);
  panel.appendChild(exportBtn);
  panel.appendChild(resetBtn);
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
  if (syncBtn) {
    syncBtn.addEventListener("click", async () => {
      syncBtn.disabled = true;
      status.textContent = "Syncing...";
      try {
        let settings = loadServerSyncSettings();
        if (!settings.token) {
          status.textContent = "Missing sync token. Waiting for input...";
          const token = String(prompt("GeoAnalyzr Sync (Dev)\n\nPaste your sync token (will be saved locally):", "") || "").trim();
          if (!token) {
            status.textContent = "Sync canceled (no token).";
            return;
          }
          const endpoint = String(
            prompt("GeoAnalyzr Sync (Dev)\n\nSync endpoint URL:", settings.endpointUrl || "https://sync.geoanalyzr.lmbt.app/api/sync") || ""
          ).trim();
          saveServerSyncSettings({ token, endpointUrl: endpoint || settings.endpointUrl });
          settings = loadServerSyncSettings();
        }
        const res = await runServerSyncOnce(settings);
        const rowsTotal = res.counts.games + res.counts.rounds + res.counts.details + res.counts.gameAgg;
        status.textContent = res.ok ? `Synced · rows ${rowsTotal} · ${formatBytes(res.bytesGzip)}` : `Sync failed (HTTP ${res.status})`;
      } catch (e: any) {
        status.textContent = e instanceof Error ? e.message : String(e || "Sync failed");
      } finally {
        syncBtn.disabled = false;
      }
    });
  }
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
