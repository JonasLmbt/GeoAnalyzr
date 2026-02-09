import { AnalysisBarPoint, AnalysisChart, AnalysisDrilldownItem, AnalysisSection, AnalysisWindowData } from "./analysis";

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

const ANALYSIS_SETTINGS_STORAGE_KEY = "geoanalyzr:analysis:settings:v1";
const defaultAnalysisSettings: AnalysisSettings = {
  theme: "dark",
  accent: "#66a8ff"
};

function normalizeAccent(value: unknown): string {
  if (typeof value !== "string") return defaultAnalysisSettings.accent;
  const v = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : defaultAnalysisSettings.accent;
}

function loadAnalysisSettings(): AnalysisSettings {
  try {
    const raw = localStorage.getItem(ANALYSIS_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...defaultAnalysisSettings };
    const parsed = JSON.parse(raw) as Partial<AnalysisSettings>;
    const theme: AnalysisTheme = parsed.theme === "light" ? "light" : "dark";
    const accent = normalizeAccent(parsed.accent);
    return { theme, accent };
  } catch {
    return { ...defaultAnalysisSettings };
  }
}

function saveAnalysisSettings(): void {
  try {
    localStorage.setItem(ANALYSIS_SETTINGS_STORAGE_KEY, JSON.stringify(analysisSettings));
  } catch {
    // ignore persistence issues
  }
}

const analysisSettings: AnalysisSettings = loadAnalysisSettings();

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

function gameModeSelectLabel(mode: string): string {
  const normalized = mode.trim().toLowerCase();
  if (normalized === "all") return "all";
  if (normalized === "duels" || normalized === "duel") return "Duel";
  if (normalized === "teamduels" || normalized === "team duel" || normalized === "team_duels" || normalized === "teamduel") return "Team Duel";
  return mode;
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
  onRefreshAnalysisClick: (
    fn: (filter: {
      fromTs?: number;
      toTs?: number;
      gameMode?: string;
      movementType?: "all" | "moving" | "no_move" | "nmpz" | "unknown";
      teammateId?: string;
      country?: string;
    }) => void
  ) => void;
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

function escapeSvgText(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function prepareSvgForExport(svg: SVGSVGElement): { text: string; width: number; height: number } {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (!clone.getAttribute("xmlns:xlink")) clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");

  let width = parseFloat(clone.getAttribute("width") || "");
  let height = parseFloat(clone.getAttribute("height") || "");
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    const vb = (clone.getAttribute("viewBox") || "").trim().split(/\s+/).map(Number);
    if (vb.length === 4 && Number.isFinite(vb[2]) && Number.isFinite(vb[3]) && vb[2] > 0 && vb[3] > 0) {
      width = vb[2];
      height = vb[3];
    }
  }
  if (!Number.isFinite(width) || width <= 0) width = 1200;
  if (!Number.isFinite(height) || height <= 0) height = 420;

  clone.setAttribute("width", String(Math.round(width)));
  clone.setAttribute("height", String(Math.round(height)));

  const text = new XMLSerializer().serializeToString(clone);
  return { text, width: Math.round(width), height: Math.round(height) };
}

async function downloadSvg(svg: SVGSVGElement, title: string): Promise<void> {
  const svgText = prepareSvgForExport(svg).text;
  const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  triggerDownload(blob, `${sanitizeFileName(title)}.svg`);
}

async function downloadPng(svg: SVGSVGElement, title: string): Promise<void> {
  const prepared = prepareSvgForExport(svg);
  const svgText = prepared.text;
  const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("SVG image load failed"));
      img.src = svgUrl;
    });

    const width = Math.max(1200, img.width || prepared.width || 1200);
    const height = Math.max(420, img.height || prepared.height || 420);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context not available");
    ctx.fillStyle = "#101010";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (blob) {
      triggerDownload(blob, `${sanitizeFileName(title)}.png`);
      return;
    }
    const dataUrl = canvas.toDataURL("image/png");
    const fallbackBlob = await (await fetch(dataUrl)).blob();
    triggerDownload(fallbackBlob, `${sanitizeFileName(title)}.png`);
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

