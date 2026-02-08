import { AnalysisChart, AnalysisSection, AnalysisWindowData } from "./analysis";

type AnalysisTheme = "dark" | "light";
type AnalysisSettings = {
  theme: AnalysisTheme;
  accent: string;
};

type ThemePalette = {
  bg: string;
  text: string;
  panel: string;
  panelAlt: string;
  border: string;
  axis: string;
  textMuted: string;
  buttonBg: string;
  buttonText: string;
  chipBg: string;
  chipText: string;
};

const analysisSettings: AnalysisSettings = {
  theme: "dark",
  accent: "#66a8ff"
};

function getThemePalette(): ThemePalette {
  if (analysisSettings.theme === "light") {
    return {
      bg: "#f3f6fb",
      text: "#111827",
      panel: "#ffffff",
      panelAlt: "#eef2f8",
      border: "#d0d9e6",
      axis: "#9aa8bf",
      textMuted: "#4b5a73",
      buttonBg: "#edf1f7",
      buttonText: "#1e2a40",
      chipBg: "#e7edf8",
      chipText: "#2a466e"
    };
  }
  return {
    bg: "#111",
    text: "#fff",
    panel: "#171717",
    panelAlt: "#121212",
    border: "#2d2d2d",
    axis: "#3a3a3a",
    textMuted: "#aaa",
    buttonBg: "#303030",
    buttonText: "#fff",
    chipBg: "#1f3452",
    chipText: "#bcd7ff"
  };
}

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
  openNcfaManager: (options: {
    initialToken?: string;
    helpText: string;
    repoUrl: string;
    onSave: (token: string) => Promise<{ saved: boolean; token?: string; message: string }>;
    onAutoDetect: () => Promise<{ detected: boolean; token?: string; source?: "stored" | "cookie" | "session" | "none"; message: string }>;
  }) => void;
  onOpenAnalysisClick: (fn: () => void) => void;
  onRefreshAnalysisClick: (fn: (filter: { fromTs?: number; toTs?: number; mode?: string; teammateId?: string; country?: string }) => void) => void;
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
  const win = hostWindow.open("about:blank", "_blank");
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
  const palette = getThemePalette();
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
    b.style.background = palette.buttonBg;
    b.style.color = palette.buttonText;
    b.style.border = `1px solid ${palette.border}`;
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

function aggregateLinePoints(points: Array<{ x: number; y: number; label?: string }>): Array<{ x: number; y: number; label?: string }> {
  if (points.length <= 120) return points;
  const sorted = points.slice().sort((a, b) => a.x - b.x);
  const span = Math.max(1, sorted[sorted.length - 1].x - sorted[0].x);
  const spanDays = span / (24 * 60 * 60 * 1000);
  let bucketMs = 24 * 60 * 60 * 1000;
  if (spanDays > 365 * 2) bucketMs = 30 * 24 * 60 * 60 * 1000;
  else if (spanDays > 365) bucketMs = 14 * 24 * 60 * 60 * 1000;
  else if (spanDays > 120) bucketMs = 7 * 24 * 60 * 60 * 1000;
  else if (spanDays > 31) bucketMs = 2 * 24 * 60 * 60 * 1000;

  const buckets = new Map<number, { sumY: number; n: number; x: number; label?: string }>();
  for (const p of sorted) {
    const key = Math.floor(p.x / bucketMs) * bucketMs;
    const cur = buckets.get(key) || { sumY: 0, n: 0, x: p.x, label: p.label };
    cur.sumY += p.y;
    cur.n += 1;
    cur.x = p.x;
    cur.label = p.label;
    buckets.set(key, cur);
  }

  let out: Array<{ x: number; y: number; label?: string }> = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) =>
      v.label !== undefined ? { x: v.x, y: v.sumY / Math.max(1, v.n), label: v.label } : { x: v.x, y: v.sumY / Math.max(1, v.n) }
    );

  const hardLimit = 180;
  if (out.length > hardLimit) {
    const stride = Math.ceil(out.length / hardLimit);
    const compressed: Array<{ x: number; y: number; label?: string }> = [];
    for (let i = 0; i < out.length; i += stride) {
      const chunk = out.slice(i, i + stride);
      const avgY = chunk.reduce((acc, p) => acc + p.y, 0) / Math.max(1, chunk.length);
      const last = chunk[chunk.length - 1];
      compressed.push(last.label !== undefined ? { x: last.x, y: avgY, label: last.label } : { x: last.x, y: avgY });
    }
    out = compressed;
  }
  return out.length > 1 ? out : points;
}

