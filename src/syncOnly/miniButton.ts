import { logoSvgMarkup } from "../ui/logo";

export type MiniButtonState = "idle" | "working" | "ok" | "error" | "needs_link";

function el<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
  return document.createElement(tag);
}

function cssOnce(): void {
  const id = "geoanalyzr-sync-mini-css";
  if (document.getElementById(id)) return;
  const style = el("style");
  style.id = id;
  style.textContent = `
    .ga-sync-mini {
      position: fixed;
      left: 16px;
      bottom: 16px;
      z-index: 999999;
      width: 44px;
      height: 44px;
      border-radius: 999px;
      border: 1px solid rgba(0,162,254,0.45);
      background: rgba(20,20,20,0.95);
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 10px 26px rgba(0,162,254,0.12), 0 6px 20px rgba(0,0,0,0.32);
      transition: transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
      overflow: hidden;
    }
    .ga-sync-mini:active { transform: translateY(1px); }
    .ga-sync-mini svg { display:block; filter: drop-shadow(0 0 14px rgba(0,162,254,0.40)); }
    .ga-sync-mini .ga-sync-spinner {
      display: none;
      width: 22px;
      height: 22px;
      border-radius: 999px;
      border: 2px solid rgba(0,162,254,0.22);
      border-top-color: rgba(0,162,254,0.92);
      animation: ga-spin 850ms linear infinite;
    }

    .ga-sync-mini[data-state="working"] { border-color: rgba(0,162,254,0.75); box-shadow: 0 12px 32px rgba(0,162,254,0.18); }
    .ga-sync-mini[data-state="ok"] { border-color: rgba(58,232,189,0.70); box-shadow: 0 8px 26px rgba(58,232,189,0.14); }
    .ga-sync-mini[data-state="error"] { border-color: rgba(255,107,107,0.70); box-shadow: 0 8px 26px rgba(255,107,107,0.16); }
    .ga-sync-mini[data-state="needs_link"] { border-color: rgba(254,205,25,0.75); box-shadow: 0 8px 26px rgba(254,205,25,0.12); }

    .ga-sync-mini[data-state="working"] svg { display:none; }
    .ga-sync-mini[data-state="working"] .ga-sync-spinner { display:block; }
    @keyframes ga-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

    .ga-sync-toast {
      position: fixed;
      left: 16px;
      bottom: 68px;
      z-index: 999999;
      max-width: min(360px, calc(100vw - 32px));
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.18);
      background: rgba(20,20,20,0.97);
      color: rgba(255,255,255,0.92);
      font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      box-shadow: 0 12px 34px rgba(0,0,0,0.45);
      white-space: pre-wrap;
      opacity: 0;
      transform: translateY(6px);
      pointer-events: none;
      transition: opacity 140ms ease, transform 140ms ease;
    }
    .ga-sync-toast[data-open="1"] {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }
    .ga-sync-toast[data-kind="success"] { border-color: rgba(58,232,189,0.35); }
    .ga-sync-toast[data-kind="error"] { border-color: rgba(255,107,107,0.45); }
    .ga-sync-toast[data-kind="warn"] { border-color: rgba(254,205,25,0.45); }
  `;
  (document.head ?? document.documentElement ?? document.body ?? document).appendChild(style);
}

export function createSyncMiniButton(opts: {
  onClick: (ev: MouseEvent) => void | Promise<void>;
}): {
  setState: (state: MiniButtonState) => void;
  setTitle: (title: string) => void;
  showToast: (msg: string, kind?: "success" | "error" | "warn") => void;
} {
  cssOnce();

  const btn = el("button");
  btn.className = "ga-sync-mini";
  btn.type = "button";
  btn.title = "GeoAnalyzr Sync";
  btn.setAttribute("data-state", "idle");
  btn.innerHTML = logoSvgMarkup({ size: 28, idPrefix: "ga-sync-mini", variant: "light", decorative: true });
  const spinner = el("div");
  spinner.className = "ga-sync-spinner";
  spinner.setAttribute("aria-hidden", "true");
  btn.appendChild(spinner);
  btn.addEventListener("click", (ev) => void opts.onClick(ev));

  const toast = el("div");
  toast.className = "ga-sync-toast";
  toast.setAttribute("data-open", "0");
  toast.setAttribute("data-kind", "warn");
  toast.addEventListener("click", () => {
    toast.setAttribute("data-open", "0");
  });
  let toastTimer: number | null = null;
  const showToast = (msg: string, kind: "success" | "error" | "warn" = "warn") => {
    const text = typeof msg === "string" ? msg.trim() : "";
    if (!text) return;
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toast.textContent = text;
    toast.setAttribute("data-kind", kind);
    toast.setAttribute("data-open", "1");
    toastTimer = window.setTimeout(() => {
      toast.setAttribute("data-open", "0");
      toastTimer = null;
    }, kind === "error" ? 12000 : 8000);
  };

  const mount = () => {
    if (!document.documentElement.contains(btn)) document.documentElement.appendChild(btn);
    if (!document.documentElement.contains(toast)) document.documentElement.appendChild(toast);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();

  return {
    setState(state) {
      btn.setAttribute("data-state", state);
    },
    setTitle(title) {
      btn.title = title;
    },
    showToast
  };
}
