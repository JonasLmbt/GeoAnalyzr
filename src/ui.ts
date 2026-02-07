import { AnalysisChart, AnalysisSection } from "./analysis";

export interface UIHandle {
  setVisible: (visible: boolean) => void;
  setStatus: (msg: string) => void;
  setCounts: (counts: {
    games: number;
    rounds: number;
    detailsOk: number;
    detailsError: number;
    detailsMissing: number;
  }) => void;
  setAnalysisWindowData: (data: AnalysisWindowData) => void;
  onUpdateClick: (fn: () => void) => void;
  onResetClick: (fn: () => void) => void;
  onExportClick: (fn: () => void) => void;
  onTokenClick: (fn: () => void) => void;
  onOpenAnalysisClick: (fn: () => void) => void;
  onRefreshAnalysisClick: (fn: (filter: { fromTs?: number; toTs?: number; mode?: string; teammateId?: string; country?: string }) => void) => void;
}

export interface AnalysisWindowData {
  sections: AnalysisSection[];
  availableModes: string[];
  availableTeammates: Array<{ id: string; label: string }>;
  availableCountries: Array<{ code: string; label: string }>;
  minPlayedAt?: number;
  maxPlayedAt?: number;
}

function isoDateLocal(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateInput(v: string, endOfDay = false): number | undefined {
  if (!v) return undefined;
  const d = new Date(`${v}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  const t = d.getTime();
  return Number.isFinite(t) ? t : undefined;
}

function sanitizeFileName(input: string): string {
  return input.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/\s+/g, "_").slice(0, 80);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

async function downloadSvg(svg: SVGSVGElement, title: string): Promise<void> {
  const svgText = svg.outerHTML;
  const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  triggerDownload(blob, `${sanitizeFileName(title)}.svg`);
}

async function downloadPng(svg: SVGSVGElement, title: string): Promise<void> {
  const svgText = svg.outerHTML;
  const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("SVG image load failed"));
      img.src = svgUrl;
    });

    const width = Math.max(1200, img.width || 1200);
    const height = Math.max(420, img.height || 420);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context not available");
    ctx.fillStyle = "#101010";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("PNG conversion failed");
    triggerDownload(blob, `${sanitizeFileName(title)}.png`);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function openChartInNewTab(svg: SVGSVGElement, title: string, hostWindow: Window = window): void {
  const win = hostWindow.open("", "_blank");
  if (!win) return;
  const svgMarkup = svg.outerHTML;
  const safeTitle = title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  win.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${safeTitle}</title>
    <style>
      body { margin: 0; background: #101010; color: #fff; font-family: system-ui, sans-serif; }
      .wrap { padding: 20px; }
      h1 { margin: 0 0 14px; font-size: 18px; }
      .chart { border: 1px solid #2a2a2a; border-radius: 10px; padding: 8px; background: #141414; }
      svg { width: 100%; height: auto; min-height: 420px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>${safeTitle}</h1>
      <div class="chart">${svgMarkup}</div>
    </div>
  </body>
</html>`);
  win.document.close();
}

function openZoomOverlay(svg: SVGSVGElement, title: string): void {
  const doc = svg.ownerDocument;
  const hostWindow = doc.defaultView ?? window;
  const overlay = doc.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,0.82)";
  overlay.style.zIndex = "1000005";
  overlay.style.display = "grid";
  overlay.style.placeItems = "center";
  overlay.style.padding = "20px";

  const card = doc.createElement("div");
  card.style.width = "min(1500px, 96vw)";
  card.style.maxHeight = "92vh";
  card.style.overflow = "auto";
  card.style.background = "#111";
  card.style.border = "1px solid #2a2a2a";
  card.style.borderRadius = "12px";
  card.style.padding = "12px";

  const header = doc.createElement("div");
  header.style.display = "flex";
  header.style.justifyContent = "space-between";
  header.style.alignItems = "center";
  header.style.marginBottom = "8px";
  header.innerHTML = `<div style="font-size:14px;font-weight:700;color:#fff">${title}</div>`;
  const closeBtn = doc.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.style.background = "#303030";
  closeBtn.style.color = "#fff";
  closeBtn.style.border = "1px solid #444";
  closeBtn.style.borderRadius = "6px";
  closeBtn.style.padding = "4px 8px";
  closeBtn.style.cursor = "pointer";
  header.appendChild(closeBtn);

  const svgClone = svg.cloneNode(true) as SVGSVGElement;
  svgClone.setAttribute("width", "100%");
  svgClone.setAttribute("height", "640");

  const chartWrap = doc.createElement("div");
  chartWrap.style.border = "1px solid #2a2a2a";
  chartWrap.style.borderRadius = "10px";
  chartWrap.style.background = "#121212";
  chartWrap.style.padding = "8px";
  chartWrap.appendChild(svgClone);

  const actions = doc.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "8px";
  actions.style.marginBottom = "10px";

  function mkAction(label: string, onClick: () => void): HTMLButtonElement {
    const b = doc.createElement("button");
    b.textContent = label;
    b.style.background = "#214a78";
    b.style.color = "white";
    b.style.border = "1px solid #2f6096";
    b.style.borderRadius = "6px";
    b.style.padding = "5px 9px";
    b.style.cursor = "pointer";
    b.addEventListener("click", onClick);
    return b;
  }

  actions.appendChild(mkAction("New Tab", () => openChartInNewTab(svgClone, title, hostWindow)));
  actions.appendChild(mkAction("Save SVG", () => void downloadSvg(svgClone, title)));
  actions.appendChild(mkAction("Save PNG", () => void downloadPng(svgClone, title)));

  closeBtn.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) overlay.remove();
  });

  card.appendChild(header);
  card.appendChild(actions);
  card.appendChild(chartWrap);
  overlay.appendChild(card);
  doc.body.appendChild(overlay);
}

