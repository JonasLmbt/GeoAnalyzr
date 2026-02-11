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
      min-height: 100vh;
      background: var(--ga-bg);
      color: var(--ga-text);
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
    .ga-body { padding: 8px 12px 16px; }
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
    .ga-card-header { padding:10px 12px; border-bottom:1px solid var(--ga-border); font-weight:650; }
    .ga-card-body { padding:12px; }
    .ga-widget-title { font-size:12px; color: var(--ga-text-muted); margin-bottom:6px; }
    .ga-statlist-box {
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
    }
    .ga-breakdown-box { display:flex; flex-direction:column; gap:8px; }
    .ga-breakdown-row { display:flex; justify-content:space-between; gap:10px; align-items:center; }
    .ga-breakdown-label { max-width:40%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ga-breakdown-right { flex:1; display:flex; align-items:center; gap:10px; }
    .ga-breakdown-value { min-width:72px; text-align:right; font-variant-numeric: tabular-nums; }
    .ga-breakdown-barwrap { flex:1; height:8px; background: color-mix(in srgb, var(--ga-text) 14%, transparent); border-radius:999px; overflow:hidden; }
    .ga-breakdown-bar { height:100%; background: var(--ga-graph-color); border-radius:999px; }
    .ga-drilldown-modal, .ga-settings-modal { position:fixed; inset:0; z-index:9999999; }
    .ga-drilldown-bg, .ga-settings-bg { position:absolute; inset:0; background:rgba(0,0,0,0.6); }
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
    }
    .ga-drilldown-header { display:flex; justify-content:space-between; align-items:center; padding:10px 12px; border-bottom:1px solid var(--ga-border); }
    .ga-drilldown-close {
      background: var(--ga-control-bg);
      border:1px solid var(--ga-control-border);
      color: var(--ga-control-text);
      border-radius:10px;
      padding:6px 10px;
      cursor:pointer;
    }
    .ga-drilldown-table { width:100%; border-collapse:collapse; font-size:12px; }
    .ga-drilldown-table th, .ga-drilldown-table td {
      padding:8px 10px;
      border-bottom:1px solid color-mix(in srgb, var(--ga-text) 10%, transparent);
      text-align:left;
    }
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
