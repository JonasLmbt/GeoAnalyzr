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
  onTokenClick: (handler: () => void | Promise<void>) => void;
  onOpenAnalysisClick: (handler: () => void | Promise<void>) => void;

  openNcfaManager: (args: {
    initialToken: string;
    helpText: string;
    repoUrl: string;
    onSave: (token: string) => Promise<{ saved: boolean; token: string; message: string }>;
    onAutoDetect: () => Promise<{ detected: boolean; token?: string; source: string; message: string }>;
  }) => void;
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

function cssOnce(): void {
  const id = "geoanalyzr-overlay-css";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .ga-overlay {
      position: fixed;
      right: 14px;
      bottom: 14px;
      z-index: 2147483647;
      width: 320px;
      max-width: calc(100vw - 28px);
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial, sans-serif;
      color: rgba(243,244,255,0.92);
    }
    .ga-ov-card{
      border-radius: 14px;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,0.14);
      background:
        radial-gradient(520px 260px at 20% 0%, rgba(121, 80, 229, 0.16), transparent 60%),
        radial-gradient(520px 260px at 90% 0%, rgba(0, 162, 254, 0.12), transparent 62%),
        rgba(16, 16, 28, 0.72);
      backdrop-filter: blur(12px);
      box-shadow: 0 18px 54px rgba(0,0,0,0.22);
    }
    .ga-ov-head{
      display:flex; align-items:center; justify-content:space-between;
      padding: 10px 12px;
      border-bottom: 1px solid rgba(255,255,255,0.12);
      font-weight: 750;
    }
    .ga-ov-body{ padding: 10px 12px 12px; display:flex; flex-direction:column; gap:10px; }
    .ga-ov-row{ display:flex; gap:8px; flex-wrap:wrap; }
    .ga-ov-meta{ font-size: 12px; color: rgba(208, 214, 238, 0.74); line-height: 1.35; }
    .ga-ov-status{ font-size: 12px; color: rgba(208, 214, 238, 0.86); min-height: 16px; }
    .ga-ov-btn{
      border: 1px solid rgba(255,255,255,0.16);
      background: linear-gradient(180deg, rgba(121, 80, 229, 0.38) 0%, rgba(86, 59, 154, 0.26) 100%);
      color: rgba(243,244,255,0.94);
      border-radius: 999px;
      padding: 7px 12px;
      cursor: pointer;
      font-weight: 650;
      letter-spacing: 0.15px;
      font-size: 12px;
      line-height: 1;
    }
    .ga-ov-btn:hover{ filter: brightness(1.08); transform: translateY(-1px); }
    .ga-ov-btn:active{ transform: translateY(0px); }
    .ga-ov-btn-secondary{
      background: rgba(16, 16, 28, 0.45);
    }
    .ga-ov-btn-danger{
      border-color: rgba(255, 107, 107, 0.35);
      background: linear-gradient(180deg, rgba(255, 107, 107, 0.26) 0%, rgba(86, 59, 154, 0.18) 100%);
    }
    .ga-ov-btn:focus-visible{ outline: none; box-shadow: 0 0 0 3px rgba(0,162,254,0.30); }

    .ga-ov-modal{
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      background: rgba(0,0,0,0.62);
      display:flex;
      align-items:center;
      justify-content:center;
      padding: 16px;
    }
    .ga-ov-modal-card{
      width: 520px;
      max-width: calc(100vw - 32px);
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.16);
      background: rgba(16, 16, 28, 0.92);
      box-shadow: 0 22px 70px rgba(0,0,0,0.35);
      color: rgba(243,244,255,0.92);
      padding: 12px;
    }
    .ga-ov-modal-head{ display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom: 10px; }
    .ga-ov-modal-title{ font-weight: 750; }
    .ga-ov-x{ border:0; background: transparent; color: rgba(243,244,255,0.86); cursor:pointer; font-size: 18px; line-height: 1; }
    .ga-ov-input{
      width: 100%;
      box-sizing:border-box;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.18);
      padding: 10px 12px;
      background: rgba(16,16,28,0.55);
      color: rgba(243,244,255,0.92);
      font: inherit;
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
    }
    .ga-ov-help{ font-size: 12px; color: rgba(208, 214, 238, 0.70); margin-top: 8px; white-space: pre-wrap; }
  `;
  (document.head ?? document.documentElement ?? document.body ?? document).appendChild(style as any);
}

export function createUIOverlay(): UIOverlay {
  const host = el("div", "ga-overlay");
  const card = el("div", "ga-ov-card");
  host.appendChild(card);

  const mount = () => {
    cssOnce();
    if (!host.isConnected) (document.documentElement ?? document.body ?? document).appendChild(host as any);
  };

  const head = el("div", "ga-ov-head");
  const title = el("div");
  title.textContent = "GeoAnalyzr";
  const openBtn = el("button", "ga-ov-btn");
  openBtn.type = "button";
  openBtn.textContent = "Dashboard";
  head.appendChild(title);
  head.appendChild(openBtn);
  card.appendChild(head);

  const body = el("div", "ga-ov-body");
  card.appendChild(body);

  const meta = el("div", "ga-ov-meta");
  meta.textContent = "Data: -";

  const status = el("div", "ga-ov-status");
  status.textContent = "";

  const row1 = el("div", "ga-ov-row");
  const updateBtn = el("button", "ga-ov-btn");
  updateBtn.type = "button";
  updateBtn.textContent = "Update";

  const exportBtn = el("button", "ga-ov-btn ga-ov-btn-secondary");
  exportBtn.type = "button";
  exportBtn.textContent = "Export";

  const tokenBtn = el("button", "ga-ov-btn ga-ov-btn-secondary");
  tokenBtn.type = "button";
  tokenBtn.textContent = "NCFA";

  const resetBtn = el("button", "ga-ov-btn ga-ov-btn-danger");
  resetBtn.type = "button";
  resetBtn.textContent = "Reset DB";

  row1.appendChild(updateBtn);
  row1.appendChild(exportBtn);
  row1.appendChild(tokenBtn);
  row1.appendChild(resetBtn);

  body.appendChild(meta);
  body.appendChild(status);
  body.appendChild(row1);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }

  let updateHandler: (() => void | Promise<void>) | null = null;
  let resetHandler: (() => void | Promise<void>) | null = null;
  let exportHandler: (() => void | Promise<void>) | null = null;
  let tokenHandler: (() => void | Promise<void>) | null = null;
  let openHandler: (() => void | Promise<void>) | null = null;

  updateBtn.addEventListener("click", () => void updateHandler?.());
  resetBtn.addEventListener("click", () => void resetHandler?.());
  exportBtn.addEventListener("click", () => void exportHandler?.());
  tokenBtn.addEventListener("click", () => void tokenHandler?.());
  openBtn.addEventListener("click", () => void openHandler?.());

  const openNcfaManager = (args: Parameters<UIOverlay["openNcfaManager"]>[0]) => {
    const overlay = el("div", "ga-ov-modal");
    const modal = el("div", "ga-ov-modal-card");
    overlay.appendChild(modal);

    const head2 = el("div", "ga-ov-modal-head");
    const t = el("div", "ga-ov-modal-title");
    t.textContent = "NCFA token";
    const x = el("button", "ga-ov-x");
    x.type = "button";
    x.textContent = "×";
    head2.appendChild(t);
    head2.appendChild(x);

    const input = el("input", "ga-ov-input") as HTMLInputElement;
    input.placeholder = "_ncfa value";
    input.value = args.initialToken || "";

    const help = el("div", "ga-ov-help");
    help.textContent = "Set manually or use auto-detect.";

    const actions = el("div", "ga-ov-row");
    const save = el("button", "ga-ov-btn");
    save.type = "button";
    save.textContent = "Save";
    const auto = el("button", "ga-ov-btn ga-ov-btn-secondary");
    auto.type = "button";
    auto.textContent = "Auto-detect";
    const docs = el("button", "ga-ov-btn ga-ov-btn-secondary");
    docs.type = "button";
    docs.textContent = "Help";

    actions.appendChild(save);
    actions.appendChild(auto);
    actions.appendChild(docs);

    modal.appendChild(head2);
    modal.appendChild(input);
    modal.appendChild(actions);
    modal.appendChild(help);

    const close = () => overlay.remove();
    x.addEventListener("click", close);
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) close();
    });

    docs.addEventListener("click", () => window.open(args.repoUrl, "_blank"));

    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        const res = await args.onSave(input.value);
        input.value = res.token || "";
        help.textContent = res.message || "Saved.";
      } catch (e) {
        help.textContent = `Save failed: ${e instanceof Error ? e.message : String(e)}`;
      } finally {
        save.disabled = false;
      }
    });

    auto.addEventListener("click", async () => {
      auto.disabled = true;
      try {
        const res = await args.onAutoDetect();
        if (res.token) input.value = res.token;
        help.textContent = res.message || `Auto-detect: ${res.source}`;
      } catch (e) {
        help.textContent = `Auto-detect failed: ${e instanceof Error ? e.message : String(e)}`;
      } finally {
        auto.disabled = false;
      }
    });

    (document.documentElement ?? document.body ?? document).appendChild(overlay as any);
  };

  return {
    setVisible(visible) {
      host.style.display = visible ? "block" : "none";
    },
    setStatus(msg) {
      status.textContent = msg;
    },
    setCounts(value) {
      meta.textContent = `Data: ${value.games} games, ${value.rounds} rounds (details ok ${value.detailsOk}, missing ${value.detailsMissing}, error ${value.detailsError}).`;
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
    onTokenClick(fn) {
      tokenHandler = fn;
    },
    onOpenAnalysisClick(fn) {
      openHandler = fn;
    },
    openNcfaManager
  };
}
