import type { SemanticRegistry } from "./config/semantic.types";
import type { DashboardDoc } from "./config/dashboard.types";
import { validateDashboardAgainstSemantic } from "./engine/validate";
import semanticTemplate from "./config/semantic.json";
import dashboardTemplate from "./config/dashboard.json";
import { injectSemanticDashboardCssOnce } from "./ui/semanticDashboardCss";
import {
  applySettingsToRoot,
  loadDashboardTemplate,
  loadSettings,
  saveDashboardTemplate,
  saveSettings,
  type SemanticDashboardSettings
} from "./ui/settingsStore";
import { attachSettingsModal } from "./ui/settingsModal";
import { renderAnalysisApp } from "./ui/analysisRenderer";
import { getCurrentPlayerName } from "./app/playerIdentity";
import { logoSvgMarkup } from "./ui/logo";
import { mergeSemanticWithDashboard } from "./engine/semanticMerge";
import { analysisConsole } from "./ui/consoleStore";

function cloneTemplate<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

type BootLog = {
  log: (message: string) => void;
  error: (message: string, err?: unknown) => void;
  remove: () => void;
};

function createBootLog(doc: Document): BootLog {
  return {
    log: (message) => analysisConsole.info(message),
    error: (message, err) => analysisConsole.error(message, err),
    remove: () => void 0
  };
}

async function ensureDocumentShell(targetWindow: Window, doc: Document): Promise<void> {
  // Firefox can briefly report a usable `document` for `about:blank` and then
  // "finish" the blank navigation and wipe whatever was injected.
  // To avoid the post-injection wipe, force-write a minimal shell when targeting a new tab.
  const isSameWindow = targetWindow === window;
  const href = (() => {
    try {
      const w = doc.defaultView as any;
      const h = w?.location?.href;
      if (typeof h === "string") return h;
    } catch {
      // ignore
    }
    return typeof doc.URL === "string" ? doc.URL : "";
  })();
  const isAboutBlank = href === "about:blank" || href.startsWith("about:blank#") || doc.URL === "about:blank";
  const hasRoot = (() => {
    try {
      return !!doc.getElementById("geoanalyzr-semantic-root");
    } catch {
      return false;
    }
  })();

  if (!isSameWindow && isAboutBlank && !hasRoot) {
    try {
      doc.open();
      doc.write(
        "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
          "<style>html,body{margin:0;padding:0;background:#0b1020;color:#cbd5e1;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}#geoanalyzr-boot-placeholder{padding:16px}#geoanalyzr-boot-placeholder h1{margin:0 0 6px 0;font-size:16px;color:#fff}#geoanalyzr-boot-placeholder p{margin:0;font-size:13px;opacity:.85}</style>" +
          "</head><body><div id=\"geoanalyzr-boot-placeholder\"><h1>GeoAnalyzr</h1><p>Loading analysis…</p></div></body></html>"
      );
      doc.close();
    } catch {
      // Ignore and fall back to manual element creation below.
    }
  }

  if (doc.head && doc.body) return;

  if (!doc.documentElement) {
    try {
      const html = doc.createElement("html");
      doc.appendChild(html);
    } catch {
      // If we cannot create a root element, we have no safe way to continue.
      return;
    }
  }

  if (!doc.head) {
    try {
      const head = doc.createElement("head");
      doc.documentElement.insertBefore(head, doc.documentElement.firstChild);
    } catch {
      // ignore
    }
  }

  if (!doc.body) {
    try {
      const body = doc.createElement("body");
      doc.documentElement.appendChild(body);
    } catch {
      // ignore
    }
  }

  if (doc.head && doc.body) return;

  // Last resort: give the browser a moment to finish initializing `about:blank`.
  const timeoutMs = 1500;
  const start = Date.now();
  while (!(doc.head && doc.body)) {
    if (targetWindow.closed) break;
    if (Date.now() - start > timeoutMs) break;
    await new Promise((r) => setTimeout(r, 25));
  }
}

