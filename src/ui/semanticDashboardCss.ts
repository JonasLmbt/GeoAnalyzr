export function injectSemanticDashboardCssOnce(doc: Document): void {
  const id = "geoanalyzr-semantic-dashboard-css";
  if (doc.getElementById(id)) return;

  const style = doc.createElement("style");
  style.id = id;
  style.textContent = `
    html.ga-semantic-page, body.ga-semantic-page {
      margin: 0;
      padding: 0;
      min-height: 100%;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial, sans-serif;
      background: var(--ga-bg);
      color: var(--ga-text);
    }
    .ga-root {
      --ga-font: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial, sans-serif;
      --ga-bg: #0f1115;
      --ga-surface: #15181e;
      --ga-surface-2: #171b22;
      --ga-card: #12161d;
      --ga-card-2: #10141b;
      --ga-text: #d7deea;
      --ga-text-muted: #9aa5b6;
      --ga-border: #2b3340;
      --ga-control-bg: #161b23;
      --ga-control-text: #d7deea;
      --ga-control-border: #3a4352;
      --ga-axis-color: #7f8ca2;
      --ga-axis-grid: #3c4555;
      --ga-axis-text: #c7d2e4;
      --ga-graph-color: #7eb6ff;
      --ga-accent: #7950E5;
      --ga-accent2: #00A2FE;
      --ga-good: #97E851;
      --ga-warn: #FECD19;
      --ga-danger: #ff6b6b;
      --ga-link: var(--ga-accent2);
      --ga-overlay-bg: rgba(0,0,0,0.62);
      --ga-focus-ring: color-mix(in srgb, var(--ga-accent2) 55%, transparent);
      min-height: 100vh;
      background: var(--ga-bg);
      color: var(--ga-text);
      font-family: var(--ga-font);
    }
    .ga-root[data-ga-theme="light"] {
      --ga-bg: #f4f7fc;
      --ga-surface: #ffffff;
      --ga-surface-2: #f9fbff;
      --ga-card: #ffffff;
      --ga-card-2: #f8fbff;
      --ga-text: #1f2a38;
      --ga-text-muted: #4b5d74;
      --ga-border: #c8d5e6;
      --ga-control-bg: #ffffff;
      --ga-control-text: #1f2a38;
      --ga-control-border: #b7c7dd;
      --ga-axis-color: #51647e;
      --ga-axis-grid: #c2cfdf;
      --ga-axis-text: #2b3d56;
      --ga-link: #563B9A;
      --ga-overlay-bg: rgba(10,12,18,0.35);
      --ga-focus-ring: color-mix(in srgb, var(--ga-accent) 55%, transparent);
    }
    .ga-root[data-ga-theme="geoguessr"] {
      --ga-font: "Poppins", ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial, sans-serif;
      --ga-bg:
        radial-gradient(1200px 720px at 18% -12%, rgba(58, 232, 189, 0.18), transparent 62%),
        radial-gradient(980px 560px at 86% -6%, rgba(0, 162, 254, 0.18), transparent 60%),
        radial-gradient(1200px 860px at 50% 112%, rgba(121, 80, 229, 0.24), transparent 56%),
        linear-gradient(180deg, #10101C 0%, #1A1A2E 100%);
      --ga-surface: rgba(22, 22, 38, 0.72);
      --ga-surface-2: rgba(26, 26, 46, 0.78);
      --ga-card: rgba(22, 22, 38, 0.62);
      --ga-card-2: rgba(18, 18, 32, 0.56);
      --ga-text: rgba(243, 244, 255, 0.92);
      --ga-text-muted: rgba(208, 214, 238, 0.68);
      --ga-border: rgba(255,255,255,0.12);
      --ga-control-bg: rgba(16, 16, 28, 0.45);
      --ga-control-text: rgba(243, 244, 255, 0.92);
      --ga-control-border: rgba(255,255,255,0.14);
      --ga-axis-color: rgba(220, 226, 250, 0.50);
      --ga-axis-grid: rgba(255,255,255,0.10);
      --ga-axis-text: rgba(233, 236, 255, 0.78);
      --ga-accent: #7950E5;
      --ga-accent2: #00A2FE;
      --ga-good: #3AE8BD;
      --ga-warn: #FECD19;
      --ga-danger: #ff6b6b;
      --ga-link: #3AE8BD;
      --ga-overlay-bg: rgba(6, 6, 14, 0.72);
      --ga-focus-ring: color-mix(in srgb, #00A2FE 55%, transparent);
      --ga-graph-color: var(--ga-good);
    }
    .ga-topbar {
      display:flex;
      justify-content:space-between;
      align-items:center;
      padding:10px 14px;
      border-bottom:1px solid var(--ga-border);
      background: var(--ga-surface);
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .ga-title { font-weight: 700; }
    .ga-topbar-actions { display:flex; align-items:center; gap:8px; }
    .ga-close, .ga-gear {
      background: var(--ga-control-bg);
      border:1px solid var(--ga-control-border);
      color:var(--ga-control-text);
      border-radius:10px;
      padding:6px 10px;
      cursor:pointer;
    }
    .ga-root button:focus-visible,
    .ga-root select:focus-visible,
    .ga-root input:focus-visible,
    .ga-root textarea:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px var(--ga-focus-ring);
    }
    .ga-root[data-ga-theme="geoguessr"] .ga-topbar {
      backdrop-filter: blur(12px);
      box-shadow: 0 10px 34px rgba(0,0,0,0.20);
    }
    .ga-body { padding: 8px 12px 16px; }
    .ga-filters {
      display:flex;
      justify-content:space-between;
      gap:10px;
      padding:10px 10px 6px;
      flex-wrap:wrap;
    }
    .ga-filters-left { display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end; }
    .ga-filters-right { display:flex; gap:8px; flex-wrap:wrap; align-items:flex-end; }
    .ga-filter {
      display:flex;
      flex-direction:column;
      gap:6px;
      padding:8px 10px;
      background: var(--ga-surface);
      border:1px solid var(--ga-border);
      border-radius:12px;
      min-width: 200px;
    }
    .ga-filter-label { font-size:12px; color: var(--ga-text-muted); }
    .ga-filter-row { display:flex; gap:8px; align-items:center; }
    .ga-filter select, .ga-filter input[type="date"] {
      background: var(--ga-control-bg);
      color: var(--ga-control-text);
      border:1px solid var(--ga-control-border);
      border-radius:8px;
      padding:6px 8px;
      font: inherit;
      font-size: 12px;
    }
    .ga-filter-btn {
      background: var(--ga-control-bg);
      border:1px solid var(--ga-control-border);
      color: var(--ga-control-text);
      border-radius:10px;
      padding:7px 10px;
      cursor:pointer;
      font-size:12px;
      height: 34px;
    }
    .ga-tabs { display:flex; gap:8px; padding:10px; }
    .ga-tab {
      background:var(--ga-control-bg);
      color:var(--ga-control-text);
      border:1px solid var(--ga-control-border);
      padding:6px 10px;
      border-radius:10px;
      cursor:pointer;
    }
    .ga-tab.active { background: var(--ga-surface-2); }
    .ga-content { padding:10px; }
    .ga-card {
      background: var(--ga-card);
      border:1px solid var(--ga-border);
      border-radius:14px;
      overflow:hidden;
    }
    .ga-root[data-ga-theme="geoguessr"] .ga-card {
      backdrop-filter: blur(10px);
      box-shadow: 0 18px 54px rgba(0,0,0,0.18);
    }
    .ga-root[data-ga-theme="geoguessr"] .ga-close,
    .ga-root[data-ga-theme="geoguessr"] .ga-gear,
    .ga-root[data-ga-theme="geoguessr"] .ga-filter-btn,
    .ga-root[data-ga-theme="geoguessr"] .ga-chart-actions button,
    .ga-root[data-ga-theme="geoguessr"] .ga-breakdown-toggle {
      background: linear-gradient(180deg, rgba(121, 80, 229, 0.38) 0%, rgba(86, 59, 154, 0.26) 100%);
      border-color: rgba(255,255,255,0.16);
      box-shadow: 0 10px 26px rgba(0,0,0,0.22);
      border-radius: 999px;
      padding: 7px 12px;
      font-weight: 650;
      letter-spacing: 0.15px;
      transition: transform 160ms ease, filter 160ms ease, box-shadow 160ms ease;
    }
    .ga-root[data-ga-theme="geoguessr"] .ga-close:hover,
    .ga-root[data-ga-theme="geoguessr"] .ga-gear:hover,
    .ga-root[data-ga-theme="geoguessr"] .ga-filter-btn:hover,
    .ga-root[data-ga-theme="geoguessr"] .ga-chart-actions button:hover,
    .ga-root[data-ga-theme="geoguessr"] .ga-breakdown-toggle:hover {
      filter: brightness(1.06);
      box-shadow: 0 16px 38px rgba(0,0,0,0.28);
      transform: translateY(-1px);
    }

    /* GeoGuessr-like section tabs (top navigation vibe) */
    .ga-root[data-ga-theme="geoguessr"] .ga-tabs {
      padding: 6px 10px;
      gap: 12px;
      border-radius: 14px;
      background: linear-gradient(180deg, rgba(16, 16, 28, 0.42) 0%, rgba(16, 16, 28, 0.18) 100%);
      border: 1px solid rgba(255,255,255,0.08);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), 0 14px 34px rgba(0,0,0,0.20);
      backdrop-filter: blur(14px);
      overflow-x: auto;
      scrollbar-width: none;
      width: fit-content;
      max-width: 100%;
      margin: 4px 10px 0;
    }
    .ga-root[data-ga-theme="geoguessr"] .ga-tabs::-webkit-scrollbar { display: none; }
    .ga-root[data-ga-theme="geoguessr"] .ga-tabs .ga-tab {
      background: transparent;
      border: 0;
      box-shadow: none;
      border-radius: 10px;
      padding: 8px 4px;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.9px;
      text-transform: uppercase;
      color: rgba(243,244,255,0.70);
      transition: color 160ms ease, background 160ms ease;
    }

    .ga-team-local-filters {
      display:flex;
      gap:10px;
      flex-wrap:wrap;
      align-items:flex-end;
      margin: 6px 0 10px;
    }
    .ga-team-local-filters .ga-filter { min-width: 240px; }
    .ga-root[data-ga-theme="geoguessr"] .ga-tabs .ga-tab:hover {
      background: rgba(255,255,255,0.04);
      color: rgba(255,255,255,0.88);
    }
    .ga-root[data-ga-theme="geoguessr"] .ga-tabs .ga-tab.active {
      background: transparent;
      color: rgba(255,255,255,0.96);
    }
    .ga-root[data-ga-theme="geoguessr"] .ga-tabs .ga-tab.active::after {
      content: "";
      position: absolute;
      left: 6px;
      right: 6px;
      bottom: 2px;
      height: 2px;
      border-radius: 999px;
      background: rgba(254, 205, 25, 0.95);
      filter: drop-shadow(0 6px 14px rgba(0,0,0,0.32));
    }
    .ga-root[data-ga-theme="geoguessr"] .ga-tabs .ga-tab { position: relative; }

    /* GeoGuessr-like drilldown styling */
    .ga-root[data-ga-theme="geoguessr"] .ga-drilldown-panel {
      border-radius: 18px;
      background:
        radial-gradient(900px 520px at 18% 0%, rgba(121, 80, 229, 0.22), transparent 58%),
        radial-gradient(900px 520px at 86% 0%, rgba(0, 162, 254, 0.16), transparent 60%),
        color-mix(in srgb, var(--ga-surface) 88%, transparent);
      border-color: rgba(255,255,255,0.14);
      box-shadow: 0 28px 90px rgba(0,0,0,0.48);
      overflow: auto;
      overscroll-behavior: contain;
    }
    .ga-root[data-ga-theme="geoguessr"] .ga-drilldown-header {
      background: linear-gradient(180deg, rgba(22,22,38,0.82) 0%, rgba(22,22,38,0.58) 100%);
      border-bottom-color: rgba(255,255,255,0.10);
      backdrop-filter: blur(14px);
      padding: 12px 14px;
    }
    .ga-root[data-ga-theme="geoguessr"] .ga-drilldown-title {
      font-size: 13px;
      font-weight: 750;
      letter-spacing: 0.3px;
    }
    .ga-root[data-ga-theme="geoguessr"] .ga-drilldown-close {
      border-radius: 999px;
      width: 34px;
      height: 34px;
      background: rgba(16, 16, 28, 0.45);
      border-color: rgba(255,255,255,0.16);
      box-shadow: 0 10px 24px rgba(0,0,0,0.32);
    }
    .ga-root[data-ga-theme="geoguessr"] .ga-drilldown-close:hover {
      filter: brightness(1.06);
      transform: translateY(-1px);
    }
    .ga-root[data-ga-theme="geoguessr"] .ga-drilldown-table thead th {
      background: rgba(16,16,28,0.42);
      border-bottom-color: rgba(255,255,255,0.10);
      color: rgba(243,244,255,0.72);
    }
    .ga-root[data-ga-theme="geoguessr"] .ga-drilldown-table th,
    .ga-root[data-ga-theme="geoguessr"] .ga-drilldown-table td {
      border-bottom-color: rgba(255,255,255,0.08);
    }
    .ga-root[data-ga-theme="geoguessr"] .ga-dd-tr:hover td {
      background: rgba(121, 80, 229, 0.10);
    }
    .ga-root[data-ga-theme="geoguessr"] .ga-dd-th.ga-dd-sortable:hover {
      background: rgba(58, 232, 189, 0.08);
    }
    .ga-card-header { padding:10px 12px; border-bottom:1px solid var(--ga-border); font-weight:650; }
    .ga-card-body { padding:12px; }
    .ga-card-inner, .ga-child, .ga-widget { min-width: 0; width: 100%; }
    .ga-widget-title { font-size:12px; color: var(--ga-text-muted); margin-bottom:6px; }
    .ga-statlist-box {
      background: var(--ga-card-2);
      border:1px solid var(--ga-border);
      border-radius:12px;
      padding:10px;
    }
    .ga-recordlist-box {
      background: var(--ga-card-2);
      border:1px solid var(--ga-border);
      border-radius:12px;
      padding:10px;
    }
    .ga-statrow {
      display:flex;
      justify-content:space-between;
      padding:6px 2px;
      border-bottom:1px dashed color-mix(in srgb, var(--ga-text) 12%, transparent);
    }
    .ga-statrow:last-child { border-bottom:none; }
    .ga-chart-box {
      background: var(--ga-card-2);
      border:1px solid var(--ga-border);
      border-radius:12px;
      padding:10px;
      color: var(--ga-text);
      width: 100%;
      overflow: visible;
    }
    .ga-chart-controls { display:flex; gap:8px; align-items:center; margin-bottom:8px; justify-content:space-between; flex-wrap:wrap; }
    .ga-chart-controls-left { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    .ga-chart-actions { display:flex; gap:8px; align-items:center; }
    .ga-chart-actions button {
      background: var(--ga-control-bg);
      border:1px solid var(--ga-control-border);
      color: var(--ga-control-text);
      border-radius:8px;
      padding:4px 8px;
      cursor:pointer;
      font-size:12px;
    }
    .ga-chart-host { width:100%; }
    .ga-chart-svg { width:100%; max-width:100%; display:block; }
    .ga-chart-bar { transform-box: view-box; }
    .ga-chart-svg[data-anim-state="pending"] .ga-chart-bar {
      transform: scaleY(0);
      opacity: 0.25;
    }
    .ga-chart-svg[data-anim-state="pending"] .ga-chart-line-path {
      stroke-dashoffset: var(--ga-line-length);
      opacity: 0.65;
    }
    .ga-chart-svg[data-anim-state="pending"] .ga-chart-line-dot {
      transform: scale(0);
      opacity: 0;
      transform-box: fill-box;
      transform-origin: center;
    }
    .ga-root[data-ga-chart-animations="off"] .ga-chart-svg .ga-chart-bar {
      transform: none !important;
      opacity: 0.72 !important;
      animation: none !important;
    }
    .ga-root[data-ga-chart-animations="off"] .ga-chart-svg .ga-chart-line-path {
      stroke-dasharray: none !important;
      stroke-dashoffset: 0 !important;
      animation: none !important;
      opacity: 0.9 !important;
    }
    .ga-root[data-ga-chart-animations="off"] .ga-chart-svg .ga-chart-line-dot {
      transform: none !important;
      animation: none !important;
      opacity: 0.95 !important;
    }
    @keyframes ga-bar-rise {
      from { transform: scaleY(0); opacity: 0.25; }
      to { transform: scaleY(1); opacity: 0.72; }
    }
    @keyframes ga-line-draw {
      from { stroke-dashoffset: var(--ga-line-length); opacity: 0.65; }
      to { stroke-dashoffset: 0; opacity: 0.9; }
    }
    @keyframes ga-dot-in {
      from { transform: scale(0); opacity: 0; }
      to { transform: scale(1); opacity: 0.95; }
    }
    .ga-chart-svg[data-anim-state="run"] .ga-chart-bar {
      animation: ga-bar-rise 420ms ease-out both;
    }
    .ga-chart-svg[data-anim-state="run"] .ga-chart-line-path {
      animation: ga-line-draw 520ms ease-out both;
    }
    .ga-chart-svg[data-anim-state="run"] .ga-chart-line-dot {
      animation: ga-dot-in 220ms ease-out both;
      animation-delay: calc(min(var(--ga-dot-index, 0) * 60ms, 520ms));
    }
    .ga-breakdown-box {
      display:flex;
      flex-direction:column;
      gap:8px;
      background: var(--ga-card-2);
      border:1px solid var(--ga-border);
      border-radius:12px;
      padding:10px;
    }
    .ga-breakdown-header {
      display:flex;
      justify-content:space-between;
      gap:10px;
      align-items:flex-end;
      margin: 2px 0 8px 0;
      font-size: 11px;
      letter-spacing: 0.15px;
      color: color-mix(in srgb, var(--ga-text) 78%, transparent);
    }
    .ga-breakdown-header-left { max-width:40%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight: 650; }
    .ga-breakdown-header-right { flex:1; text-align:right; font-weight: 650; }
    .ga-breakdown-controls { display:flex; justify-content:flex-end; gap:8px; align-items:center; flex-wrap:wrap; }
    .ga-breakdown-ctl-label { opacity: 0.9; font-weight: 650; }
    .ga-breakdown-ctl-select {
      background: var(--ga-control-bg);
      color: var(--ga-control-text);
      border:1px solid var(--ga-control-border);
      border-radius:8px;
      padding:3px 8px;
      font-size:12px;
      max-width: min(360px, 62vw);
    }
    .ga-breakdown-row { display:flex; justify-content:space-between; gap:10px; align-items:center; }
    .ga-breakdown-label { max-width:40%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ga-breakdown-right { flex:1; display:flex; align-items:center; gap:10px; }
    .ga-breakdown-value { min-width:72px; text-align:right; font-variant-numeric: tabular-nums; }
    .ga-breakdown-barwrap { flex:1; height:8px; background: color-mix(in srgb, var(--ga-text) 14%, transparent); border-radius:999px; overflow:hidden; }
    .ga-breakdown-bar { height:100%; background: var(--ga-graph-color); border-radius:999px; }
    .ga-breakdown-footer { display:flex; justify-content:flex-end; margin-top: 10px; }
    .ga-breakdown-toggle {
      background: var(--ga-control-bg);
      border:1px solid var(--ga-control-border);
      color: var(--ga-control-text);
      border-radius:8px;
      padding:4px 8px;
      cursor:pointer;
      font-size:12px;
    }
    .ga-breakdown-toggle:hover { filter: brightness(1.02); }
    .ga-drilldown-modal, .ga-settings-modal { position:fixed; inset:0; z-index:9999999; }
    .ga-drilldown-bg, .ga-settings-bg { position:absolute; inset:0; background: var(--ga-overlay-bg); }
    .ga-drilldown-panel {
      position:absolute;
      top:6%;
      left:50%;
      transform:translateX(-50%);
      width:min(1100px, 92vw);
      max-height:88vh;
      overflow:auto;
      background:var(--ga-surface);
      border:1px solid var(--ga-border);
      border-radius:14px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.35);
      color: var(--ga-text);
    }
    .ga-drilldown-header {
      position: sticky;
      top: 0;
      z-index: 5;
      display:flex;
      justify-content:space-between;
      align-items:center;
      padding:10px 12px;
      border-bottom:1px solid var(--ga-border);
      background: var(--ga-surface);
      backdrop-filter: blur(8px);
    }
    .ga-drilldown-title {
      font-size: 13px;
      font-weight: 650;
      letter-spacing: 0.2px;
    }
    .ga-drilldown-close {
      background: var(--ga-control-bg);
      border:1px solid var(--ga-control-border);
      color: var(--ga-control-text);
      border-radius:10px;
      width: 30px;
      height: 30px;
      padding:0;
      cursor:pointer;
    }
    .ga-drilldown-table { width:100%; border-collapse:separate; border-spacing:0; font-size:12px; }
    .ga-drilldown-table th, .ga-drilldown-table td {
      padding:8px 10px;
      border-bottom:1px solid color-mix(in srgb, var(--ga-text) 10%, transparent);
      text-align:left;
    }
    .ga-drilldown-table td { color: var(--ga-text); }
    .ga-drilldown-table thead th {
      position: sticky;
      top: 52px;
      z-index: 4;
      background: color-mix(in srgb, var(--ga-surface) 92%, transparent);
      border-bottom: 1px solid color-mix(in srgb, var(--ga-text) 14%, transparent);
      font-weight: 600;
      color: color-mix(in srgb, var(--ga-text) 85%, transparent);
    }
    .ga-dd-th.ga-dd-sortable { cursor: pointer; user-select: none; }
    .ga-dd-th.ga-dd-sortable:hover { background: color-mix(in srgb, var(--ga-text) 6%, transparent); }
    .ga-dd-tr:hover td { background: color-mix(in srgb, var(--ga-text) 5%, transparent); }
    .ga-dd-tr.ga-dd-no-sep td { border-bottom-color: transparent; }
    .ga-dd-link {
      color: var(--ga-link);
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .ga-dd-pos { color: var(--ga-good); font-variant-numeric: tabular-nums; }
    .ga-dd-neg { color: var(--ga-danger); font-variant-numeric: tabular-nums; }
    .ga-settings-panel {
      position:absolute;
      top:8%;
      left:50%;
      transform:translateX(-50%);
      width:min(980px, 94vw);
      max-height:84vh;
      overflow:auto;
      background: var(--ga-surface);
      border:1px solid var(--ga-border);
      border-radius:14px;
    }
    .ga-settings-header {
      display:flex;
      justify-content:space-between;
      align-items:center;
      padding:10px 12px;
      border-bottom:1px solid var(--ga-border);
    }
    .ga-settings-body { padding: 12px; }
    .ga-settings-tabs { display:flex; gap:8px; margin-bottom:12px; }
    .ga-settings-tab {
      background: var(--ga-control-bg);
      color: var(--ga-control-text);
      border:1px solid var(--ga-control-border);
      border-radius:8px;
      padding:6px 10px;
      cursor:pointer;
    }
    .ga-settings-tab.active { background: var(--ga-surface-2); }
    .ga-settings-pane { display:none; }
    .ga-settings-pane.active { display:block; }
    .ga-settings-grid { display:grid; gap:12px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
    .ga-settings-field { display:flex; flex-direction:column; gap:6px; }
    .ga-settings-field label { font-size:12px; color: var(--ga-text-muted); }
    .ga-settings-field input, .ga-settings-field select, .ga-settings-field textarea {
      background: var(--ga-control-bg);
      color: var(--ga-control-text);
      border:1px solid var(--ga-control-border);
      border-radius:8px;
      padding:8px;
      font: inherit;
    }
    .ga-settings-field textarea {
      min-height: 340px;
      resize: vertical;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
      line-height: 1.4;
      white-space: pre;
    }
    .ga-settings-note { font-size:12px; color: var(--ga-text-muted); }
    .ga-settings-status { margin-top: 8px; font-size:12px; }
    .ga-settings-status.error { color: #ff8f8f; }
    .ga-settings-status.ok { color: #8fe3a1; }
  `;
  doc.head.appendChild(style);
}
