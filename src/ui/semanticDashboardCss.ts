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
      --ga-topbar-h: 0px;
      --ga-filters-h: 0px;
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
      --ga-map-border: rgba(255,255,255,0.10);
      --ga-map-toolbar-bg: rgba(20,20,32,0.78);
      --ga-map-toolbar-border: rgba(255,255,255,0.16);
      --ga-map-hint: rgba(243,244,255,0.66);
      --ga-map-fill: rgba(255,255,255,0.03);
      --ga-map-stroke: rgba(255,255,255,0.16);
      --ga-map-selectable-fill: rgba(0, 162, 254, 0.11);
      --ga-map-selectable-hover: rgba(0, 162, 254, 0.20);
      --ga-map-disabled-fill: rgba(255,255,255,0.02);
      --ga-map-disabled-stroke: rgba(255,255,255,0.08);
      --ga-map-active-fill: rgba(254,205,25,0.40);
      --ga-map-active-stroke: rgba(254,205,25,0.72);
      --ga-map-bg:
        radial-gradient(520px 260px at 20% 0%, rgba(121, 80, 229, 0.16), transparent 60%),
        radial-gradient(520px 260px at 90% 0%, rgba(0, 162, 254, 0.12), transparent 62%),
        rgba(22,22,38,0.60);
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
      --ga-map-border: rgba(0,0,0,0.12);
      --ga-map-toolbar-bg: rgba(255,255,255,0.86);
      --ga-map-toolbar-border: rgba(0,0,0,0.12);
      --ga-map-hint: rgba(31,42,56,0.68);
      --ga-map-fill: rgba(31,42,56,0.05);
      --ga-map-stroke: rgba(31,42,56,0.18);
      --ga-map-selectable-fill: rgba(0, 162, 254, 0.16);
      --ga-map-selectable-hover: rgba(0, 162, 254, 0.24);
      --ga-map-disabled-fill: rgba(31,42,56,0.03);
      --ga-map-disabled-stroke: rgba(31,42,56,0.10);
      --ga-map-active-fill: rgba(121, 80, 229, 0.34);
      --ga-map-active-stroke: rgba(121, 80, 229, 0.74);
      --ga-map-bg:
        radial-gradient(520px 260px at 20% 0%, rgba(121, 80, 229, 0.10), transparent 60%),
        radial-gradient(520px 260px at 90% 0%, rgba(0, 162, 254, 0.10), transparent 62%),
        rgba(255,255,255,0.92);
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
    .ga-title { font-weight: 700; display:flex; align-items:center; gap:10px; }
    .ga-title-logo svg { display:block; filter: drop-shadow(0 0 14px rgba(0,162,254,0.28)); }
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

    .ga-filters-host {
      position: sticky;
      top: var(--ga-topbar-h);
      z-index: 9;
      background: var(--ga-bg);
    }
    .ga-root[data-ga-theme="geoguessr"] .ga-filters-host {
      background: linear-gradient(180deg, rgba(16, 16, 28, 0.68) 0%, rgba(16, 16, 28, 0.28) 100%);
      backdrop-filter: blur(14px);
    }
    .ga-filters {
      display:flex;
      justify-content:space-between;
      gap:10px;
      padding:10px 10px 6px;
      flex-wrap:wrap;
    }
    .ga-filters-left { display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end; flex: 1 1 auto; min-width: 0; }
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

    .ga-filter.ga-filter-map { min-width: 340px; }
    .ga-filter.ga-filter-map.ga-filter-map-wide { flex: 1 1 100%; width: 100%; min-width: 520px; }
    .ga-filter-map-selected {
      font-size: 12px;
      color: var(--ga-text-muted);
      margin-bottom: 2px;
    }
    .ga-filter-map-host { width: 340px; max-width: 100%; }
    .ga-filter.ga-filter-map.ga-filter-map-wide .ga-filter-map-host { width: 100%; }
    .ga-country-map {
      height: var(--ga-country-map-h, 240px);
      width: 100%;
      border-radius: 14px;
      overflow: hidden;
      border: 1px solid var(--ga-map-border);
      background: var(--ga-map-bg);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
    }
    /* Wide map: keep correct world aspect by default; cap via dashboard.json map.height (max-height). */
    .ga-filter.ga-filter-map.ga-filter-map-wide .ga-country-map {
      height: auto;
      aspect-ratio: 2 / 1;
      max-height: var(--ga-country-map-h, 720px);
      min-height: 320px;
    }
    .ga-country-map-wrap { width: 100%; height: 100%; display:flex; flex-direction:column; gap:6px; padding:8px; box-sizing:border-box; }
    .ga-country-map-toolbar { display:flex; gap:8px; align-items:center; }
    .ga-country-map-btn {
      width: 30px;
      height: 30px;
      border-radius: 10px;
      border: 1px solid var(--ga-map-toolbar-border);
      background: var(--ga-map-toolbar-bg);
      color: var(--ga-control-text);
      cursor: pointer;
      font-weight: 800;
      line-height: 1;
    }
    .ga-country-map-btn:hover { background: color-mix(in srgb, var(--ga-map-toolbar-bg) 78%, #000); }
    .ga-country-map-hint { font-size: 11px; color: var(--ga-map-hint); }
    .ga-country-map-svg { width: 100%; flex: 1; border-radius: 10px; overflow: hidden; touch-action: none; display:block; }
    .ga-country-shape {
      fill: var(--ga-map-fill);
      stroke: var(--ga-map-stroke);
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
      cursor: grab;
      transition: fill 120ms ease, stroke 120ms ease;
    }
    .ga-country-shape.selectable { fill: var(--ga-map-selectable-fill); stroke: var(--ga-map-stroke); cursor: pointer; }
    .ga-country-shape.disabled { fill: var(--ga-map-disabled-fill); stroke: var(--ga-map-disabled-stroke); opacity: 0.45; pointer-events: none; }
    .ga-country-shape.selectable.hover { fill: var(--ga-map-selectable-hover); }
    .ga-country-shape.active {
      fill: var(--ga-map-active-fill);
      stroke: var(--ga-map-active-stroke);
      stroke-width: 2;
    }
    .ga-filter-map-error { font-size: 12px; color: rgba(255,143,143,0.95); }
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
    .ga-tabs {
      display:flex;
      gap:8px;
      padding:10px;
      position: sticky;
      top: calc(var(--ga-topbar-h) + var(--ga-filters-h));
      z-index: 8;
      background: var(--ga-bg);
    }
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

    .ga-team-local-filters, .ga-country-local-filters {
      display:flex;
      gap:10px;
      flex-wrap:wrap;
      align-items:flex-end;
      margin: 6px 0 10px;
    }
    .ga-team-local-filters .ga-filter, .ga-country-local-filters .ga-filter { min-width: 240px; }
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
      overflow: hidden;
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
    .ga-chart-svg { width:100%; max-width:100%; display:block; overflow: visible; }
    .ga-chart-bar { transform-box: view-box; }

    /* Hover emphasis (only when animations are enabled). */
    .ga-root[data-ga-chart-animations="on"] .ga-chart-svg .ga-chart-bar,
    .ga-root[data-ga-chart-animations="on"] .ga-chart-svg .ga-chart-line-dot {
      transition: opacity 140ms ease, filter 140ms ease, stroke-width 140ms ease;
    }
    .ga-root[data-ga-chart-animations="on"] .ga-chart-svg .ga-chart-bar:hover {
      opacity: 0.95;
      filter: brightness(1.18);
      stroke: rgba(255,255,255,0.55);
      stroke-width: 1.25px;
    }
    .ga-root[data-ga-chart-animations="on"] .ga-chart-svg .ga-chart-line-dot:hover {
      opacity: 1;
      filter: brightness(1.25);
      stroke: rgba(255,255,255,0.70);
      stroke-width: 2px;
      paint-order: stroke fill;
    }
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
    .ga-breakdown-header-left {
      flex: 0 0 var(--ga-breakdown-label-w);
      max-width: var(--ga-breakdown-label-w);
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap;
      font-weight: 650;
    }
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
    .ga-breakdown { --ga-breakdown-label-w: clamp(120px, 20%, 260px); }
    .ga-breakdown-row { display:flex; gap:8px; align-items:center; justify-content:flex-start; }
    .ga-breakdown-label {
      flex: 0 0 var(--ga-breakdown-label-w);
      max-width: var(--ga-breakdown-label-w);
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap;
    }
    .ga-breakdown-right { flex:1; min-width:0; display:flex; align-items:center; gap:10px; }
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
      top:6%;
      left:50%;
      transform:translateX(-50%);
      width:min(1260px, 96vw);
      max-height:90vh;
      overflow:auto;
      background: var(--ga-surface);
      border:1px solid var(--ga-border);
      border-radius:14px;
      box-shadow: 0 28px 90px rgba(0,0,0,0.55);
    }
    .ga-settings-header {
      display:flex;
      justify-content:space-between;
      align-items:center;
      padding:10px 12px;
      border-bottom:1px solid var(--ga-border);
    }
    .ga-settings-body { padding: 14px; }
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
    .ga-settings-actions { display:flex; gap:8px; margin-top: 8px; flex-wrap:wrap; }

    /* Layout editor (Settings -> Layout) */
    .ga-layout-editor-wrap { display:flex; flex-direction:column; gap:10px; }
    .ga-le-head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap; }
    .ga-le-head-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .ga-le-toggle { display:flex; align-items:center; gap:8px; font-size:12px; color: var(--ga-text-muted); user-select:none; }
    .ga-le-toggle input { width: 16px; height: 16px; }
    .ga-le-head {
      position: sticky;
      top: 0;
      z-index: 5;
      padding: 10px 0;
      background: color-mix(in srgb, var(--ga-surface) 92%, transparent);
      backdrop-filter: blur(10px);
      border-bottom: 1px solid color-mix(in srgb, var(--ga-border) 70%, transparent);
    }
    .ga-layout-editor { display:block; padding-top: 10px; }
    .ga-le-left, .ga-le-right { min-width: 0; }
    .ga-le-left-head { display:flex; gap:8px; margin-bottom:10px; }
    .ga-le-list { display:flex; flex-direction:column; gap:6px; }
    .ga-le-list-item {
      background: var(--ga-control-bg);
      border: 1px solid var(--ga-control-border);
      color: var(--ga-control-text);
      border-radius: 10px;
      padding: 8px 10px;
      cursor: pointer;
      text-align: left;
      font-weight: 650;
      opacity: 0.9;
    }
    .ga-le-list-item.active { background: var(--ga-surface-2); opacity: 1; }
    .ga-le-toprow { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:10px; }
    .ga-le-btn {
      background: var(--ga-control-bg);
      border: 1px solid var(--ga-control-border);
      color: var(--ga-control-text);
      border-radius: 10px;
      padding: 6px 10px;
      cursor: pointer;
      font-size: 12px;
      height: 32px;
    }
    .ga-le-btn-icon {
      width: 32px;
      min-width: 32px;
      padding: 0;
      display:inline-flex;
      align-items:center;
      justify-content:center;
      font-size: 13px;
      line-height: 1;
    }
    .ga-le-btn-primary { border-color: color-mix(in srgb, var(--ga-accent2) 55%, var(--ga-control-border)); }
    .ga-le-btn-danger { border-color: color-mix(in srgb, var(--ga-danger) 60%, var(--ga-control-border)); }
    .ga-le-field { display:flex; flex-direction:column; gap:6px; margin-bottom:10px; }
    .ga-le-field label { font-size:12px; color: var(--ga-text-muted); }
    .ga-le-inputhost { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    .ga-le-field input, .ga-le-field select, .ga-le-inline-select {
      background: var(--ga-control-bg);
      color: var(--ga-control-text);
      border:1px solid var(--ga-control-border);
      border-radius:8px;
      padding:7px 8px;
      font: inherit;
      font-size: 12px;
      min-width: 220px;
    }
    .ga-le-field textarea {
      background: var(--ga-control-bg);
      color: var(--ga-control-text);
      border:1px solid var(--ga-control-border);
      border-radius:8px;
      padding:8px;
      font: inherit;
      font-size: 12px;
      min-height: 200px;
      resize: vertical;
      width: 100%;
      box-sizing: border-box;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      white-space: pre;
      line-height: 1.35;
    }
    .ga-le-field select[multiple] { min-width: 260px; padding: 6px; }
    .ga-le-hr { border:0; height:1px; background: var(--ga-border); margin: 12px 0; opacity: 0.9; }
    .ga-le-box { background: var(--ga-card-2); border:1px solid var(--ga-border); border-radius:12px; padding:10px; margin-bottom:10px; }
    .ga-le-box-head { font-weight: 750; font-size: 12px; color: var(--ga-text); margin-bottom: 8px; }
    .ga-le-item { background: color-mix(in srgb, var(--ga-card) 65%, transparent); border:1px solid var(--ga-border); border-radius:12px; padding:10px; margin-top:10px; }
    .ga-le-compact-row {
      display:flex;
      gap:10px;
      align-items:center;
      justify-content:space-between;
      background: color-mix(in srgb, var(--ga-card) 65%, transparent);
      border:1px solid var(--ga-border);
      border-radius:12px;
      padding:8px 10px;
      margin-top:8px;
    }
    .ga-le-compact-row.dragover { outline: 2px solid color-mix(in srgb, var(--ga-accent2) 55%, transparent); }
    .ga-le-drag {
      width: 18px;
      min-width: 18px;
      opacity: 0.8;
      cursor: grab;
      user-select:none;
      text-align:center;
      font-weight: 900;
      letter-spacing: -1px;
    }
    .ga-le-compact-title { font-weight: 750; font-size: 12px; color: var(--ga-text); flex: 1 1 auto; min-width: 0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ga-le-compact-meta { font-size: 11px; color: var(--ga-text-muted); opacity: 0.9; flex: 0 0 auto; }
    .ga-le-compact-actions { display:flex; gap:8px; align-items:center; flex: 0 0 auto; }
    .ga-le-compact-row-col { justify-content:flex-start; }
    .ga-le-col-key { min-width: 160px; width: 160px; }
    .ga-le-col-label { min-width: 220px; width: min(420px, 42vw); }
    .ga-le-compact-chk { display:flex; align-items:center; gap:6px; font-size:11px; color: var(--ga-text-muted); user-select:none; }
    .ga-le-compact-chk input { width: 14px; height: 14px; }
    .ga-le-grid4 { display:grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap:10px; }
    @media (max-width: 820px) { .ga-le-grid4 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    .ga-le-subbox { background: color-mix(in srgb, var(--ga-card) 55%, transparent); border:1px solid var(--ga-border); border-radius:12px; padding:10px; margin-top:10px; }
    .ga-le-subhead { font-weight: 700; font-size: 12px; color: var(--ga-text-muted); margin-bottom: 8px; }
    .ga-le-widget { background: color-mix(in srgb, var(--ga-card-2) 65%, transparent); border:1px dashed var(--ga-border); border-radius:12px; padding:10px; margin-top:10px; }
    .ga-le-details { border:1px solid var(--ga-border); border-radius:12px; padding:0; margin-top:10px; background: color-mix(in srgb, var(--ga-card-2) 60%, transparent); }
    .ga-le-details > summary {
      cursor:pointer;
      padding:10px 12px;
      font-weight: 750;
      font-size: 12px;
      color: var(--ga-text);
      user-select:none;
      list-style: none;
    }
    .ga-le-details[open] > summary { border-bottom: 1px solid var(--ga-border); }
    .ga-le-details > summary::-webkit-details-marker { display:none; }
    .ga-le-details > .ga-le-item { margin-top: 0; border: 0; border-top-left-radius: 0; border-top-right-radius: 0; background: transparent; }
    .ga-le-adv { margin-top: 10px; }
    .ga-le-adv > summary { cursor:pointer; user-select:none; font-weight: 700; font-size:12px; color: var(--ga-text-muted); list-style:none; }
    .ga-le-adv > summary::-webkit-details-marker { display:none; }
    .ga-le-panels { display:flex; flex-direction:column; gap:12px; }
    .ga-le-inline-input {
      background: var(--ga-control-bg);
      color: var(--ga-control-text);
      border:1px solid var(--ga-control-border);
      border-radius:8px;
      padding:7px 8px;
      font: inherit;
      font-size: 12px;
      min-width: 220px;
      height: 32px;
    }

    /* Section editor modal */
    .ga-le-modal { position: fixed; inset: 0; z-index: 99999999; }
    .ga-le-modal-bg { position:absolute; inset:0; background: var(--ga-overlay-bg); }
    .ga-le-modal-panel {
      position:absolute;
      top: 6%;
      left: 50%;
      transform: translateX(-50%);
      width: min(1200px, 96vw);
      max-height: 88vh;
      overflow: auto;
      background: var(--ga-surface);
      border: 1px solid var(--ga-border);
      border-radius: 14px;
      box-shadow: 0 28px 90px rgba(0,0,0,0.55);
      color: var(--ga-text);
    }
    .ga-le-modal-header {
      position: sticky;
      top: 0;
      z-index: 5;
      display:flex;
      align-items:center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--ga-border);
      background: color-mix(in srgb, var(--ga-surface) 92%, transparent);
      backdrop-filter: blur(10px);
    }
    .ga-le-modal-title { font-size: 13px; font-weight: 700; letter-spacing: 0.2px; }
    .ga-le-modal-body { padding: 12px; }
    .ga-le-cards-layout { display:grid; grid-template-columns: minmax(220px, 320px) 1fr; gap:12px; align-items:start; }
    @media (max-width: 980px) { .ga-le-cards-layout { grid-template-columns: 1fr; } }
    .ga-le-outline {
      position: sticky;
      top: 86px;
      background: color-mix(in srgb, var(--ga-card) 55%, transparent);
      border:1px solid var(--ga-border);
      border-radius:12px;
      padding:10px;
    }
    .ga-le-outline-head { font-weight: 800; font-size: 12px; color: var(--ga-text); margin-bottom: 6px; }
    .ga-le-outline-search {
      width: 100%;
      min-width: 0;
      box-sizing: border-box;
      background: var(--ga-control-bg);
      color: var(--ga-control-text);
      border:1px solid var(--ga-control-border);
      border-radius:8px;
      padding:7px 8px;
      font: inherit;
      font-size: 12px;
      margin-top: 6px;
    }
    .ga-le-outline-list { display:flex; flex-direction:column; gap:6px; margin-top:10px; max-height: 62vh; overflow:auto; padding-right: 4px; }
    .ga-le-outline-item {
      background: var(--ga-control-bg);
      border: 1px solid var(--ga-control-border);
      color: var(--ga-control-text);
      border-radius: 10px;
      padding: 7px 10px;
      cursor: pointer;
      text-align: left;
      font-weight: 650;
      opacity: 0.95;
      font-size: 12px;
    }
    .ga-le-outline-item:hover { filter: brightness(1.03); }
    .ga-le-outline-item.active { background: var(--ga-surface-2); border-color: color-mix(in srgb, var(--ga-accent2) 55%, var(--ga-control-border)); }
    .ga-le-outline-item-widget { padding-left: 18px; font-weight: 600; opacity: 0.9; }
    .ga-le-flash { outline: 2px solid color-mix(in srgb, var(--ga-accent2) 70%, transparent); outline-offset: 2px; }
  `;
  doc.head.appendChild(style);
}