function createChartActions(svg: SVGSVGElement, title: string): HTMLElement {
  const doc = svg.ownerDocument;
  const hostWindow = doc.defaultView ?? window;
  const row = doc.createElement("div");
  row.style.display = "flex";
  row.style.justifyContent = "flex-end";
  row.style.gap = "6px";
  row.style.marginBottom = "6px";

  function mkBtn(label: string, onClick: () => void): HTMLButtonElement {
    const b = doc.createElement("button");
    b.textContent = label;
    b.style.background = "#303030";
    b.style.color = "#fff";
    b.style.border = "1px solid #444";
    b.style.borderRadius = "6px";
    b.style.padding = "3px 7px";
    b.style.fontSize = "11px";
    b.style.cursor = "pointer";
    b.addEventListener("click", onClick);
    return b;
  }

  row.appendChild(mkBtn("Zoom", () => openZoomOverlay(svg, title)));
  row.appendChild(mkBtn("New Tab", () => openChartInNewTab(svg, title, hostWindow)));
  row.appendChild(mkBtn("Save SVG", () => void downloadSvg(svg, title)));
  row.appendChild(mkBtn("Save PNG", () => void downloadPng(svg, title)));
  return row;
}

function renderLineChart(chart: Extract<AnalysisChart, { type: "line" }>, title: string, doc: Document): HTMLElement {
  const chartWrap = doc.createElement("div");
  chartWrap.style.marginBottom = "8px";
  chartWrap.style.border = "1px solid #2a2a2a";
  chartWrap.style.borderRadius = "8px";
  chartWrap.style.background = "#121212";
  chartWrap.style.padding = "6px";

  const points = chart.points.slice().sort((a, b) => a.x - b.x);
  const w = 520;
  const h = 180;
  const ml = 42;
  const mr = 10;
  const mt = 8;
  const mb = 24;
  const minX = points[0].x;
  const maxX = points[points.length - 1].x;
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  const xSpan = Math.max(1, maxX - minX);
  const ySpan = Math.max(1, maxY - minY);
  const mapX = (x: number) => ml + ((x - minX) / xSpan) * (w - ml - mr);
  const mapY = (y: number) => h - mb - ((y - minY) / ySpan) * (h - mt - mb);
  const poly = points.map((p) => `${mapX(p.x).toFixed(2)},${mapY(p.y).toFixed(2)}`).join(" ");
  const yMid = (minY + maxY) / 2;
  const xStartLabel = points[0].label || "";
  const xEndLabel = points[points.length - 1].label || "";
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "180");
  svg.innerHTML = `
    <line x1="${ml}" y1="${h - mb}" x2="${w - mr}" y2="${h - mb}" stroke="#3a3a3a" stroke-width="1"/>
    <line x1="${ml}" y1="${mt}" x2="${ml}" y2="${h - mb}" stroke="#3a3a3a" stroke-width="1"/>
    <polyline fill="none" stroke="#66a8ff" stroke-width="2" points="${poly}"/>
    <text x="${ml - 6}" y="${mapY(maxY) + 4}" text-anchor="end" font-size="10" fill="#aaa">${Math.round(maxY)}</text>
    <text x="${ml - 6}" y="${mapY(yMid) + 4}" text-anchor="end" font-size="10" fill="#aaa">${Math.round(yMid)}</text>
    <text x="${ml - 6}" y="${mapY(minY) + 4}" text-anchor="end" font-size="10" fill="#aaa">${Math.round(minY)}</text>
    <text x="${ml}" y="${h - 6}" text-anchor="start" font-size="10" fill="#aaa">${xStartLabel}</text>
    <text x="${w - mr}" y="${h - 6}" text-anchor="end" font-size="10" fill="#aaa">${xEndLabel}</text>
  `;
  chartWrap.appendChild(createChartActions(svg, title));
  chartWrap.appendChild(svg);
  return chartWrap;
}