function formatDrilldownDate(ts?: number): string {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return "-";
  const d = new Date(ts);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} ${hh}:${mm}`;
}

function formatGuessDuration(sec?: number): string {
  if (typeof sec !== "number" || !Number.isFinite(sec)) return "-";
  return `${sec.toFixed(1)}s`;
}

function formatDamageValue(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  const rounded = Math.round(value);
  return `${rounded >= 0 ? "+" : ""}${rounded}`;
}

const regionNameDisplay =
  typeof Intl !== "undefined" && "DisplayNames" in Intl && typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;

function countryNameFromCode(code?: string): string {
  if (typeof code !== "string") return "-";
  const normalized = code.trim().toLowerCase();
  if (!normalized) return "-";
  if (normalized.length === 2 && regionNameDisplay) {
    try {
      const label = regionNameDisplay.of(normalized.toUpperCase());
      if (typeof label === "string" && label.trim()) return label;
    } catch {
      // fallback below
    }
  }
  return normalized.toUpperCase();
}

function shortGameId(gameId: string): string {
  if (gameId.length <= 14) return gameId;
  return `${gameId.slice(0, 8)}...`;
}

function openDrilldownOverlay(doc: Document, title: string, subtitle: string, drilldown: AnalysisDrilldownItem[]): void {
  if (drilldown.length === 0) return;
  const palette = getThemePalette();
  const overlay = doc.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,0.66)";
  overlay.style.zIndex = "2147483647";
  overlay.style.display = "flex";
  overlay.style.justifyContent = "center";
  overlay.style.alignItems = "flex-start";
  overlay.style.padding = "28px 16px";

  const card = doc.createElement("div");
  card.style.width = "min(1500px, 98vw)";
  card.style.maxHeight = "90vh";
  card.style.overflow = "auto";
  card.style.background = palette.panel;
  card.style.color = palette.text;
  card.style.border = `1px solid ${palette.border}`;
  card.style.borderRadius = "10px";
  card.style.boxShadow = "0 10px 30px rgba(0,0,0,.4)";
  card.style.padding = "10px 10px 12px";

  const header = doc.createElement("div");
  header.style.display = "flex";
  header.style.justifyContent = "space-between";
  header.style.alignItems = "center";
  header.style.marginBottom = "8px";
  const headTitle = doc.createElement("div");
  headTitle.style.fontWeight = "800";
  headTitle.style.fontSize = "14px";
  headTitle.textContent = `${title} - ${subtitle} (${drilldown.length})`;
  header.appendChild(headTitle);

  const closeBtn = doc.createElement("button");
  closeBtn.textContent = "x";
  closeBtn.style.background = "transparent";
  closeBtn.style.color = palette.textMuted;
  closeBtn.style.border = "none";
  closeBtn.style.fontSize = "18px";
  closeBtn.style.cursor = "pointer";
  closeBtn.style.lineHeight = "1";
  closeBtn.style.padding = "0 4px";
  closeBtn.addEventListener("click", () => overlay.remove());
  header.appendChild(closeBtn);
  card.appendChild(header);

  const table = doc.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";
  table.style.fontSize = "12px";
  card.appendChild(table);

  type SortKey = "date" | "round" | "score" | "country";
  type SortDir = "asc" | "desc";
  const defaultSortDir: Record<SortKey, SortDir> = {
    date: "desc",
    round: "desc",
    score: "desc",
    country: "asc"
  };
  const sortLabel = (label: string, active: boolean, dir: SortDir): string => (active ? `${label} ${dir === "asc" ? "^" : "v"}` : label);
  let sortKey: SortKey = "date";
  let sortDir: SortDir = "desc";

  const hasOpponentItems = drilldown.some((d) => typeof d.opponentId === "string" || typeof d.opponentName === "string");
  const movementValues = [...new Set(drilldown.map((d) => d.movement).filter((x): x is string => typeof x === "string" && x.trim().length > 0))];
  const modeValues = [...new Set(drilldown.map((d) => d.gameMode).filter((x): x is string => typeof x === "string" && x.trim().length > 0))];
  const showMovement = movementValues.length > 1;
  const showGameMode = modeValues.length > 1;
  const showMate = drilldown.some((d) => typeof d.teammate === "string" && d.teammate.trim().length > 0);
  const showDuration = drilldown.some((d) => typeof d.guessDurationSec === "number" && Number.isFinite(d.guessDurationSec));
  const showDamage = drilldown.some((d) => typeof d.damage === "number" && Number.isFinite(d.damage));
  const showGuessMaps = drilldown.some((d) => typeof d.googleMapsUrl === "string" && d.googleMapsUrl.length > 0);
  const showStreetView = drilldown.some((d) => typeof d.streetViewUrl === "string" && d.streetViewUrl.length > 0);

  type DrillColumn = {
    key: string;
    label: string;
    sortKey?: SortKey;
    width?: string;
    muted?: boolean;
    render: (item: AnalysisDrilldownItem) => HTMLElement;
  };

  const mkTextCell = (text: string, muted = false): HTMLElement => {
    const span = doc.createElement("span");
    span.textContent = text;
    if (muted) span.style.color = palette.textMuted;
    return span;
  };

  const mkLinkCell = (url?: string): HTMLElement => {
    if (!url) return mkTextCell("-", true);
    const a = doc.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "Open";
    a.style.color = analysisSettings.accent;
    return a;
  };

  const columns: DrillColumn[] = [{ key: "date", label: "Date", sortKey: "date", width: "160px", render: (item) => mkTextCell(formatDrilldownDate(item.ts)) }];
  if (hasOpponentItems) {
    columns.push({
      key: "opponent",
      label: "Opponent",
      width: "180px",
      render: (item) => {
        const name = item.opponentName || (item.opponentId ? shortGameId(item.opponentId) : "-");
        if (item.opponentProfileUrl) {
          const a = doc.createElement("a");
          a.href = item.opponentProfileUrl;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = name;
          a.style.color = analysisSettings.accent;
          return a;
        }
        return mkTextCell(name, !item.opponentName);
      }
    });
    columns.push({
      key: "result",
      label: "Result",
      width: "90px",
      render: (item) => {
        const txt = item.result === "W" ? "Win" : item.result === "L" ? "Loss" : item.result === "T" ? "Tie" : "-";
        return mkTextCell(txt, txt === "-");
      }
    });
    columns.push({
      key: "matchups",
      label: "Match-ups",
      width: "90px",
      render: (item) => mkTextCell(typeof item.matchups === "number" ? String(item.matchups) : "-", typeof item.matchups !== "number")
    });
    columns.push({
      key: "country",
      label: "Country",
      sortKey: "country",
      width: "160px",
      render: (item) => mkTextCell(item.opponentCountry || countryNameFromCode(item.trueCountry))
    });
    if (showGameMode) columns.push({ key: "game_mode", label: "Game Mode", width: "110px", render: (item) => mkTextCell(item.gameMode || "-", !item.gameMode) });
  } else {
    columns.push({ key: "round", label: "Round", sortKey: "round", width: "70px", render: (item) => mkTextCell(String(item.roundNumber)) });
    columns.push({ key: "score", label: "Score", sortKey: "score", width: "80px", render: (item) => mkTextCell(typeof item.score === "number" ? String(Math.round(item.score)) : "-") });
    columns.push({ key: "country", label: "Country", sortKey: "country", width: "160px", render: (item) => mkTextCell(countryNameFromCode(item.trueCountry)) });
    if (showDuration) columns.push({ key: "duration", label: "Guess Duration", width: "120px", render: (item) => mkTextCell(formatGuessDuration(item.guessDurationSec)) });
    if (showDamage) columns.push({ key: "damage", label: "Damage", width: "90px", render: (item) => mkTextCell(formatDamageValue(item.damage)) });
    if (showMovement) columns.push({ key: "movement", label: "Movement", width: "110px", render: (item) => mkTextCell(item.movement || "-", !item.movement) });
    if (showGameMode) columns.push({ key: "game_mode", label: "Game Mode", width: "110px", render: (item) => mkTextCell(item.gameMode || "-", !item.gameMode) });
    if (showMate) columns.push({ key: "mate", label: "Mate", width: "130px", render: (item) => mkTextCell(item.teammate || "-", !item.teammate) });
  }
  columns.push({
    key: "game",
    label: "Game",
    width: "120px",
    muted: true,
    render: (item) => {
      const span = mkTextCell(shortGameId(item.gameId), true);
      span.title = item.gameId;
      return span;
    }
  });
  if (!hasOpponentItems && showGuessMaps) columns.push({ key: "guess_maps", label: "Guess Maps", width: "110px", render: (item) => mkLinkCell(item.googleMapsUrl) });
  if (!hasOpponentItems && showStreetView) columns.push({ key: "street_view", label: "True Street View", width: "130px", render: (item) => mkLinkCell(item.streetViewUrl) });

  const thead = doc.createElement("thead");
  const headRow = doc.createElement("tr");
  const thBySort = new Map<SortKey, HTMLTableCellElement>();
  for (const col of columns) {
    const th = doc.createElement("th");
    th.textContent = col.label;
    th.style.textAlign = "left";
    th.style.padding = "7px 8px";
    th.style.borderBottom = `1px solid ${palette.border}`;
    th.style.color = palette.textMuted;
    th.style.position = "sticky";
    th.style.top = "0";
    th.style.background = palette.panel;
    if (col.width) th.style.minWidth = col.width;
    if (col.sortKey) {
      th.style.cursor = "pointer";
      th.style.userSelect = "none";
      thBySort.set(col.sortKey, th);
      th.addEventListener("click", () => {
        if (sortKey === col.sortKey) {
          sortDir = sortDir === "asc" ? "desc" : "asc";
        } else {
          sortKey = col.sortKey;
          sortDir = defaultSortDir[col.sortKey];
        }
        shown = 0;
        renderRows(true);
      });
    }
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = doc.createElement("tbody");
  table.appendChild(tbody);
  const getSortedItems = (): AnalysisDrilldownItem[] => {
    const items = drilldown.slice();
    items.sort((a, b) => {
      if (sortKey === "date") {
        const av = typeof a.ts === "number" ? a.ts : Number.NEGATIVE_INFINITY;
        const bv = typeof b.ts === "number" ? b.ts : Number.NEGATIVE_INFINITY;
        return sortDir === "asc" ? av - bv : bv - av;
      }
      if (sortKey === "round") {
        const av = Number.isFinite(a.roundNumber) ? a.roundNumber : Number.NEGATIVE_INFINITY;
        const bv = Number.isFinite(b.roundNumber) ? b.roundNumber : Number.NEGATIVE_INFINITY;
        return sortDir === "asc" ? av - bv : bv - av;
      }
      if (sortKey === "score") {
        const av = typeof a.score === "number" ? a.score : Number.NEGATIVE_INFINITY;
        const bv = typeof b.score === "number" ? b.score : Number.NEGATIVE_INFINITY;
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const av = (a.opponentCountry || countryNameFromCode(a.trueCountry)).toLowerCase();
      const bv = (b.opponentCountry || countryNameFromCode(b.trueCountry)).toLowerCase();
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    return items;
  };
  const updateHeaderLabels = () => {
    const dateTh = thBySort.get("date");
    const roundTh = thBySort.get("round");
    const scoreTh = thBySort.get("score");
    const countryTh = thBySort.get("country");
    if (dateTh) dateTh.textContent = sortLabel("Date", sortKey === "date", sortDir);
    if (roundTh) roundTh.textContent = sortLabel("Round", sortKey === "round", sortDir);
    if (scoreTh) scoreTh.textContent = sortLabel("Score", sortKey === "score", sortDir);
    if (countryTh) countryTh.textContent = sortLabel("Country", sortKey === "country", sortDir);
  };
  let shown = 0;
  const pageSize = 60;
  const renderRows = (resetBody = false) => {
    const sorted = getSortedItems();
    if (resetBody) tbody.innerHTML = "";
    const next = Math.min(sorted.length, shown + pageSize);
    for (let i = shown; i < next; i++) {
      const item = sorted[i];
      const tr = doc.createElement("tr");
      tr.style.borderBottom = `1px solid ${palette.border}`;
      for (const col of columns) {
        const td = doc.createElement("td");
        td.style.padding = "6px 8px";
        if (col.width) td.style.minWidth = col.width;
        if (col.muted) td.style.color = palette.textMuted;
        td.appendChild(col.render(item));
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    shown = next;
    if (shown >= sorted.length) {
      moreBtn.remove();
    } else {
      if (!moreBtn.isConnected) card.appendChild(moreBtn);
      moreBtn.textContent = `Show more (${sorted.length - shown} left)`;
    }
    updateHeaderLabels();
  };
  const moreBtn = doc.createElement("button");
  moreBtn.textContent = "";
  moreBtn.style.marginTop = "10px";
  moreBtn.style.background = palette.buttonBg;
  moreBtn.style.color = palette.buttonText;
  moreBtn.style.border = `1px solid ${palette.border}`;
  moreBtn.style.borderRadius = "6px";
  moreBtn.style.padding = "5px 10px";
  moreBtn.style.cursor = "pointer";
  moreBtn.style.fontSize = "12px";
  moreBtn.addEventListener("click", () => renderRows(false));
  card.appendChild(moreBtn);
  renderRows(true);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) overlay.remove();
  });
  overlay.appendChild(card);
  doc.body.appendChild(overlay);
}
function openBarDrilldownOverlay(doc: Document, title: string, barLabel: string, bars: AnalysisBarPoint[], barIndex: number): void {
  const bar = bars[barIndex];
  const drilldown = bar?.drilldown || [];
  if (!bar || drilldown.length === 0) return;
  openDrilldownOverlay(doc, title, barLabel, drilldown);
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

  const colorPalette = [
    analysisSettings.accent,
    "#ff6b6b",
    "#22c55e",
    "#f59e0b",
    "#a78bfa",
    "#06b6d4",
    "#f97316",
    "#84cc16",
    "#e879f9",
    "#60a5fa"
  ];
  const baseSeries =
    chart.series && chart.series.length > 0
      ? chart.series
      : [{ key: "main", label: chart.yLabel || title, points: chart.points }];
  const series = baseSeries
    .map((s, idx) => ({
      ...s,
      color: colorPalette[idx % colorPalette.length],
      points: aggregateLinePoints(s.points)
    }))
    .filter((s) => s.points.length > 1);
  if (series.length === 0) return chartWrap;

  const allPoints = series.flatMap((s) => s.points);
  const w = 1500;
  const h = 300;
  const ml = 60;
  const mr = 20;
  const mt = 16;
  const mb = 42;
  const minX = Math.min(...allPoints.map((p) => p.x));
  const maxX = Math.max(...allPoints.map((p) => p.x));
  const minY = Math.min(...allPoints.map((p) => p.y));
  const maxY = Math.max(...allPoints.map((p) => p.y));
  const xSpan = Math.max(1, maxX - minX);
  const ySpan = Math.max(1, maxY - minY);
  const mapX = (x: number) => ml + ((x - minX) / xSpan) * (w - ml - mr);
  const mapY = (y: number) => h - mb - ((y - minY) / ySpan) * (h - mt - mb);

  let lineMarkup = "";
  let pointMarkup = "";
  for (let i = 0; i < series.length; i++) {
    const s = series[i];
    const poly = s.points.map((p) => `${mapX(p.x).toFixed(2)},${mapY(p.y).toFixed(2)}`).join(" ");
    lineMarkup += `<polyline class="ga-line-main ga-line-${i}" fill="none" stroke="${s.color}" stroke-width="${
      series.length > 1 ? 2.4 : 3
    }" points="${poly}"><title>${escapeSvgText(`${s.label} (${title})`)}</title></polyline>`;
    pointMarkup += s.points
      .map((p) => {
        const x = mapX(p.x).toFixed(2);
        const y = mapY(p.y).toFixed(2);
        const label = p.label ? `${p.label} - ` : "";
        const value = Number.isFinite(p.y) ? (Math.abs(p.y) >= 100 ? p.y.toFixed(1) : p.y.toFixed(2)) : String(p.y);
        const tip = escapeSvgText(`${s.label}: ${label}${value}`);
        return `<circle class="ga-line-point ga-line-point-${i}" cx="${x}" cy="${y}" r="${
          series.length > 1 ? 2 : 2.5
        }" fill="${s.color}"><title>${tip}</title></circle>`;
      })
      .join("");
  }

  const yMid = (minY + maxY) / 2;
  const startCandidates = allPoints.filter((p) => p.x === minX);
  const endCandidates = allPoints.filter((p) => p.x === maxX);
  const xStartLabel = startCandidates.find((p) => p.label)?.label || "";
  const xEndLabel = endCandidates.find((p) => p.label)?.label || "";
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "300");
  svg.innerHTML = `
    <style>
      .ga-line-main { transition: stroke-width .12s ease, opacity .12s ease; }
      .ga-line-main:hover { stroke-width: 4; opacity: 1; }
      .ga-line-point { transition: r .12s ease, opacity .12s ease; opacity: .72; }
      .ga-line-point:hover { r: 5; opacity: 1; }
    </style>
    <line x1="${ml}" y1="${h - mb}" x2="${w - mr}" y2="${h - mb}" stroke="${palette.axis}" stroke-width="1"/>
    <line x1="${ml}" y1="${mt}" x2="${ml}" y2="${h - mb}" stroke="${palette.axis}" stroke-width="1"/>
    ${lineMarkup}
    ${pointMarkup}
    <text x="${ml - 6}" y="${mapY(maxY) + 4}" text-anchor="end" font-size="10" fill="${palette.textMuted}">${Math.round(maxY)}</text>
    <text x="${ml - 6}" y="${mapY(yMid) + 4}" text-anchor="end" font-size="10" fill="${palette.textMuted}">${Math.round(yMid)}</text>
    <text x="${ml - 6}" y="${mapY(minY) + 4}" text-anchor="end" font-size="10" fill="${palette.textMuted}">${Math.round(minY)}</text>
    <text x="${ml}" y="${h - 8}" text-anchor="start" font-size="12" fill="${palette.textMuted}">${xStartLabel}</text>
    <text x="${w - mr}" y="${h - 8}" text-anchor="end" font-size="12" fill="${palette.textMuted}">${xEndLabel}</text>
  `;
  chartWrap.appendChild(createChartActions(svg, title));
  chartWrap.appendChild(svg);
  if (series.length > 1) {
    const legend = doc.createElement("div");
    legend.style.display = "flex";
    legend.style.flexWrap = "wrap";
    legend.style.gap = "8px 12px";
    legend.style.margin = "6px 4px 2px";
    for (const s of series) {
      const item = doc.createElement("div");
      item.style.display = "inline-flex";
      item.style.alignItems = "center";
      item.style.gap = "6px";
      item.style.fontSize = "11px";
      item.style.color = palette.textMuted;
      const swatch = doc.createElement("span");
      swatch.style.width = "10px";
      swatch.style.height = "10px";
      swatch.style.borderRadius = "2px";
      swatch.style.background = s.color;
      item.appendChild(swatch);
      item.appendChild(doc.createTextNode(s.label));
      legend.appendChild(item);
    }
    chartWrap.appendChild(legend);
  }
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
  const isScoreDistribution = /score distribution/i.test(title);
  const initialBars = Math.max(1, Math.min(chart.initialBars ?? 40, allBars.length || 1));
  let expanded = isScoreDistribution ? true : allBars.length <= initialBars;
  const content = doc.createElement("div");
  chartWrap.appendChild(content);

  const render = () => {
    content.innerHTML = "";
    const bars = expanded ? allBars : allBars.slice(0, initialBars);
    const horizontal = chart.orientation === "horizontal" || /avg score by country/i.test(title);
    const w = 1700;
    const accent = analysisSettings.accent;
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "100%");
    if (horizontal) {
      const rowH = 16;
      const barH = 14;
      const ml = 250;
      const mr = 22;
      const mt = 6;
      const mb = 10;
      const contentHeight = mt + mb + bars.length * rowH;
      const defaultMinHeight = Math.max(80, contentHeight);
      const requestedMinHeight = (chart as Extract<AnalysisChart, { type: "bar" }>).minHeight;
      const h = Math.max(typeof requestedMinHeight === "number" ? requestedMinHeight : defaultMinHeight, contentHeight);
      const maxY = Math.max(1, ...bars.map((b) => b.value));
      const innerW = w - ml - mr;
      const rects = bars
        .map((b, i) => {
          const y = mt + i * rowH + (rowH - barH) / 2;
          const bw = (b.value / maxY) * innerW;
          const label = b.label.length > 34 ? `${b.label.slice(0, 34)}..` : b.label;
          const tip = escapeSvgText(`${b.label}: ${Number.isFinite(b.value) ? b.value.toFixed(2) : b.value}`);
          return `
            <text x="${ml - 8}" y="${(y + barH / 2 + 3).toFixed(2)}" text-anchor="end" font-size="11" fill="${palette.textMuted}">${label}</text>
            <rect class="ga-bar" data-bar-index="${i}" x="${ml}" y="${y.toFixed(2)}" width="${bw.toFixed(2)}" height="${barH}" fill="${accent}" opacity="0.85">
              <title>${tip}</title>
            </rect>
          `;
        })
        .join("");
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      svg.setAttribute("height", `${h}`);
      svg.innerHTML = `
        <style>
          .ga-bar { transition: opacity .12s ease, filter .12s ease; }
          .ga-bar:hover { opacity: 1; filter: brightness(1.15); }
        </style>
        <line x1="${ml}" y1="${mt}" x2="${ml}" y2="${h - mb}" stroke="${palette.axis}" stroke-width="1"/>
        <line x1="${ml}" y1="${h - mb}" x2="${w - mr}" y2="${h - mb}" stroke="${palette.axis}" stroke-width="1"/>
        <text x="${ml}" y="${h - 4}" text-anchor="start" font-size="10" fill="${palette.textMuted}">0</text>
        <text x="${w - mr}" y="${h - 4}" text-anchor="end" font-size="10" fill="${palette.textMuted}">${Math.round(maxY)}</text>
        ${rects}
      `;
    } else {
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
      const rects = bars
        .map((b, i) => {
          const x = ml + i * step + (step - bw) / 2;
          const bh = (b.value / maxY) * innerH;
          const y = mt + innerH - bh;
          const label = isScoreDistribution ? (i === 0 ? "0" : i === bars.length - 1 ? "5000" : "") : b.label.length > 14 ? `${b.label.slice(0, 14)}..` : b.label;
          const tip = escapeSvgText(`${b.label}: ${Number.isFinite(b.value) ? b.value.toFixed(2) : b.value}`);
          return `
            <rect class="ga-bar" data-bar-index="${i}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${bw.toFixed(2)}" height="${bh.toFixed(2)}" fill="${accent}" opacity="0.85">
              <title>${tip}</title>
            </rect>
            <text x="${(x + bw / 2).toFixed(2)}" y="${h - mb + 16}" text-anchor="middle" font-size="11" fill="${palette.textMuted}">${label}</text>
          `;
        })
        .join("");
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      svg.setAttribute("height", "320");
      svg.innerHTML = `
        <style>
          .ga-bar { transition: opacity .12s ease, filter .12s ease; }
          .ga-bar:hover { opacity: 1; filter: brightness(1.15); }
        </style>
        <line x1="${ml}" y1="${h - mb}" x2="${w - mr}" y2="${h - mb}" stroke="${palette.axis}" stroke-width="1"/>
        <line x1="${ml}" y1="${mt}" x2="${ml}" y2="${h - mb}" stroke="${palette.axis}" stroke-width="1"/>
        <text x="${ml - 5}" y="${mt + 4}" text-anchor="end" font-size="10" fill="${palette.textMuted}">${Math.round(maxY)}</text>
        <text x="${ml - 5}" y="${h - mb + 4}" text-anchor="end" font-size="10" fill="${palette.textMuted}">0</text>
        ${rects}
      `;
    }
    content.appendChild(createChartActions(svg, title));
    if (!isScoreDistribution && allBars.length > initialBars) {
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
    const clickableBars = svg.querySelectorAll<SVGRectElement>(".ga-bar[data-bar-index]");
    clickableBars.forEach((rect) => {
      const idx = Number(rect.getAttribute("data-bar-index"));
      const bar = bars[idx];
      if (!Number.isFinite(idx) || !bar || !bar.drilldown || bar.drilldown.length === 0) return;
      rect.style.cursor = "pointer";
      rect.addEventListener("click", () => openBarDrilldownOverlay(doc, title, bar.label, bars, idx));
    });
  };
  render();
  return chartWrap;
}

