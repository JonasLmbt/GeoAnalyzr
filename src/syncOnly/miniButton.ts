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
      border: 1px solid rgba(255,255,255,0.25);
      background: rgba(20,20,20,0.95);
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 6px 20px rgba(0,0,0,0.35);
      transition: transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
    }
    .ga-sync-mini:active { transform: translateY(1px); }
    .ga-sync-mini svg { display:block; filter: drop-shadow(0 0 14px rgba(0,162,254,0.40)); }

    .ga-sync-mini[data-state="working"] { border-color: rgba(58,232,189,0.55); box-shadow: 0 8px 26px rgba(58,232,189,0.18); }
    .ga-sync-mini[data-state="ok"] { border-color: rgba(58,232,189,0.70); box-shadow: 0 8px 26px rgba(58,232,189,0.14); }
    .ga-sync-mini[data-state="error"] { border-color: rgba(255,107,107,0.70); box-shadow: 0 8px 26px rgba(255,107,107,0.16); }
    .ga-sync-mini[data-state="needs_link"] { border-color: rgba(254,205,25,0.75); box-shadow: 0 8px 26px rgba(254,205,25,0.12); }

    .ga-sync-mini[data-state="working"] svg { animation: ga-spin 900ms linear infinite; transform-origin: 50% 50%; }
    @keyframes ga-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  `;
  (document.head ?? document.documentElement ?? document.body ?? document).appendChild(style);
}

export function createSyncMiniButton(opts: {
  onClick: (ev: MouseEvent) => void | Promise<void>;
}): {
  setState: (state: MiniButtonState) => void;
  setTitle: (title: string) => void;
} {
  cssOnce();

  const btn = el("button");
  btn.className = "ga-sync-mini";
  btn.type = "button";
  btn.title = "GeoAnalyzr Sync";
  btn.setAttribute("data-state", "idle");
  btn.innerHTML = logoSvgMarkup({ size: 28, idPrefix: "ga-sync-mini", variant: "light", decorative: true });
  btn.addEventListener("click", (ev) => void opts.onClick(ev));

  const mount = () => {
    if (!document.documentElement.contains(btn)) document.documentElement.appendChild(btn);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();

  return {
    setState(state) {
      btn.setAttribute("data-state", state);
    },
    setTitle(title) {
      btn.title = title;
    }
  };
}

