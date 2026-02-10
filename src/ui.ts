import type { SemanticRegistry } from "./config/semantic.types";
import type { DashboardDoc } from "./config/dashboard.types";
import { renderDashboard } from "./ui/dashboardRenderer";
import { validateDashboardAgainstSemantic } from "./engine/validate";
import semanticTemplate from "./config/semantic.json";
import dashboardTemplate from "./config/dashboard.json";

function cloneTemplate<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function injectCssOnce(): void {
  const id = "geoanalyzr-semantic-dashboard-css";
  if (document.getElementById(id)) return;

  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .ga-root { position: fixed; inset: 24px; z-index: 999999; background: #0f0f0f; color: #ddd; border: 1px solid #333; border-radius: 16px; overflow: hidden; }
    .ga-topbar { display:flex; justify-content:space-between; align-items:center; padding:10px 12px; border-bottom:1px solid #2a2a2a; background:#141414; }
    .ga-title { font-weight: 700; }
    .ga-close { background:#222; border:1px solid #333; color:#ddd; border-radius:10px; padding:6px 10px; cursor:pointer; }
    .ga-body { height: calc(100% - 46px); overflow:auto; }
    .ga-tabs { display:flex; gap:8px; padding:10px; }
    .ga-tab { background:#222; color:#ddd; border:1px solid #333; padding:6px 10px; border-radius:10px; cursor:pointer; }
    .ga-tab.active { background:#333; }
    .ga-content { padding:10px; }
    .ga-card { background:#161616; border:1px solid #2a2a2a; border-radius:14px; overflow:hidden; }
    .ga-card-header { padding:10px 12px; border-bottom:1px solid #2a2a2a; font-weight:650; }
    .ga-card-body { padding:12px; }
    .ga-widget-title { font-size:12px; opacity:0.8; margin-bottom:6px; }
    .ga-statlist-box { background:#101010; border:1px solid #2a2a2a; border-radius:12px; padding:10px; }
    .ga-statrow { display:flex; justify-content:space-between; padding:6px 2px; border-bottom:1px dashed rgba(255,255,255,0.06); }
    .ga-statrow:last-child { border-bottom:none; }
    .ga-chart-box { background:#101010; border:1px solid #2a2a2a; border-radius:12px; padding:10px; }
    .ga-breakdown-box { display:flex; flex-direction:column; gap:8px; }
    .ga-breakdown-row { display:flex; justify-content:space-between; gap:10px; align-items:center; }
    .ga-breakdown-label { max-width:40%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ga-breakdown-right { flex:1; display:flex; align-items:center; gap:10px; }
    .ga-breakdown-value { min-width:72px; text-align:right; font-variant-numeric: tabular-nums; }
    .ga-breakdown-barwrap { flex:1; height:8px; background:#222; border-radius:999px; overflow:hidden; }
    .ga-breakdown-bar { height:100%; background:#7eb6ff; border-radius:999px; }
    .ga-drilldown-modal { position:fixed; inset:0; z-index:9999999; }
    .ga-drilldown-bg { position:absolute; inset:0; background:rgba(0,0,0,0.6); }
    .ga-drilldown-panel { position:absolute; top:6%; left:50%; transform:translateX(-50%); width:min(1100px, 92vw); max-height:88vh; overflow:auto; background:#151515; border:1px solid #333; border-radius:14px; }
    .ga-drilldown-header { display:flex; justify-content:space-between; align-items:center; padding:10px 12px; border-bottom:1px solid #2a2a2a; }
    .ga-drilldown-close { background:#222; border:1px solid #333; color:#ddd; border-radius:10px; padding:6px 10px; cursor:pointer; }
    .ga-drilldown-table { width:100%; border-collapse:collapse; font-size:12px; }
    .ga-drilldown-table th, .ga-drilldown-table td { padding:8px 10px; border-bottom:1px solid rgba(255,255,255,0.06); text-align:left; }
  `;
  document.head.appendChild(style);
}

export async function initAnalysisWindow(): Promise<void> {
  injectCssOnce();

  let root = document.getElementById("geoanalyzr-semantic-root") as HTMLDivElement | null;
  let body: HTMLDivElement;

  if (!root) {
    root = document.createElement("div");
    root.id = "geoanalyzr-semantic-root";
    root.className = "ga-root";

    const top = document.createElement("div");
    top.className = "ga-topbar";

    const title = document.createElement("div");
    title.className = "ga-title";
    title.textContent = "GeoAnalyzr (semantic/dashboard demo)";

    const close = document.createElement("button");
    close.className = "ga-close";
    close.textContent = "Close";
    close.addEventListener("click", () => {
      root!.style.display = "none";
    });

    top.appendChild(title);
    top.appendChild(close);

    body = document.createElement("div");
    body.className = "ga-body";

    root.appendChild(top);
    root.appendChild(body);
    document.body.appendChild(root);
  } else {
    root.style.display = "block";
    const foundBody = root.querySelector(".ga-body");
    if (!(foundBody instanceof HTMLDivElement)) {
      throw new Error("Semantic root has no .ga-body container");
    }
    body = foundBody;
    body.innerHTML = "";
  }

  try {
    const semantic = cloneTemplate(semanticTemplate) as SemanticRegistry;
    const dashboard = cloneTemplate(dashboardTemplate) as DashboardDoc;

    validateDashboardAgainstSemantic(semantic, dashboard);
    await renderDashboard(body, semantic, dashboard);
  } catch (error) {
    body.innerHTML = "";
    const pre = document.createElement("pre");
    pre.style.margin = "12px";
    pre.style.whiteSpace = "pre-wrap";
    pre.style.color = "#ff9aa2";
    pre.textContent = `Failed to render semantic dashboard:\n${error instanceof Error ? error.message : String(error)}`;
    body.appendChild(pre);
    throw error;
  }
}