function renderSelectableBarChart(chart: Extract<AnalysisChart, { type: "selectableBar" }>, title: string, doc: Document): HTMLElement {
  const palette = getThemePalette();
  const allowSort = chart.allowSort !== false;
  const wrap = doc.createElement("div");
  wrap.style.marginBottom = "8px";
  wrap.style.border = `1px solid ${palette.border}`;
  wrap.style.borderRadius = "8px";
  wrap.style.background = palette.panelAlt;
  wrap.style.padding = "6px";

  const head = doc.createElement("div");
  head.style.display = "flex";
  head.style.flexWrap = "wrap";
  head.style.alignItems = "center";
  head.style.gap = "8px";
  head.style.margin = "2px 4px 6px";
  wrap.appendChild(head);

  const heading = doc.createElement("div");
  heading.textContent = title;
  heading.style.fontSize = "12px";
  heading.style.fontWeight = "700";
  heading.style.color = palette.textMuted;
  head.appendChild(heading);

  const metricSelect = doc.createElement("select");
  metricSelect.style.background = palette.buttonBg;
  metricSelect.style.color = palette.buttonText;
  metricSelect.style.border = `1px solid ${palette.border}`;
  metricSelect.style.borderRadius = "7px";
  metricSelect.style.padding = "2px 6px";
  metricSelect.style.fontSize = "11px";
  for (const o of chart.options) {
    const opt = doc.createElement("option");
    opt.value = o.key;
    opt.textContent = o.label;
    metricSelect.appendChild(opt);
  }
  metricSelect.value = chart.defaultMetricKey && chart.options.some((o) => o.key === chart.defaultMetricKey) ? chart.defaultMetricKey : chart.options[0]?.key || "";
  head.appendChild(metricSelect);

  let sortSelect: HTMLSelectElement | null = null;
  if (allowSort) {
    sortSelect = doc.createElement("select");
    sortSelect.style.background = palette.buttonBg;
    sortSelect.style.color = palette.buttonText;
    sortSelect.style.border = `1px solid ${palette.border}`;
    sortSelect.style.borderRadius = "7px";
    sortSelect.style.padding = "2px 6px";
    sortSelect.style.fontSize = "11px";
    for (const key of ["chronological", "desc", "asc"] as const) {
      const opt = doc.createElement("option");
      opt.value = key;
      opt.textContent = key === "chronological" ? "Chronological" : key === "desc" ? "Descending" : "Ascending";
      sortSelect.appendChild(opt);
    }
    sortSelect.value = chart.defaultSort || "chronological";
    head.appendChild(sortSelect);
  }

  const content = doc.createElement("div");
  wrap.appendChild(content);

  const render = () => {
    content.innerHTML = "";
    const selected = chart.options.find((o) => o.key === metricSelect.value) || chart.options[0];
    if (!selected) return;
    let bars = selected.bars.slice();
    if (allowSort && sortSelect?.value === "desc") bars.sort((a, b) => b.value - a.value);
    else if (allowSort && sortSelect?.value === "asc") bars.sort((a, b) => a.value - b.value);
    const barChart: Extract<AnalysisChart, { type: "bar" }> = {
      type: "bar",
      yLabel: selected.label,
      initialBars: chart.initialBars ?? 10,
      orientation: chart.orientation || "horizontal",
      minHeight: chart.minHeight,
      bars
    };
    content.appendChild(renderBarChart(barChart, `${title} - ${selected.label}`, doc));
  };

  metricSelect.addEventListener("change", render);
  if (sortSelect) sortSelect.addEventListener("change", render);
  render();
  return wrap;
}

