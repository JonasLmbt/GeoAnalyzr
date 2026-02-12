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

function cloneTemplate<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function initAnalysisWindow(opts?: { targetWindow?: Window | null }): Promise<void> {
  const targetWindow = opts?.targetWindow ?? window;
  if (!targetWindow || targetWindow.closed) {
    throw new Error("Semantic dashboard target window is unavailable.");
  }

  const doc = targetWindow.document;
  if (!doc.body || !doc.head) {
    throw new Error("Semantic dashboard target document is not ready.");
  }

  doc.title = "GeoAnalyzr - Semantic Dashboard";
  doc.documentElement.classList.add("ga-semantic-page");
  doc.body.classList.add("ga-semantic-page");
  injectSemanticDashboardCssOnce(doc);

  const semantic = cloneTemplate(semanticTemplate) as SemanticRegistry;
  let dashboard = loadDashboardTemplate(doc, cloneTemplate(dashboardTemplate) as DashboardDoc);
  let settings = loadSettings(doc);

  let root = doc.getElementById("geoanalyzr-semantic-root") as HTMLDivElement | null;
  let body: HTMLDivElement;

  const renderNow = async (): Promise<void> => {
    body.innerHTML = "";
    validateDashboardAgainstSemantic(semantic, dashboard);
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
    title.textContent = "GeoAnalyzr - Semantic Dashboard";

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
      semantic,
      getDashboard: () => dashboard,
      applyDashboard: async (next) => {
        dashboard = next;
        saveDashboardTemplate(doc, dashboard);
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

  applySettingsToRoot(root, settings);

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