function renderLineChart(chart: Extract<AnalysisChart, { type: "line" }>, title: string, doc: Document): HTMLElement {
  const palette = getThemePalette();
  const chartWrap = doc.createElement("div");
  chartWrap.style.marginBottom = "8px";
  chartWrap.style.border = `1px solid ${palette.border}`;
  chartWrap.style.borderRadius = "8px";
  chartWrap.style.background = palette.panelAlt;
  chartWrap.style.padding = "6px";
  const chartHeading = doc.createElement("div");
  chartHeading.textContent = title;
  chartHeading.style.fontSize = "12px";
  chartHeading.style.color = palette.textMuted;
  chartHeading.style.margin = "2px 4px 6px";
  chartWrap.appendChild(chartHeading);

  const points = aggregateLinePoints(chart.points);
  const w = 1500;
  const h = 300;
  const ml = 60;
  const mr = 20;
  const mt = 16;
  const mb = 42;
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
  const accent = analysisSettings.accent;
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "300");
  svg.innerHTML = `
    <line x1="${ml}" y1="${h - mb}" x2="${w - mr}" y2="${h - mb}" stroke="${palette.axis}" stroke-width="1"/>
    <line x1="${ml}" y1="${mt}" x2="${ml}" y2="${h - mb}" stroke="${palette.axis}" stroke-width="1"/>
    <polyline fill="none" stroke="${accent}" stroke-width="3" points="${poly}"/>
    <text x="${ml - 6}" y="${mapY(maxY) + 4}" text-anchor="end" font-size="10" fill="${palette.textMuted}">${Math.round(maxY)}</text>
    <text x="${ml - 6}" y="${mapY(yMid) + 4}" text-anchor="end" font-size="10" fill="${palette.textMuted}">${Math.round(yMid)}</text>
    <text x="${ml - 6}" y="${mapY(minY) + 4}" text-anchor="end" font-size="10" fill="${palette.textMuted}">${Math.round(minY)}</text>
    <text x="${ml}" y="${h - 8}" text-anchor="start" font-size="12" fill="${palette.textMuted}">${xStartLabel}</text>
    <text x="${w - mr}" y="${h - 8}" text-anchor="end" font-size="12" fill="${palette.textMuted}">${xEndLabel}</text>
  `;
  chartWrap.appendChild(createChartActions(svg, title));
  chartWrap.appendChild(svg);
  return chartWrap;
}