function renderBarChart(chart: Extract<AnalysisChart, { type: "bar" }>, title: string, doc: Document): HTMLElement {
  const chartWrap = doc.createElement("div");
  chartWrap.style.marginBottom = "8px";
  chartWrap.style.border = "1px solid #2a2a2a";
  chartWrap.style.borderRadius = "8px";
  chartWrap.style.background = "#121212";
  chartWrap.style.padding = "6px";

  const bars = chart.bars.slice(0, 16);
  const w = 520;
  const h = 190;
  const ml = 34;
  const mr = 8;
  const mt = 8;
  const mb = 46;
  const maxY = Math.max(1, ...bars.map((b) => b.value));
  const innerW = w - ml - mr;
  const innerH = h - mt - mb;
  const step = bars.length > 0 ? innerW / bars.length : innerW;
  const bw = Math.max(4, step * 0.66);
  const rects = bars
    .map((b, i) => {
      const x = ml + i * step + (step - bw) / 2;
      const bh = (b.value / maxY) * innerH;
      const y = mt + innerH - bh;
      const label = b.label.length > 9 ? `${b.label.slice(0, 9)}..` : b.label;
      return `
        <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${bw.toFixed(2)}" height="${bh.toFixed(2)}" fill="#66a8ff" opacity="0.85" />
        <text x="${(x + bw / 2).toFixed(2)}" y="${h - mb + 13}" text-anchor="middle" font-size="9" fill="#aaa">${label}</text>
      `;
    })
    .join("");

  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "190");
  svg.innerHTML = `
    <line x1="${ml}" y1="${h - mb}" x2="${w - mr}" y2="${h - mb}" stroke="#3a3a3a" stroke-width="1"/>
    <line x1="${ml}" y1="${mt}" x2="${ml}" y2="${h - mb}" stroke="#3a3a3a" stroke-width="1"/>
    <text x="${ml - 5}" y="${mt + 4}" text-anchor="end" font-size="10" fill="#aaa">${Math.round(maxY)}</text>
    <text x="${ml - 5}" y="${h - mb + 4}" text-anchor="end" font-size="10" fill="#aaa">0</text>
    ${rects}
  `;
  chartWrap.appendChild(createChartActions(svg, title));
  chartWrap.appendChild(svg);
  return chartWrap;
}