function renderSelectableLineChart(chart: Extract<AnalysisChart, { type: "selectableLine" }>, title: string, doc: Document): HTMLElement {
  const palette = getThemePalette();
  const maxCompare = Math.max(1, Math.min(chart.maxCompare ?? 4, 4));
  const wrap = doc.createElement("div");
  wrap.style.marginBottom = "8px";
  wrap.style.border = `1px solid ${palette.border}`;
  wrap.style.borderRadius = "8px";
  wrap.style.background = palette.panelAlt;
  wrap.style.padding = "6px";

  const head = doc.createElement("div");
  head.style.display = "flex";
  head.style.flexWrap = "wrap";
  head.style.alignItems = "center";
  head.style.gap = "8px";
  head.style.margin = "2px 4px 6px";
  wrap.appendChild(head);

  const heading = doc.createElement("div");
  heading.textContent = title;
  heading.style.fontSize = "12px";
  heading.style.fontWeight = "700";
  heading.style.color = palette.textMuted;
  head.appendChild(heading);

  const metricSelect = doc.createElement("select");
  metricSelect.style.background = palette.buttonBg;
  metricSelect.style.color = palette.buttonText;
  metricSelect.style.border = `1px solid ${palette.border}`;
  metricSelect.style.borderRadius = "7px";
  metricSelect.style.padding = "2px 6px";
  metricSelect.style.fontSize = "11px";
  for (const o of chart.options) {
    const opt = doc.createElement("option");
    opt.value = o.key;
    opt.textContent = o.label;
    metricSelect.appendChild(opt);
  }
  metricSelect.value = chart.defaultMetricKey && chart.options.some((o) => o.key === chart.defaultMetricKey) ? chart.defaultMetricKey : chart.options[0]?.key || "";
  head.appendChild(metricSelect);

  const compareSelectors: HTMLSelectElement[] = [];
  const defaultCompare = (chart.defaultCompareKeys || []).slice(0, maxCompare);
  for (let i = 0; i < maxCompare; i++) {
    const sel = doc.createElement("select");
    sel.style.background = palette.buttonBg;
    sel.style.color = palette.buttonText;
    sel.style.border = `1px solid ${palette.border}`;
    sel.style.borderRadius = "7px";
    sel.style.padding = "2px 6px";
    sel.style.fontSize = "11px";
    const noneOpt = doc.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = i === 0 ? "Compare country" : `Compare country ${i + 1}`;
    sel.appendChild(noneOpt);
    for (const c of chart.compareCandidates) {
      const opt = doc.createElement("option");
      opt.value = c.key;
      opt.textContent = c.label;
      sel.appendChild(opt);
    }
    sel.value = defaultCompare[i] || "";
    compareSelectors.push(sel);
    head.appendChild(sel);
  }

  const content = doc.createElement("div");
  wrap.appendChild(content);

  const render = () => {
    content.innerHTML = "";
    const selectedMetric = chart.options.find((o) => o.key === metricSelect.value) || chart.options[0];
    if (!selectedMetric) return;
    const keyOrder = [chart.primaryKey, ...compareSelectors.map((s) => s.value).filter((v) => v !== "")];
    const uniqueKeys: string[] = [];
    for (const key of keyOrder) {
      if (!uniqueKeys.includes(key)) uniqueKeys.push(key);
    }
    const series = uniqueKeys
      .map((key) => selectedMetric.series.find((s) => s.key === key))
      .filter((s): s is NonNullable<typeof s> => !!s);
    if (series.length === 0) return;
    const lineChart: Extract<AnalysisChart, { type: "line" }> = {
      type: "line",
      yLabel: selectedMetric.label,
      points: series[0].points,
      series
    };
    content.appendChild(renderLineChart(lineChart, `${title} - ${selectedMetric.label}`, doc));
  };

  metricSelect.addEventListener("change", render);
  for (const sel of compareSelectors) sel.addEventListener("change", render);
  render();
  return wrap;
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
    modalTitle: HTMLDivElement;
    controls: HTMLDivElement;
    fromInput: HTMLInputElement;
    toInput: HTMLInputElement;
    modeSelect: HTMLSelectElement;
    movementSelect: HTMLSelectElement;
    teammateSelect: HTMLSelectElement;
    countrySelect: HTMLSelectElement;
    themeSelect: HTMLSelectElement;
    colorInput: HTMLInputElement;
    tocWrap: HTMLDivElement;
    modalBody: HTMLDivElement;
  };

  const ANALYSIS_ROOT_ID = "geoanalyzr-analysis-root";
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
    styleInput(refs.movementSelect);
    styleInput(refs.teammateSelect);
    styleInput(refs.countrySelect);
    styleInput(refs.themeSelect);
    refs.colorInput.style.border = `1px solid ${palette.border}`;
    refs.colorInput.style.background = palette.panelAlt;
  }

  function createSectionIcon(section: AnalysisSection, doc: Document): HTMLElement {
    const palette = getThemePalette();
    const wrap = doc.createElement("span");
    wrap.style.display = "inline-flex";
    wrap.style.alignItems = "center";
    wrap.style.justifyContent = "center";
    wrap.style.width = "14px";
    wrap.style.height = "14px";
    wrap.style.flex = "0 0 auto";
    const stroke = palette.buttonText;
    const title = section.title.toLowerCase();
    const svgBase = (paths: string) =>
      `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
    if (title.includes("overview")) wrap.innerHTML = svgBase('<path d="M3 12l9-9 9 9"/><path d="M9 21V9h6v12"/>');
    else if (title.includes("mode") || title.includes("movement")) wrap.innerHTML = svgBase('<path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h7"/>');
    else if (title.includes("results")) wrap.innerHTML = svgBase('<path d="M3 17l6-6 4 4 8-8"/><path d="M18 7h3v3"/>');
    else if (title.includes("sessions")) wrap.innerHTML = svgBase('<circle cx="12" cy="12" r="8"/><path d="M12 8v5"/><path d="M12 12l3 2"/>');
    else if (title.includes("time patterns")) wrap.innerHTML = svgBase('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4"/><path d="M16 3v4"/><path d="M4 10h16"/>');
    else if (title.includes("tempo")) wrap.innerHTML = svgBase('<path d="M4 14a8 8 0 1 1 16 0"/><path d="M12 14l4-4"/><path d="M12 14h0"/>');
    else if (title.includes("scores")) wrap.innerHTML = svgBase('<path d="M4 20V8"/><path d="M10 20V4"/><path d="M16 20v-9"/><path d="M22 20v-6"/>');
    else if (title.includes("rounds")) wrap.innerHTML = svgBase('<path d="M4 12h16"/><path d="M4 7h16"/><path d="M4 17h16"/><circle cx="7" cy="7" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="17" cy="17" r="1"/>');
    else if (title.includes("countries") || title.includes("country spotlight")) wrap.innerHTML = svgBase('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/>');
    else if (title.includes("opponents")) wrap.innerHTML = svgBase('<circle cx="8" cy="9" r="2.5"/><circle cx="16" cy="9" r="2.5"/><path d="M3 18c.8-2.5 2.8-4 5-4s4.2 1.5 5 4"/><path d="M11 18c.8-2.5 2.8-4 5-4s4.2 1.5 5 4"/>');
    else if (title === "rating" || title.includes("rating")) wrap.innerHTML = svgBase('<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.4 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>');
    else if (title.includes("team")) wrap.innerHTML = svgBase('<circle cx="9" cy="8" r="2.5"/><circle cx="15" cy="8" r="2.5"/><path d="M4 18c1-3 3-4.5 5-4.5s4 1.5 5 4.5"/><path d="M10 18c1-3 3-4.5 5-4.5s4 1.5 5 4.5"/>');
    else if (title.includes("personal records")) wrap.innerHTML = svgBase('<path d="M8 4h8v4a4 4 0 0 1-8 0z"/><path d="M10 14h4"/><path d="M9 18h6"/>');
    else wrap.innerHTML = svgBase('<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><circle cx="12" cy="16" r="1"/>');
    return wrap;
  }

  function populateAnalysisWindow(data: AnalysisWindowData) {
    const refs = analysisWindow;
    if (!refs || refs.win.closed) return;
    const palette = getThemePalette();
    const windowTitle = data.playerName
      ? `GeoAnalyzr - Full Analysis for ${data.playerName}`
      : "GeoAnalyzr - Full Analysis";
    refs.doc.title = windowTitle;
    refs.modalTitle.textContent = windowTitle;

    const { fromInput, toInput, modeSelect, movementSelect, teammateSelect, countrySelect, modalBody, tocWrap, doc } = refs;
    if (!fromInput.value && data.minPlayedAt) fromInput.value = isoDateLocal(data.minPlayedAt);
    if (!toInput.value && data.maxPlayedAt) toInput.value = isoDateLocal(data.maxPlayedAt);

    const prevMode = modeSelect.value || "all";
    const prevMovement = movementSelect.value || "all";
    const prevTeammate = teammateSelect.value || "all";
    const prevCountry = countrySelect.value || "all";

    modeSelect.innerHTML = "";
    for (const mode of data.availableGameModes) {
      const opt = doc.createElement("option");
      opt.value = mode;
      opt.textContent = gameModeSelectLabel(mode);
      modeSelect.appendChild(opt);
    }
    if ([...modeSelect.options].some((o) => o.value === prevMode)) modeSelect.value = prevMode;

    movementSelect.innerHTML = "";
    for (const movement of data.availableMovementTypes) {
      const opt = doc.createElement("option");
      opt.value = movement.key;
      opt.textContent = movement.label;
      movementSelect.appendChild(opt);
    }
    if ([...movementSelect.options].some((o) => o.value === prevMovement)) movementSelect.value = prevMovement;

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

    tocWrap.innerHTML = "";
    for (const section of data.sections) {
      const b = doc.createElement("button");
      b.style.background = palette.buttonBg;
      b.style.color = palette.buttonText;
      b.style.border = `1px solid ${palette.border}`;
      b.style.borderRadius = "999px";
      b.style.padding = "4px 9px";
      b.style.cursor = "pointer";
      b.style.fontSize = "11px";
      b.style.fontWeight = "700";
      b.style.display = "inline-flex";
      b.style.alignItems = "center";
      b.style.gap = "6px";
      b.appendChild(createSectionIcon(section, doc));
      const label = doc.createElement("span");
      if (section.id === "teammate_battle") label.textContent = "Team";
      else if (section.id === "country_spotlight") label.textContent = "Country Spotlight";
      else label.textContent = section.title;
      b.appendChild(label);
      b.addEventListener("click", () => {
        const id = `section-${section.id}`;
        const node = doc.getElementById(id);
        if (node) node.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      tocWrap.appendChild(b);
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

  function hasAnalysisShell(refs: AnalysisWindowRefs): boolean {
    try {
      return !!refs.doc.getElementById(ANALYSIS_ROOT_ID);
    } catch {
      return false;
    }
  }

  function ensureAnalysisWindow(): AnalysisWindowRefs | null {
    if (analysisWindow && !analysisWindow.win.closed && canAccessWindow(analysisWindow.win)) {
      if (hasAnalysisShell(analysisWindow)) {
        analysisWindow.win.focus();
        return analysisWindow;
      }
      try {
        analysisWindow.win.close();
      } catch {
      }
      analysisWindow = null;
    }

    let win = window.open("about:blank", "_blank");
    if (!canAccessWindow(win)) return null;
    const doc = win.document;
    doc.open();
    doc.write("<!doctype html><html><head><meta charset=\"utf-8\"><title>GeoAnalyzr - Full Analysis</title></head><body></body></html>");
    doc.close();
    if (!doc.body) return null;
    const palette = getThemePalette();
    doc.title = "GeoAnalyzr - Full Analysis";
    doc.body.innerHTML = "";
    doc.body.style.margin = "0";
    doc.body.style.background = palette.bg;
    doc.body.style.color = palette.text;
    doc.body.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial";

    const shell = doc.createElement("div");
    shell.id = ANALYSIS_ROOT_ID;
    shell.style.display = "grid";
    shell.style.gridTemplateRows = "auto auto auto 1fr";
    shell.style.height = "100vh";

    const modalHead = doc.createElement("div");
    modalHead.style.display = "flex";
    modalHead.style.justifyContent = "space-between";
    modalHead.style.alignItems = "center";
    modalHead.style.padding = "12px 14px";
    modalHead.style.borderBottom = `1px solid ${palette.border}`;
    const modalTitle = doc.createElement("div");
    modalTitle.style.fontWeight = "700";
    modalTitle.textContent = "GeoAnalyzr - Full Analysis";
    modalHead.appendChild(modalTitle);
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
    controls.style.flexWrap = "nowrap";
    controls.style.whiteSpace = "nowrap";
    controls.style.overflowX = "auto";
    controls.style.overflowY = "hidden";
    controls.style.background = palette.bg;

    const fromInput = doc.createElement("input");
    fromInput.type = "date";
    styleInput(fromInput);

    const toInput = doc.createElement("input");
    toInput.type = "date";
    styleInput(toInput);

    const modeSelect = doc.createElement("select");
    styleInput(modeSelect);

    const movementSelect = doc.createElement("select");
    styleInput(movementSelect);

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
    controls.appendChild(doc.createTextNode("Game Mode:"));
    controls.appendChild(modeSelect);
    controls.appendChild(doc.createTextNode("Movement:"));
    controls.appendChild(movementSelect);
    controls.appendChild(doc.createTextNode("Teammate:"));
    controls.appendChild(teammateSelect);
    controls.appendChild(doc.createTextNode("Country:"));
    controls.appendChild(countrySelect);
    controls.appendChild(applyBtn);
    controls.appendChild(resetFilterBtn);
    controls.appendChild(themeSelect);
    controls.appendChild(colorInput);

    const tocWrap = doc.createElement("div");
    tocWrap.style.display = "flex";
    tocWrap.style.flexWrap = "wrap";
    tocWrap.style.gap = "6px";
    tocWrap.style.padding = "6px 12px 8px";
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
    const toMovementType = (value: string): "all" | "moving" | "no_move" | "nmpz" | "unknown" => {
      if (value === "moving" || value === "no_move" || value === "nmpz" || value === "unknown" || value === "all") {
        return value;
      }
      return "all";
    };

    applyBtn.addEventListener("click", () => {
      refreshAnalysisHandler?.({
        fromTs: parseDateInput(fromInput.value, false),
        toTs: parseDateInput(toInput.value, true),
        gameMode: modeSelect.value || "all",
        movementType: toMovementType(movementSelect.value || "all"),
        teammateId: teammateSelect.value || "all",
        country: countrySelect.value || "all"
      });
    });
    resetFilterBtn.addEventListener("click", () => {
      fromInput.value = "";
      toInput.value = "";
      modeSelect.value = "all";
      movementSelect.value = "all";
      teammateSelect.value = "all";
      countrySelect.value = "all";
      refreshAnalysisHandler?.({ gameMode: "all", movementType: "all", teammateId: "all", country: "all" });
    });

    themeSelect.addEventListener("change", () => {
      analysisSettings.theme = themeSelect.value === "light" ? "light" : "dark";
      saveAnalysisSettings();
      if (analysisWindow) {
        applyThemeToWindow(analysisWindow);
        if (lastAnalysisData) populateAnalysisWindow(lastAnalysisData);
      }
    });
    colorInput.addEventListener("input", () => {
      analysisSettings.accent = normalizeAccent(colorInput.value);
      saveAnalysisSettings();
      if (lastAnalysisData) populateAnalysisWindow(lastAnalysisData);
    });
    analysisWindow = {
      win,
      doc,
      shell,
      modalTitle,
      controls,
      fromInput,
      toInput,
      modeSelect,
      movementSelect,
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
  let refreshAnalysisHandler: ((
    filter: {
      fromTs?: number;
      toTs?: number;
      gameMode?: string;
      movementType?: "all" | "moving" | "no_move" | "nmpz" | "unknown";
      teammateId?: string;
      country?: string;
    }
  ) => void) | null = null;

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
    const body = doc.createElement("div");
    body.style.display = "grid";
    body.style.gap = "8px";
    body.style.marginBottom = "10px";
    body.style.marginTop = "2px";
    const lineDrillMap = new Map((section.lineDrilldowns || []).map((d) => [d.lineLabel, d.items]));
    const lineLinkMap = new Map((section.lineLinks || []).map((d) => [d.lineLabel, d.url]));
    const createLineRow = (line: string): HTMLDivElement => {
      const row = doc.createElement("div");
      row.style.padding = "9px 11px";
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.justifyContent = "space-between";
      row.style.gap = "12px";

      const sep = line.indexOf(":");
      if (sep > 0 && sep < line.length - 1) {
        const leftLabel = line.slice(0, sep).trim();
        const leftUrl = lineLinkMap.get(leftLabel);
        const left = leftUrl ? doc.createElement("a") : doc.createElement("span");
        left.textContent = leftLabel;
        left.style.fontSize = "13px";
        left.style.fontWeight = "600";
        left.style.color = leftUrl ? analysisSettings.accent : palette.textMuted;
        left.style.letterSpacing = "0.15px";
        if (leftUrl) {
          (left as HTMLAnchorElement).href = leftUrl;
          (left as HTMLAnchorElement).target = "_blank";
          (left as HTMLAnchorElement).rel = "noopener noreferrer";
        }

        const right = doc.createElement("span");
        right.textContent = line.slice(sep + 1).trim();
        right.style.fontSize = "14px";
        right.style.fontWeight = "700";
        right.style.color = palette.text;
        right.style.textAlign = "right";
        right.style.marginLeft = "auto";
        right.style.maxWidth = "68%";
        right.style.padding = "2px 8px";
        right.style.borderRadius = "999px";
        right.style.background = "rgba(255,255,255,0.08)";
        const drillItems = lineDrillMap.get(leftLabel) || [];
        if (drillItems.length > 0) {
          right.style.cursor = "pointer";
          right.style.textDecoration = "underline";
          right.title = `Open ${drillItems.length} matching rounds`;
          right.addEventListener("click", () => openDrilldownOverlay(doc, section.title, leftLabel, drillItems));
        }

        row.appendChild(left);
        row.appendChild(right);
      } else {
        const only = doc.createElement("span");
        only.textContent = line;
        only.style.fontSize = "13px";
        only.style.fontWeight = "600";
        only.style.color = palette.text;
        only.style.letterSpacing = "0.1px";
        row.appendChild(only);
      }
      return row;
    };

    const createStandaloneCard = (line: string): HTMLDivElement => {
      const row = createLineRow(line);
      row.style.border = `1px solid ${palette.border}`;
      row.style.background = palette.panelAlt;
      row.style.borderRadius = "8px";
      row.style.boxShadow = "inset 2px 0 0 rgba(255,255,255,0.08)";
      return row;
    };

    for (let i = 0; i < section.lines.length; i++) {
      const line = section.lines[i];
      const isGroupHeader = /:\s*$/.test(line);
      if (!isGroupHeader || i === section.lines.length - 1) {
        body.appendChild(createStandaloneCard(line));
        continue;
      }

      let end = i + 1;
      while (end < section.lines.length && !/:\s*$/.test(section.lines[end])) {
        end++;
      }

      const groupCard = doc.createElement("div");
      groupCard.style.border = `1px solid ${palette.border}`;
      groupCard.style.background = palette.panelAlt;
      groupCard.style.borderRadius = "8px";
      groupCard.style.boxShadow = "inset 2px 0 0 rgba(255,255,255,0.08)";
      groupCard.style.overflow = "hidden";

      const header = doc.createElement("div");
      header.textContent = line;
      header.style.padding = "9px 11px";
      header.style.fontSize = "13px";
      header.style.fontWeight = "700";
      header.style.color = palette.text;
      groupCard.appendChild(header);

      for (let j = i + 1; j < end; j++) {
        const itemRow = createLineRow(section.lines[j]);
        itemRow.style.borderTop = `1px solid ${palette.border}`;
        groupCard.appendChild(itemRow);
      }

      body.appendChild(groupCard);
      i = end - 1;
    }
    card.appendChild(topMeta);
    card.appendChild(title2);
    card.appendChild(body);

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
      if (chart.type === "selectableBar" && chart.options.length > 0) {
        card.appendChild(renderSelectableBarChart(chart, chartTitle, doc));
      }
      if (chart.type === "selectableLine" && chart.options.length > 0) {
        card.appendChild(renderSelectableLineChart(chart, chartTitle, doc));
      }
    }
    return card;
  }

  function showNcfaManagerModal(options: {
    initialToken?: string;
    helpText: string;
    repoUrl: string;
    onSave: (token: string) => Promise<{ saved: boolean; token?: string; message: string }>;
    onAutoDetect: () => Promise<{ detected: boolean; token?: string; source?: "stored" | "cookie" | "session" | "none"; message: string }>;
  }) {
    const dark = {
      panel: "#111827",
      panelAlt: "#0b1220",
      border: "#334155",
      text: "#e5e7eb",
      textMuted: "#93a4bc"
    };
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
    modal.style.border = `1px solid ${dark.border}`;
    modal.style.borderRadius = "12px";
    modal.style.background = dark.panel;
    modal.style.color = dark.text;
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
    closeBtn2.style.color = dark.text;
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
    input.style.background = dark.panelAlt;
    input.style.color = dark.text;
    input.style.border = `1px solid ${dark.border}`;
    input.style.borderRadius = "8px";
    input.style.padding = "8px 10px";
    input.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    input.style.fontSize = "12px";

    const feedback = document.createElement("div");
    feedback.style.marginTop = "8px";
    feedback.style.fontSize = "12px";
    feedback.style.color = dark.textMuted;
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
    hint.style.color = dark.textMuted;
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

