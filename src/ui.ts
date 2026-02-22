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

function cloneTemplate<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

async function ensureDocumentShell(targetWindow: Window, doc: Document): Promise<void> {
  if (doc.head && doc.body) return;

  // Firefox can return a Window for `about:blank` before head/body exist.
  // Ensure the document has a minimal HTML shell before we start injecting UI/CSS.
  try {
    doc.open();
    doc.write("<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>");
    doc.close();
  } catch {
    // Ignore and fall back to manual element creation below.
  }

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

  const doc = targetWindow.document;
  await ensureDocumentShell(targetWindow, doc);
  if (!doc.body || !doc.head) {
    throw new Error("Semantic dashboard target document is not ready.");
  }

  doc.title = "GeoAnalyzr";
  doc.documentElement.classList.add("ga-semantic-page");
  doc.body.classList.add("ga-semantic-page");
  injectSemanticDashboardCssOnce(doc);

  const semanticBase = cloneTemplate(semanticTemplate) as SemanticRegistry;
  let dashboard = loadDashboardTemplate(doc, cloneTemplate(dashboardTemplate) as DashboardDoc);
  let settings = loadSettings(doc);

  let root = doc.getElementById("geoanalyzr-semantic-root") as HTMLDivElement | null;
  let body: HTMLDivElement;

  const playerName = await getCurrentPlayerName();

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
    const semantic = mergeSemanticWithDashboard(semanticBase, dashboard);
    validateDashboardAgainstSemantic(semantic, dashboard);
    updateTitles();
    await renderAnalysisApp({ body, semantic, dashboard });
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

  try {
    await renderNow();
  } catch (error) {
    body.innerHTML = "";
    const pre = doc.createElement("pre");
    pre.style.margin = "12px";
    pre.style.whiteSpace = "pre-wrap";
    pre.style.color = "#ff9aa2";
    pre.textContent = `Failed to render semantic dashboard:\n${error instanceof Error ? error.message : String(error)}`;
    body.appendChild(pre);
    throw error;
  }
}