export async function initAnalysisWindow(opts?: { targetWindow?: Window | null }): Promise<void> {
  const targetWindow = opts?.targetWindow ?? window;
  if (!targetWindow || targetWindow.closed) {
    throw new Error("Semantic dashboard target window is unavailable.");
  }

  // Prevent re-entrant init loops (e.g. Firefox late about:blank commit).
  if ((targetWindow as any).__gaAnalysisInitInProgress) return;
  (targetWindow as any).__gaAnalysisInitInProgress = true;

  let doc: Document;
  try {
    doc = targetWindow.document;
  } catch (e) {
    // Likely a cross-origin / security issue.
    throw new Error(`Cannot access semantic dashboard document: ${e instanceof Error ? e.message : String(e)}`);
  }

  await ensureDocumentShell(targetWindow, doc);
  if (!doc.body || !doc.head) {
    throw new Error("Semantic dashboard target document is not ready.");
  }

  try {
    doc.getElementById("geoanalyzr-boot-placeholder")?.remove();
  } catch {
    // ignore
  }

  const boot = createBootLog(doc);
  const ua = doc.defaultView?.navigator?.userAgent ?? "";
  boot.log("GeoAnalyzr: analysis window boot");
  boot.log(`readyState=${doc.readyState} ua=${ua}`);

  if (!(targetWindow as any).__gaBootHandlersInstalled) {
    (targetWindow as any).__gaBootHandlersInstalled = true;
    targetWindow.addEventListener("error", (ev: any) => {
      const msg = typeof ev?.message === "string" ? ev.message : "Unhandled window error";
      boot.error(`window.onerror: ${msg}`, ev?.error);
    });
    targetWindow.addEventListener("unhandledrejection", (ev: PromiseRejectionEvent) => {
      boot.error("unhandledrejection", (ev as any)?.reason);
    });
  }

  doc.title = "GeoAnalyzr";
  doc.documentElement.classList.add("ga-semantic-page");
  doc.body.classList.add("ga-semantic-page");
  boot.log("Injecting dashboard CSS...");
  injectSemanticDashboardCssOnce(doc);

  boot.log("Loading templates/settings...");
  const semanticBase = cloneTemplate(semanticTemplate) as SemanticRegistry;
  let dashboard = loadDashboardTemplate(doc, cloneTemplate(dashboardTemplate) as DashboardDoc);
  let settings = loadSettings(doc);

  let root = doc.getElementById("geoanalyzr-semantic-root") as HTMLDivElement | null;
  let body: HTMLDivElement;

  // Resolve player name asynchronously so the first-open experience never shows a blank/unresponsive window.
  // (On first run, name resolution may require network and can take a moment; subsequent opens are cached.)
  let playerName: string | undefined;

  const applyTitleTemplate = (tpl: string, vars: Record<string, string | undefined>): string => {
    const raw = String(tpl ?? "");
    const rendered = raw.replace(/\{\{\s*([A-Za-z0-9_\-]{3,64})\s*\}\}/g, (_, key: string) => {
      const v = vars[key];
      return typeof v === "string" ? v : "";
    });
    return rendered.trim();
  };

  const updateTitles = (): void => {
    const dashTitle = dashboard?.dashboard?.title ?? "GeoAnalyzr";
    const ui: any = (dashboard as any)?.dashboard?.ui;
    const topTpl = typeof ui?.topbarTitle === "string" ? ui.topbarTitle : "{{dashboardTitle}}";
    const winTpl = typeof ui?.windowTitle === "string" ? ui.windowTitle : "{{dashboardTitle}}";
    const vars = { playerName, dashboardTitle: dashTitle };

    const topTitle = applyTitleTemplate(topTpl, vars) || dashTitle;
    const winTitle = applyTitleTemplate(winTpl, vars) || dashTitle;

    doc.title = winTitle;
    const titleTextEl = doc.querySelector(".ga-topbar .ga-title .ga-title-text") as HTMLSpanElement | null;
    if (titleTextEl) titleTextEl.textContent = topTitle;
    else {
      const titleEl = doc.querySelector(".ga-topbar .ga-title") as HTMLDivElement | null;
      if (titleEl) titleEl.textContent = topTitle;
    }
  };

  const renderNow = async (): Promise<void> => {
    body.innerHTML = "";

    // Show a visible loader and yield once so the UI can paint (keeps the tab feeling responsive).
    const loader = doc.createElement("div");
    loader.className = "ga-loading";
    loader.innerHTML = "<div class=\"ga-spinner\"></div><div class=\"ga-loading-text\">Loading…</div>";
    body.appendChild(loader);
    await new Promise<void>((r) => setTimeout(r, 0));

    boot.log("Merging semantic + validating...");
    const semantic = mergeSemanticWithDashboard(semanticBase, dashboard);
    validateDashboardAgainstSemantic(semantic, dashboard);
    updateTitles();
    boot.log("Rendering analysis app...");
    await renderAnalysisApp({ body, semantic, dashboard });
    boot.log("Render complete.");
    boot.remove();
  };

  if (!root) {
    root = doc.createElement("div");
    root.id = "geoanalyzr-semantic-root";
    root.className = "ga-root";

    const top = doc.createElement("div");
    top.className = "ga-topbar";

    const title = doc.createElement("div");
    title.className = "ga-title";
    const titleLogo = doc.createElement("span");
    titleLogo.className = "ga-title-logo";
    titleLogo.innerHTML = logoSvgMarkup({ size: 18, idPrefix: "ga-analysis-topbar", variant: "light", decorative: true });

    const titleText = doc.createElement("span");
    titleText.className = "ga-title-text";
    titleText.textContent = "GeoAnalyzr";

    title.appendChild(titleLogo);
    title.appendChild(titleText);

    const actions = doc.createElement("div");
    actions.className = "ga-topbar-actions";

    const settingsBtn = doc.createElement("button");
    settingsBtn.className = "ga-gear";
    settingsBtn.textContent = "Settings";
    settingsBtn.title = "Settings";

    const close = doc.createElement("button");
    close.className = "ga-close";
    close.textContent = "Close";
    close.addEventListener("click", () => {
      targetWindow.close();
    });

    actions.appendChild(settingsBtn);
    actions.appendChild(close);
    top.appendChild(title);
    top.appendChild(actions);

    body = doc.createElement("div");
    body.className = "ga-body";

    root.appendChild(top);
    root.appendChild(body);
    doc.body.appendChild(root);

    attachSettingsModal({
      doc,
      targetWindow,
      root,
      openButton: settingsBtn,
      semantic: semanticBase,
      getDashboard: () => dashboard,
      getDefaultDashboard: () => cloneTemplate(dashboardTemplate) as DashboardDoc,
      applyDashboard: async (next) => {
        dashboard = next;
        saveDashboardTemplate(doc, dashboard);
        updateTitles();
        await renderNow();
      },
      getSettings: () => settings,
      applySettings: async (next: SemanticDashboardSettings) => {
        settings = next;
        applySettingsToRoot(root, settings);
        saveSettings(doc, settings);
      }
    });
  } else {
    const foundBody = root.querySelector(".ga-body");
    if (!(foundBody instanceof HTMLDivElement)) {
      throw new Error("Semantic root has no .ga-body container");
    }
    body = foundBody;
  }

  if (!root) {
    throw new Error("Semantic root is missing after initialization.");
  }

  applySettingsToRoot(root, settings);
  updateTitles();

  boot.log("Resolving player name (async)...");
  void (async () => {
    try {
      playerName = await getCurrentPlayerName();
      updateTitles();
    } catch {
      // ignore
    }
  })();

  try {
    await renderNow();
  } catch (error) {
    body.innerHTML = "";
    const pre = doc.createElement("pre");
    pre.style.margin = "12px";
    pre.style.whiteSpace = "pre-wrap";
    pre.style.color = "#ff9aa2";
    const describe = (e: any): string => {
      if (e instanceof Error) return `${e.name}: ${e.message}\n${e.stack ?? ""}`.trim();
      const name = typeof e?.name === "string" ? e.name : "";
      const msg = typeof e?.message === "string" ? e.message : "";
      if (name || msg) return `${name ? `${name}: ` : ""}${msg}`.trim();
      try {
        const seen = new WeakSet<object>();
        const plain: any = {};
        if (e && typeof e === "object") {
          for (const k of Object.getOwnPropertyNames(e)) {
            try {
              (plain as any)[k] = (e as any)[k];
            } catch {
              // ignore
            }
          }
        }
        const json = JSON.stringify(
          Object.keys(plain).length ? plain : e,
          (_k, v) => {
            if (typeof v === "bigint") return String(v);
            if (v && typeof v === "object") {
              if (seen.has(v as object)) return "[Circular]";
              seen.add(v as object);
            }
            return v;
          },
          2
        );
        if (typeof json === "string" && json && json !== "{}") return json;
      } catch {
        // ignore
      }
      try {
        const ctor = e?.constructor?.name;
        const tag = Object.prototype.toString.call(e);
        const keys = e && typeof e === "object" ? Object.getOwnPropertyNames(e).slice(0, 24).join(", ") : "";
        return `${ctor ? `${ctor} ` : ""}${tag}${keys ? ` keys=[${keys}]` : ""}`.trim();
      } catch {
        return String(e);
      }
    };
    pre.textContent = `Failed to render semantic dashboard:\n${describe(error)}`;
    body.appendChild(pre);
    boot.error("Failed to render semantic dashboard", error);
    throw error;
  } finally {
    // If the browser finishes about:blank navigation after our first render (Firefox),
    // it can wipe the document. Install a tiny watchdog that retries init once.
    if (!(targetWindow as any).__gaAnalysisWatchdogInstalled) {
      (targetWindow as any).__gaAnalysisWatchdogInstalled = true;
      const schedule = (delayMs: number) => {
        (targetWindow as any)?.setTimeout?.(() => {
          try {
            if (targetWindow.closed) return;
            const d = targetWindow.document;
            const root = d.getElementById("geoanalyzr-semantic-root");
            if (root) return;

            const attempts = ((targetWindow as any).__gaAnalysisInitAttempts ?? 0) + 1;
            (targetWindow as any).__gaAnalysisInitAttempts = attempts;
            if (attempts > 2) return;

            // Force a shell rewrite by clearing root markers and re-running init.
            void initAnalysisWindow({ targetWindow });
          } catch {
            // ignore
          }
        }, delayMs);
      };
      schedule(250);
      schedule(1200);
      schedule(3000);
    }

    (targetWindow as any).__gaAnalysisInitInProgress = false;
  }
}