export function createUI(): UIHandle {
  const iconBtn = document.createElement("button");
  iconBtn.title = "GeoAnalyzr";
  iconBtn.style.position = "fixed";
  iconBtn.style.left = "16px";
  iconBtn.style.bottom = "16px";
  iconBtn.style.zIndex = "999999";
  iconBtn.style.width = "44px";
  iconBtn.style.height = "44px";
  iconBtn.style.borderRadius = "999px";
  iconBtn.style.border = "1px solid rgba(255,255,255,0.25)";
  iconBtn.style.background = "rgba(20,20,20,0.95)";
  iconBtn.style.color = "white";
  iconBtn.style.cursor = "pointer";
  iconBtn.style.display = "flex";
  iconBtn.style.alignItems = "center";
  iconBtn.style.justifyContent = "center";
  iconBtn.style.boxShadow = "0 6px 20px rgba(0,0,0,0.35)";
  iconBtn.textContent = "A";

  const panel = document.createElement("div");
  panel.style.position = "fixed";
  panel.style.left = "16px";
  panel.style.bottom = "68px";
  panel.style.zIndex = "999999";
  panel.style.width = "360px";
  panel.style.maxWidth = "calc(100vw - 32px)";
  panel.style.borderRadius = "14px";
  panel.style.border = "1px solid rgba(255,255,255,0.2)";
  panel.style.background = "rgba(20,20,20,0.92)";
  panel.style.color = "white";
  panel.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial";
  panel.style.boxShadow = "0 10px 30px rgba(0,0,0,0.45)";
  panel.style.padding = "10px";
  panel.style.display = "none";

  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.justifyContent = "space-between";
  header.style.alignItems = "center";
  header.style.marginBottom = "8px";

  const title = document.createElement("div");
  title.textContent = "GeoAnalyzr";
  title.style.fontWeight = "700";
  title.style.fontSize = "14px";

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "x";
  closeBtn.style.border = "none";
  closeBtn.style.background = "transparent";
  closeBtn.style.color = "white";
  closeBtn.style.cursor = "pointer";
  closeBtn.style.fontSize = "18px";

  header.appendChild(title);
  header.appendChild(closeBtn);

  const status = document.createElement("div");
  status.textContent = "Ready.";
  status.style.fontSize = "12px";
  status.style.opacity = "0.95";
  status.style.whiteSpace = "pre-wrap";
  status.style.marginBottom = "10px";

  function mkBtn(label: string, bg: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.width = "100%";
    b.style.padding = "10px 12px";
    b.style.borderRadius = "12px";
    b.style.border = "1px solid rgba(255,255,255,0.25)";
    b.style.background = bg;
    b.style.color = "white";
    b.style.cursor = "pointer";
    b.style.fontWeight = "600";
    b.style.marginTop = "8px";
    return b;
  }

  const updateBtn = mkBtn("Fetch Data", "rgba(255,255,255,0.10)");
  const analysisBtn = mkBtn("Open Analysis Window", "rgba(35,95,160,0.28)");
  const tokenBtn = mkBtn("Set NCFA Token", "rgba(95,95,30,0.35)");
  const tokenHelpBtn = document.createElement("button");
  tokenHelpBtn.textContent = "?";
  tokenHelpBtn.title = "How to get _ncfa token";
  tokenHelpBtn.style.width = "36px";
  tokenHelpBtn.style.padding = "10px 0";
  tokenHelpBtn.style.borderRadius = "12px";
  tokenHelpBtn.style.border = "1px solid rgba(255,255,255,0.25)";
  tokenHelpBtn.style.background = "rgba(95,95,30,0.35)";
  tokenHelpBtn.style.color = "white";
  tokenHelpBtn.style.cursor = "pointer";
  tokenHelpBtn.style.fontWeight = "700";
  tokenHelpBtn.style.marginTop = "8px";
  tokenHelpBtn.style.marginLeft = "8px";
  const exportBtn = mkBtn("Export Excel", "rgba(40,120,50,0.35)");
  const resetBtn = mkBtn("Reset Database", "rgba(160,35,35,0.35)");

  const counts = document.createElement("div");
  counts.style.marginTop = "10px";
  counts.style.fontSize = "12px";
  counts.style.opacity = "0.92";
  counts.style.whiteSpace = "normal";
  counts.textContent = "Data: 0 games, 0 rounds.";

  panel.appendChild(header);
  panel.appendChild(status);
  panel.appendChild(updateBtn);
  panel.appendChild(analysisBtn);
  const tokenRow = document.createElement("div");
  tokenRow.style.display = "flex";
  tokenRow.style.alignItems = "stretch";
  tokenRow.style.marginTop = "0";
  tokenRow.appendChild(tokenBtn);
  tokenRow.appendChild(tokenHelpBtn);
  panel.appendChild(tokenRow);
  panel.appendChild(exportBtn);
  panel.appendChild(resetBtn);
  panel.appendChild(counts);

  type AnalysisWindowRefs = {
    win: Window;
    doc: Document;
    fromInput: HTMLInputElement;
    toInput: HTMLInputElement;
    modeSelect: HTMLSelectElement;
    teammateSelect: HTMLSelectElement;
    countrySelect: HTMLSelectElement;
    modalBody: HTMLDivElement;
  };

  let analysisWindow: AnalysisWindowRefs | null = null;
  let lastAnalysisData: AnalysisWindowData | null = null;

  function styleInput(el: HTMLInputElement | HTMLSelectElement) {
    el.style.background = "#1b1b1b";
    el.style.color = "white";
    el.style.border = "1px solid #3a3a3a";
    el.style.borderRadius = "8px";
    el.style.padding = "6px 8px";
  }

  function populateAnalysisWindow(data: AnalysisWindowData) {
    const refs = analysisWindow;
    if (!refs || refs.win.closed) return;

    const { fromInput, toInput, modeSelect, teammateSelect, countrySelect, modalBody, doc } = refs;
    if (!fromInput.value && data.minPlayedAt) fromInput.value = isoDateLocal(data.minPlayedAt);
    if (!toInput.value && data.maxPlayedAt) toInput.value = isoDateLocal(data.maxPlayedAt);

    const prevMode = modeSelect.value || "all";
    const prevTeammate = teammateSelect.value || "all";
    const prevCountry = countrySelect.value || "all";

    modeSelect.innerHTML = "";
    for (const mode of data.availableModes) {
      const opt = doc.createElement("option");
      opt.value = mode;
      opt.textContent = mode;
      modeSelect.appendChild(opt);
    }
    if ([...modeSelect.options].some((o) => o.value === prevMode)) modeSelect.value = prevMode;

    teammateSelect.innerHTML = "";
    for (const teammate of data.availableTeammates) {
      const opt = doc.createElement("option");
      opt.value = teammate.id;
      opt.textContent = teammate.label;
      teammateSelect.appendChild(opt);
    }
    if ([...teammateSelect.options].some((o) => o.value === prevTeammate)) teammateSelect.value = prevTeammate;

    countrySelect.innerHTML = "";
    for (const country of data.availableCountries) {
      const opt = doc.createElement("option");
      opt.value = country.code;
      opt.textContent = country.label;
      countrySelect.appendChild(opt);
    }
    if ([...countrySelect.options].some((o) => o.value === prevCountry)) countrySelect.value = prevCountry;

    modalBody.innerHTML = "";
    for (const s of data.sections) {
      modalBody.appendChild(renderSection(s, doc));
    }
  }

  function ensureAnalysisWindow(): AnalysisWindowRefs | null {
    if (analysisWindow && !analysisWindow.win.closed) {
      analysisWindow.win.focus();
      return analysisWindow;
    }

    const win = window.open("", "geoanalyzr-analysis");
    if (!win) return null;
    const doc = win.document;
    doc.title = "GeoAnalyzr - Full Analysis";
    doc.body.innerHTML = "";
    doc.body.style.margin = "0";
    doc.body.style.background = "#111";
    doc.body.style.color = "#fff";
    doc.body.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial";

    const shell = doc.createElement("div");
    shell.style.display = "grid";
    shell.style.gridTemplateRows = "auto auto 1fr";
    shell.style.height = "100vh";

    const modalHead = doc.createElement("div");
    modalHead.style.display = "flex";
    modalHead.style.justifyContent = "space-between";
    modalHead.style.alignItems = "center";
    modalHead.style.padding = "12px 14px";
    modalHead.style.borderBottom = "1px solid #2a2a2a";
    modalHead.innerHTML = `<div style="font-weight:700">GeoAnalyzr - Full Analysis</div>`;
    const modalClose = doc.createElement("button");
    modalClose.textContent = "x";
    modalClose.style.background = "transparent";
    modalClose.style.color = "white";
    modalClose.style.border = "none";
    modalClose.style.cursor = "pointer";
    modalClose.style.fontSize = "18px";
    modalHead.appendChild(modalClose);

    const controls = doc.createElement("div");
    controls.style.display = "flex";
    controls.style.gap = "10px";
    controls.style.alignItems = "center";
    controls.style.padding = "10px 14px";
    controls.style.borderBottom = "1px solid #2a2a2a";
    controls.style.flexWrap = "wrap";

    const fromInput = doc.createElement("input");
    fromInput.type = "date";
    styleInput(fromInput);

    const toInput = doc.createElement("input");
    toInput.type = "date";
    styleInput(toInput);

    const modeSelect = doc.createElement("select");
    styleInput(modeSelect);

    const teammateSelect = doc.createElement("select");
    styleInput(teammateSelect);

    const countrySelect = doc.createElement("select");
    styleInput(countrySelect);

    const applyBtn = doc.createElement("button");
    applyBtn.textContent = "Apply Filter";
    applyBtn.style.background = "#214a78";
    applyBtn.style.color = "white";
    applyBtn.style.border = "1px solid #2f6096";
    applyBtn.style.borderRadius = "8px";
    applyBtn.style.padding = "6px 10px";
    applyBtn.style.cursor = "pointer";

    const resetFilterBtn = doc.createElement("button");
    resetFilterBtn.textContent = "Reset Filter";
    resetFilterBtn.style.background = "#303030";
    resetFilterBtn.style.color = "white";
    resetFilterBtn.style.border = "1px solid #444";
    resetFilterBtn.style.borderRadius = "8px";
    resetFilterBtn.style.padding = "6px 10px";
    resetFilterBtn.style.cursor = "pointer";

    controls.appendChild(doc.createTextNode("From:"));
    controls.appendChild(fromInput);
    controls.appendChild(doc.createTextNode("To:"));
    controls.appendChild(toInput);
    controls.appendChild(doc.createTextNode("Mode:"));
    controls.appendChild(modeSelect);
    controls.appendChild(doc.createTextNode("Teammate:"));
    controls.appendChild(teammateSelect);
    controls.appendChild(doc.createTextNode("Country:"));
    controls.appendChild(countrySelect);
    controls.appendChild(applyBtn);
    controls.appendChild(resetFilterBtn);

    const modalBody = doc.createElement("div");
    modalBody.style.overflow = "auto";
    modalBody.style.padding = "14px";
    modalBody.style.display = "grid";
    modalBody.style.gridTemplateColumns = "repeat(auto-fit, minmax(350px, 1fr))";
    modalBody.style.gap = "10px";

    shell.appendChild(modalHead);
    shell.appendChild(controls);
    shell.appendChild(modalBody);
    doc.body.appendChild(shell);

    modalClose.addEventListener("click", () => win.close());
    applyBtn.addEventListener("click", () => {
      refreshAnalysisHandler?.({
        fromTs: parseDateInput(fromInput.value, false),
        toTs: parseDateInput(toInput.value, true),
        mode: modeSelect.value || "all",
        teammateId: teammateSelect.value || "all",
        country: countrySelect.value || "all"
      });
    });
    resetFilterBtn.addEventListener("click", () => {
      fromInput.value = "";
      toInput.value = "";
      modeSelect.value = "all";
      teammateSelect.value = "all";
      countrySelect.value = "all";
      refreshAnalysisHandler?.({ mode: "all", teammateId: "all", country: "all" });
    });

    analysisWindow = { win, doc, fromInput, toInput, modeSelect, teammateSelect, countrySelect, modalBody };
    if (lastAnalysisData) populateAnalysisWindow(lastAnalysisData);
    return analysisWindow;
  }

  document.body.appendChild(iconBtn);
  document.body.appendChild(panel);

  let open = false;
  function setOpen(v: boolean) {
    open = v;
    panel.style.display = open ? "block" : "none";
  }

  iconBtn.addEventListener("click", () => setOpen(!open));
  closeBtn.addEventListener("click", () => setOpen(false));

  let updateHandler: (() => void) | null = null;
  let resetHandler: (() => void) | null = null;
  let exportHandler: (() => void) | null = null;
  let tokenHandler: (() => void) | null = null;
  let openAnalysisHandler: (() => void) | null = null;
  let refreshAnalysisHandler: ((filter: { fromTs?: number; toTs?: number; mode?: string; teammateId?: string; country?: string }) => void) | null = null;

  updateBtn.addEventListener("click", () => updateHandler?.());
  tokenBtn.addEventListener("click", () => tokenHandler?.());
  tokenHelpBtn.addEventListener("click", () => {
    alert(
      "NCFA token setup:\n\n" +
      "1) Open geoguessr.com and log in.\n" +
      "2) Open browser DevTools (F12 / Ctrl+Shift+I).\n" +
      "3) Go to Network tab.\n" +
      "4) Reload the page.\n" +
      "5) Use filter and search for 'stats'.\n" +
      "6) Open a 'stats' request.\n" +
      "7) In request headers, find the '_ncfa' cookie.\n" +
      "8) Copy only the value after '=' up to ';' (without ';')."
    );
  });
  exportBtn.addEventListener("click", () => exportHandler?.());
  resetBtn.addEventListener("click", () => resetHandler?.());
  analysisBtn.addEventListener("click", () => {
    const win = ensureAnalysisWindow();
    if (!win) return;
    openAnalysisHandler?.();
  });

  function renderSection(section: AnalysisSection, doc: Document): HTMLElement {
    const card = doc.createElement("div");
    card.style.border = "1px solid #2a2a2a";
    card.style.borderRadius = "10px";
    card.style.background = "#171717";
    card.style.padding = "10px";
    const title2 = doc.createElement("div");
    title2.textContent = section.title;
    title2.style.fontWeight = "700";
    title2.style.marginBottom = "6px";
    title2.style.fontSize = "13px";
    const body = doc.createElement("pre");
    body.style.margin = "0";
    body.style.whiteSpace = "pre-wrap";
    body.style.fontSize = "12px";
    body.style.lineHeight = "1.35";
    body.textContent = section.lines.join("\n");
    card.appendChild(title2);

    const charts = section.charts ? section.charts : section.chart ? [section.chart] : [];
    for (let i = 0; i < charts.length; i++) {
      const chart = charts[i];
      const chartTitle = `${section.title} - Chart ${i + 1}`;
      if (chart.type === "line" && chart.points.length > 1) {
        card.appendChild(renderLineChart(chart, chartTitle, doc));
      }
      if (chart.type === "bar" && chart.bars.length > 0) {
        card.appendChild(renderBarChart(chart, chartTitle, doc));
      }
    }

    card.appendChild(body);
    return card;
  }

  return {
    setVisible(visible) {
      iconBtn.style.display = visible ? "flex" : "none";
      if (!visible) {
        panel.style.display = "none";
        if (analysisWindow && !analysisWindow.win.closed) {
          analysisWindow.win.close();
        }
      }
    },
    setStatus(msg) {
      status.textContent = msg;
    },
    setCounts(value) {
      counts.textContent = `Data: ${value.games} games, ${value.rounds} rounds.`;
    },
    setAnalysisWindowData(data) {
      lastAnalysisData = data;
      populateAnalysisWindow(data);
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
      openAnalysisHandler = fn;
    },
    onRefreshAnalysisClick(fn) {
      refreshAnalysisHandler = fn;
    }
  };
}