function renderBarChart(chart: Extract<AnalysisChart, { type: "bar" }>, title: string, doc: Document): HTMLElement {
  const palette = getThemePalette();
  const chartWrap = doc.createElement("div");
  chartWrap.style.marginBottom = "8px";
  chartWrap.style.border = `1px solid ${palette.border}`;
  chartWrap.style.borderRadius = "8px";
  chartWrap.style.background = palette.panelAlt;
  chartWrap.style.padding = "6px";
  const chartHeading = doc.createElement("div");
  chartHeading.textContent = title;
  chartHeading.style.fontSize = "12px";
  chartHeading.style.color = palette.textMuted;
  chartHeading.style.margin = "2px 4px 6px";
  chartWrap.appendChild(chartHeading);

  const allBars = chart.bars.slice(0, 240);
  const initialBars = Math.max(1, Math.min(chart.initialBars ?? 40, allBars.length || 1));
  let expanded = allBars.length <= initialBars;
  const content = doc.createElement("div");
  chartWrap.appendChild(content);

  const render = () => {
    content.innerHTML = "";
    const bars = expanded ? allBars : allBars.slice(0, initialBars);
    const w = 1700;
    const h = 320;
    const ml = 52;
    const mr = 16;
    const mt = 14;
    const mb = 80;
    const maxY = Math.max(1, ...bars.map((b) => b.value));
    const innerW = w - ml - mr;
    const innerH = h - mt - mb;
    const step = bars.length > 0 ? innerW / bars.length : innerW;
    const bw = Math.max(4, step * 0.66);
    const accent = analysisSettings.accent;
    const rects = bars
      .map((b, i) => {
        const x = ml + i * step + (step - bw) / 2;
        const bh = (b.value / maxY) * innerH;
        const y = mt + innerH - bh;
        const label = b.label.length > 14 ? `${b.label.slice(0, 14)}..` : b.label;
        return `
          <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${bw.toFixed(2)}" height="${bh.toFixed(2)}" fill="${accent}" opacity="0.85" />
          <text x="${(x + bw / 2).toFixed(2)}" y="${h - mb + 16}" text-anchor="middle" font-size="11" fill="${palette.textMuted}">${label}</text>
        `;
      })
      .join("");

    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "320");
    svg.innerHTML = `
      <line x1="${ml}" y1="${h - mb}" x2="${w - mr}" y2="${h - mb}" stroke="${palette.axis}" stroke-width="1"/>
      <line x1="${ml}" y1="${mt}" x2="${ml}" y2="${h - mb}" stroke="${palette.axis}" stroke-width="1"/>
      <text x="${ml - 5}" y="${mt + 4}" text-anchor="end" font-size="10" fill="${palette.textMuted}">${Math.round(maxY)}</text>
      <text x="${ml - 5}" y="${h - mb + 4}" text-anchor="end" font-size="10" fill="${palette.textMuted}">0</text>
      ${rects}
    `;
    content.appendChild(createChartActions(svg, title));
    if (allBars.length > initialBars) {
      const toggle = doc.createElement("button");
      toggle.textContent = expanded ? "Show less" : `Show all (${allBars.length})`;
      toggle.style.background = palette.buttonBg;
      toggle.style.color = palette.buttonText;
      toggle.style.border = `1px solid ${palette.border}`;
      toggle.style.borderRadius = "6px";
      toggle.style.padding = "3px 8px";
      toggle.style.fontSize = "11px";
      toggle.style.cursor = "pointer";
      toggle.style.marginBottom = "6px";
      toggle.addEventListener("click", () => {
        expanded = !expanded;
        render();
      });
      content.appendChild(toggle);
    }
    content.appendChild(svg);
  };
  render();
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
  iconBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">' +
    '<polyline points="3,16 9,10 14,15 21,8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></polyline>' +
    '<polyline points="16,8 21,8 21,13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></polyline>' +
    "</svg>";

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
  panel.appendChild(tokenBtn);
  panel.appendChild(exportBtn);
  panel.appendChild(resetBtn);
  panel.appendChild(counts);

  type AnalysisWindowRefs = {
    win: Window;
    doc: Document;
    shell: HTMLDivElement;
    controls: HTMLDivElement;
    fromInput: HTMLInputElement;
    toInput: HTMLInputElement;
    modeSelect: HTMLSelectElement;
    teammateSelect: HTMLSelectElement;
    countrySelect: HTMLSelectElement;
    themeSelect: HTMLSelectElement;
    colorInput: HTMLInputElement;
    tocWrap: HTMLDivElement;
    modalBody: HTMLDivElement;
  };

  let analysisWindow: AnalysisWindowRefs | null = null;
  let lastAnalysisData: AnalysisWindowData | null = null;

  function styleInput(el: HTMLInputElement | HTMLSelectElement) {
    const palette = getThemePalette();
    el.style.background = palette.panelAlt;
    el.style.color = palette.text;
    el.style.border = `1px solid ${palette.border}`;
    el.style.borderRadius = "8px";
    el.style.padding = "6px 8px";
  }

  function applyThemeToWindow(refs: AnalysisWindowRefs) {
    const palette = getThemePalette();
    refs.doc.body.style.background = palette.bg;
    refs.doc.body.style.color = palette.text;
    refs.shell.style.background = palette.bg;
    refs.controls.style.background = palette.bg;
    refs.controls.style.borderBottom = `1px solid ${palette.border}`;
    refs.tocWrap.style.background = palette.panelAlt;
    refs.tocWrap.style.borderBottom = `1px solid ${palette.border}`;
    styleInput(refs.fromInput);
    styleInput(refs.toInput);
    styleInput(refs.modeSelect);
    styleInput(refs.teammateSelect);
    styleInput(refs.countrySelect);
    styleInput(refs.themeSelect);
    refs.colorInput.style.border = `1px solid ${palette.border}`;
    refs.colorInput.style.background = palette.panelAlt;
  }

  function populateAnalysisWindow(data: AnalysisWindowData) {
    const refs = analysisWindow;
    if (!refs || refs.win.closed) return;
    const palette = getThemePalette();

    const { fromInput, toInput, modeSelect, teammateSelect, countrySelect, modalBody, tocWrap, doc } = refs;
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

    const sectionsByGroup = new Map<string, AnalysisSection[]>();
    for (const s of data.sections) {
      const key = s.group || "Other";
      const arr = sectionsByGroup.get(key) || [];
      arr.push(s);
      sectionsByGroup.set(key, arr);
    }

    tocWrap.innerHTML = "";
    for (const [group, secs] of sectionsByGroup.entries()) {
      const groupRow = doc.createElement("div");
      groupRow.style.display = "flex";
      groupRow.style.alignItems = "center";
      groupRow.style.gap = "8px";
      const groupLabel = doc.createElement("span");
      groupLabel.textContent = group;
      groupLabel.style.color = palette.chipText;
      groupLabel.style.fontWeight = "700";
      groupLabel.style.fontSize = "12px";
      groupRow.appendChild(groupLabel);
      for (const s of secs) {
        const b = doc.createElement("button");
        b.textContent = s.title;
        b.style.background = palette.buttonBg;
        b.style.color = palette.buttonText;
        b.style.border = `1px solid ${palette.border}`;
        b.style.borderRadius = "999px";
        b.style.padding = "4px 9px";
        b.style.cursor = "pointer";
        b.style.fontSize = "11px";
        b.addEventListener("click", () => {
          const id = `section-${s.id}`;
          const node = doc.getElementById(id);
          if (node) node.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        groupRow.appendChild(b);
      }
      tocWrap.appendChild(groupRow);
    }

    modalBody.innerHTML = "";
    for (const s of data.sections) modalBody.appendChild(renderSection(s, doc));
  }

  function canAccessWindow(win: Window | null): win is Window {
    if (!win) return false;
    try {
      void win.closed;
      void win.location.href;
      void win.document;
      return true;
    } catch {
      return false;
    }
  }

  function ensureAnalysisWindow(): AnalysisWindowRefs | null {
    if (analysisWindow && !analysisWindow.win.closed) {
      if (canAccessWindow(analysisWindow.win)) {
        analysisWindow.win.focus();
        return analysisWindow;
      }
      analysisWindow = null;
    }

    let win = window.open("about:blank", "geoanalyzr-analysis");
    if (!canAccessWindow(win)) {
      win = window.open("about:blank", "_blank");
    }
    if (!canAccessWindow(win)) return null;
    const doc = win.document;
    const palette = getThemePalette();
    doc.title = "GeoAnalyzr - Full Analysis";
    doc.body.innerHTML = "";
    doc.body.style.margin = "0";
    doc.body.style.background = palette.bg;
    doc.body.style.color = palette.text;
    doc.body.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial";

    const shell = doc.createElement("div");
    shell.style.display = "grid";
    shell.style.gridTemplateRows = "auto auto auto 1fr";
    shell.style.height = "100vh";

    const modalHead = doc.createElement("div");
    modalHead.style.display = "flex";
    modalHead.style.justifyContent = "space-between";
    modalHead.style.alignItems = "center";
    modalHead.style.padding = "12px 14px";
    modalHead.style.borderBottom = `1px solid ${palette.border}`;
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
    controls.style.borderBottom = `1px solid ${palette.border}`;
    controls.style.flexWrap = "wrap";
    controls.style.background = palette.bg;

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

    const themeSelect = doc.createElement("select");
    themeSelect.innerHTML = `
      <option value="dark">Dark</option>
      <option value="light">Light</option>
    `;
    themeSelect.value = analysisSettings.theme;
    styleInput(themeSelect);

    const colorInput = doc.createElement("input");
    colorInput.type = "color";
    colorInput.value = analysisSettings.accent;
    colorInput.style.width = "44px";
    colorInput.style.height = "32px";
    colorInput.style.borderRadius = "8px";
    colorInput.style.cursor = "pointer";

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
    controls.appendChild(doc.createTextNode("Theme:"));
    controls.appendChild(themeSelect);
    controls.appendChild(doc.createTextNode("Graph Color:"));
    controls.appendChild(colorInput);

    const tocWrap = doc.createElement("div");
    tocWrap.style.display = "flex";
    tocWrap.style.flexDirection = "column";
    tocWrap.style.gap = "6px";
    tocWrap.style.padding = "8px 14px 10px";
    tocWrap.style.borderBottom = `1px solid ${palette.border}`;
    tocWrap.style.background = palette.panelAlt;
    tocWrap.style.position = "sticky";
    tocWrap.style.top = "0";
    tocWrap.style.zIndex = "5";

    const modalBody = doc.createElement("div");
    modalBody.style.overflow = "auto";
    modalBody.style.padding = "16px";
    modalBody.style.display = "grid";
    modalBody.style.gridTemplateColumns = "minmax(0, 1fr)";
    modalBody.style.gap = "14px";
    modalBody.style.maxWidth = "1800px";
    modalBody.style.width = "100%";
    modalBody.style.margin = "0 auto";

    shell.appendChild(modalHead);
    shell.appendChild(controls);
    shell.appendChild(tocWrap);
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

    themeSelect.addEventListener("change", () => {
      analysisSettings.theme = themeSelect.value === "light" ? "light" : "dark";
      if (analysisWindow) {
        applyThemeToWindow(analysisWindow);
        if (lastAnalysisData) populateAnalysisWindow(lastAnalysisData);
      }
    });
    colorInput.addEventListener("input", () => {
      analysisSettings.accent = colorInput.value;
      if (lastAnalysisData) populateAnalysisWindow(lastAnalysisData);
    });
    analysisWindow = {
      win,
      doc,
      shell,
      controls,
      fromInput,
      toInput,
      modeSelect,
      teammateSelect,
      countrySelect,
      themeSelect,
      colorInput,
      tocWrap,
      modalBody
    };
    applyThemeToWindow(analysisWindow);
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
  exportBtn.addEventListener("click", () => exportHandler?.());
  resetBtn.addEventListener("click", () => resetHandler?.());
  analysisBtn.addEventListener("click", () => {
    try {
      const win = ensureAnalysisWindow();
      if (!win) {
        status.textContent = "Could not open analysis window (popup blocked?).";
        return;
      }
      openAnalysisHandler?.();
    } catch (e) {
      status.textContent = `Analysis open failed: ${e instanceof Error ? e.message : String(e)}`;
      console.error("[GeoAnalyzr] Failed to open analysis window", e);
    }
  });

  function renderSection(section: AnalysisSection, doc: Document): HTMLElement {
    const palette = getThemePalette();
    const card = doc.createElement("div");
    card.id = `section-${section.id}`;
    card.style.border = `1px solid ${palette.border}`;
    card.style.borderRadius = "12px";
    card.style.background = palette.panel;
    card.style.padding = "12px";
    card.style.scrollMarginTop = "110px";
    card.style.boxShadow = "0 10px 30px rgba(0,0,0,0.2)";

    const topMeta = doc.createElement("div");
    topMeta.style.display = "flex";
    topMeta.style.gap = "8px";
    topMeta.style.flexWrap = "wrap";
    topMeta.style.marginBottom = "6px";

    if (section.group) {
      const groupChip = doc.createElement("span");
      groupChip.textContent = section.group;
      groupChip.style.background = palette.chipBg;
      groupChip.style.color = palette.chipText;
      groupChip.style.border = `1px solid ${palette.border}`;
      groupChip.style.borderRadius = "999px";
      groupChip.style.padding = "2px 8px";
      groupChip.style.fontSize = "11px";
      groupChip.style.fontWeight = "700";
      topMeta.appendChild(groupChip);
    }
    if (section.appliesFilters && section.appliesFilters.length > 0) {
      const applies = doc.createElement("span");
      applies.textContent = `Filters: ${section.appliesFilters.join(", ")}`;
      applies.style.background = palette.panelAlt;
      applies.style.color = palette.textMuted;
      applies.style.border = `1px solid ${palette.border}`;
      applies.style.borderRadius = "999px";
      applies.style.padding = "2px 8px";
      applies.style.fontSize = "11px";
      topMeta.appendChild(applies);
    }

    const title2 = doc.createElement("div");
    title2.textContent = section.title;
    title2.style.fontWeight = "700";
    title2.style.marginBottom = "8px";
    title2.style.fontSize = "19px";
    title2.style.letterSpacing = "0.2px";
    title2.style.color = palette.text;
    const body = doc.createElement("pre");
    body.style.margin = "0";
    body.style.whiteSpace = "pre-wrap";
    body.style.fontSize = "14px";
    body.style.lineHeight = "1.45";
    body.style.color = palette.text;
    body.textContent = section.lines.join("\n");
    card.appendChild(topMeta);
    card.appendChild(title2);

    const charts = section.charts ? section.charts : section.chart ? [section.chart] : [];
    for (let i = 0; i < charts.length; i++) {
      const chart = charts[i];
      const chartTitle = chart.yLabel ? `${section.title} - ${chart.yLabel}` : `${section.title} - Chart ${i + 1}`;
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

  function showNcfaManagerModal(options: {
    initialToken?: string;
    helpText: string;
    repoUrl: string;
    onSave: (token: string) => Promise<{ saved: boolean; token?: string; message: string }>;
    onAutoDetect: () => Promise<{ detected: boolean; token?: string; source?: "stored" | "cookie" | "session" | "none"; message: string }>;
  }) {
    const palette = getThemePalette();
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,0.75)";
    overlay.style.zIndex = "1000006";
    overlay.style.display = "grid";
    overlay.style.placeItems = "center";
    overlay.style.padding = "16px";

    const modal = document.createElement("div");
    modal.style.width = "min(640px, 96vw)";
    modal.style.border = `1px solid ${palette.border}`;
    modal.style.borderRadius = "12px";
    modal.style.background = palette.panel;
    modal.style.color = palette.text;
    modal.style.boxShadow = "0 10px 30px rgba(0,0,0,0.45)";
    modal.style.padding = "14px";

    const head = document.createElement("div");
    head.style.display = "flex";
    head.style.justifyContent = "space-between";
    head.style.alignItems = "center";
    head.style.marginBottom = "10px";
    const headTitle = document.createElement("div");
    headTitle.textContent = "NCFA Token Manager";
    headTitle.style.fontWeight = "700";
    const closeBtn2 = document.createElement("button");
    closeBtn2.textContent = "x";
    closeBtn2.style.background = "transparent";
    closeBtn2.style.border = "none";
    closeBtn2.style.color = palette.text;
    closeBtn2.style.cursor = "pointer";
    closeBtn2.style.fontSize = "18px";
    head.appendChild(headTitle);
    head.appendChild(closeBtn2);

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "_ncfa value";
    input.value = options.initialToken || "";
    input.style.width = "100%";
    input.style.boxSizing = "border-box";
    input.style.background = palette.panelAlt;
    input.style.color = palette.text;
    input.style.border = `1px solid ${palette.border}`;
    input.style.borderRadius = "8px";
    input.style.padding = "8px 10px";
    input.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    input.style.fontSize = "12px";

    const feedback = document.createElement("div");
    feedback.style.marginTop = "8px";
    feedback.style.fontSize = "12px";
    feedback.style.color = palette.textMuted;
    feedback.textContent = "Set manually or use auto-detect.";

    const actions = document.createElement("div");
    actions.style.display = "grid";
    actions.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
    actions.style.gap = "8px";
    actions.style.marginTop = "12px";

    function mkSmallBtn(label: string, bg: string, onClick: () => void) {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.padding = "9px 10px";
      b.style.borderRadius = "8px";
      b.style.border = "1px solid rgba(255,255,255,0.2)";
      b.style.background = bg;
      b.style.color = "#fff";
      b.style.cursor = "pointer";
      b.style.fontWeight = "600";
      b.addEventListener("click", onClick);
      return b;
    }

    const saveBtn = mkSmallBtn("Save Manually", "rgba(95,95,30,0.45)", async () => {
      saveBtn.disabled = true;
      try {
        const res = await options.onSave(input.value);
        input.value = res.token || "";
        feedback.textContent = res.message;
      } catch (e) {
        feedback.textContent = `Save failed: ${e instanceof Error ? e.message : String(e)}`;
      } finally {
        saveBtn.disabled = false;
      }
    });

    const autoBtn = mkSmallBtn("Auto-Detect", "rgba(35,95,160,0.45)", async () => {
      autoBtn.disabled = true;
      try {
        const res = await options.onAutoDetect();
        if (res.token) input.value = res.token;
        feedback.textContent = res.message;
      } catch (e) {
        feedback.textContent = `Auto-detect failed: ${e instanceof Error ? e.message : String(e)}`;
      } finally {
        autoBtn.disabled = false;
      }
    });

    const helpBtn = mkSmallBtn("Show Instructions", "rgba(40,120,50,0.45)", () => {
      window.open(options.repoUrl, "_blank");
    });

    const closeRedBtn = mkSmallBtn("Close", "rgba(160,35,35,0.55)", () => {
      closeModal();
    });

    actions.appendChild(saveBtn);
    actions.appendChild(autoBtn);
    actions.appendChild(helpBtn);
    actions.appendChild(closeRedBtn);

    const hint = document.createElement("div");
    hint.style.marginTop = "10px";
    hint.style.fontSize = "11px";
    hint.style.color = palette.textMuted;
    hint.textContent = "Auto-detect checks stored token, then cookie access, then authenticated session (cookie can be HttpOnly).";

    modal.appendChild(head);
    modal.appendChild(input);
    modal.appendChild(feedback);
    modal.appendChild(actions);
    modal.appendChild(hint);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    function closeModal() {
      overlay.remove();
    }
    closeBtn2.addEventListener("click", closeModal);
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) closeModal();
    });
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
    openNcfaManager(options) {
      showNcfaManagerModal(options);
    },
    onOpenAnalysisClick(fn) {
      openAnalysisHandler = fn;
    },
    onRefreshAnalysisClick(fn) {
      refreshAnalysisHandler = fn;
    }
  };
}
