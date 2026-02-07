import { AnalysisSection } from "./analysis";

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
  setAnalysisWindowData: (data: {
    sections: AnalysisSection[];
    availableModes: string[];
    minPlayedAt?: number;
    maxPlayedAt?: number;
  }) => void;
  onUpdateClick: (fn: () => void) => void;
  onResetClick: (fn: () => void) => void;
  onExportClick: (fn: () => void) => void;
  onTokenClick: (fn: () => void) => void;
  onOpenAnalysisClick: (fn: () => void) => void;
  onRefreshAnalysisClick: (fn: (filter: { fromTs?: number; toTs?: number; mode?: string }) => void) => void;
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

export function createUI(): UIHandle {
  const iconBtn = document.createElement("button");
  iconBtn.title = "GeoGuessr Analyzer";
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
  title.textContent = "GeoGuessr Analyzer";
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

  const updateBtn = mkBtn("Update", "rgba(255,255,255,0.10)");
  const analysisBtn = mkBtn("Open Analysis Window", "rgba(35,95,160,0.28)");
  const tokenBtn = mkBtn("Set NCFA Token", "rgba(95,95,30,0.35)");
  tokenBtn.style.marginTop = "0";
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
  const resetBtn = mkBtn("Reset DB", "rgba(160,35,35,0.35)");

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
  tokenRow.style.marginTop = "8px";
  tokenRow.appendChild(tokenBtn);
  tokenRow.appendChild(tokenHelpBtn);
  panel.appendChild(tokenRow);
  panel.appendChild(exportBtn);
  panel.appendChild(resetBtn);
  panel.appendChild(counts);

  // Opaque analysis modal
  const modalBackdrop = document.createElement("div");
  modalBackdrop.style.position = "fixed";
  modalBackdrop.style.inset = "0";
  modalBackdrop.style.zIndex = "1000000";
  modalBackdrop.style.background = "rgba(0,0,0,0.6)";
  modalBackdrop.style.display = "none";

  const modal = document.createElement("div");
  modal.style.position = "absolute";
  modal.style.left = "50%";
  modal.style.top = "50%";
  modal.style.transform = "translate(-50%, -50%)";
  modal.style.width = "min(1100px, calc(100vw - 30px))";
  modal.style.height = "min(760px, calc(100vh - 30px))";
  modal.style.borderRadius = "14px";
  modal.style.border = "1px solid #2a2a2a";
  modal.style.background = "#111";
  modal.style.color = "#fff";
  modal.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial";
  modal.style.boxShadow = "0 25px 60px rgba(0,0,0,0.55)";
  modal.style.display = "grid";
  modal.style.gridTemplateRows = "auto auto 1fr";
  modal.style.overflow = "hidden";

  const modalHead = document.createElement("div");
  modalHead.style.display = "flex";
  modalHead.style.justifyContent = "space-between";
  modalHead.style.alignItems = "center";
  modalHead.style.padding = "12px 14px";
  modalHead.style.borderBottom = "1px solid #2a2a2a";
  modalHead.innerHTML = `<div style="font-weight:700">GeoGuessr Analyzer - Full Analysis</div>`;
  const modalClose = document.createElement("button");
  modalClose.textContent = "x";
  modalClose.style.background = "transparent";
  modalClose.style.color = "white";
  modalClose.style.border = "none";
  modalClose.style.cursor = "pointer";
  modalClose.style.fontSize = "18px";
  modalHead.appendChild(modalClose);

  const controls = document.createElement("div");
  controls.style.display = "flex";
  controls.style.gap = "10px";
  controls.style.alignItems = "center";
  controls.style.padding = "10px 14px";
  controls.style.borderBottom = "1px solid #2a2a2a";
  controls.style.flexWrap = "wrap";

  const fromInput = document.createElement("input");
  fromInput.type = "date";
  fromInput.style.background = "#1b1b1b";
  fromInput.style.color = "white";
  fromInput.style.border = "1px solid #3a3a3a";
  fromInput.style.borderRadius = "8px";
  fromInput.style.padding = "6px 8px";

  const toInput = document.createElement("input");
  toInput.type = "date";
  toInput.style.background = "#1b1b1b";
  toInput.style.color = "white";
  toInput.style.border = "1px solid #3a3a3a";
  toInput.style.borderRadius = "8px";
  toInput.style.padding = "6px 8px";

  const modeSelect = document.createElement("select");
  modeSelect.style.background = "#1b1b1b";
  modeSelect.style.color = "white";
  modeSelect.style.border = "1px solid #3a3a3a";
  modeSelect.style.borderRadius = "8px";
  modeSelect.style.padding = "6px 8px";

  const applyBtn = document.createElement("button");
  applyBtn.textContent = "Apply Filter";
  applyBtn.style.background = "#214a78";
  applyBtn.style.color = "white";
  applyBtn.style.border = "1px solid #2f6096";
  applyBtn.style.borderRadius = "8px";
  applyBtn.style.padding = "6px 10px";
  applyBtn.style.cursor = "pointer";

  const resetFilterBtn = document.createElement("button");
  resetFilterBtn.textContent = "Reset Filter";
  resetFilterBtn.style.background = "#303030";
  resetFilterBtn.style.color = "white";
  resetFilterBtn.style.border = "1px solid #444";
  resetFilterBtn.style.borderRadius = "8px";
  resetFilterBtn.style.padding = "6px 10px";
  resetFilterBtn.style.cursor = "pointer";

  controls.appendChild(document.createTextNode("From:"));
  controls.appendChild(fromInput);
  controls.appendChild(document.createTextNode("To:"));
  controls.appendChild(toInput);
  controls.appendChild(document.createTextNode("Mode:"));
  controls.appendChild(modeSelect);
  controls.appendChild(applyBtn);
  controls.appendChild(resetFilterBtn);

  const modalBody = document.createElement("div");
  modalBody.style.overflow = "auto";
  modalBody.style.padding = "14px";
  modalBody.style.display = "grid";
  modalBody.style.gridTemplateColumns = "repeat(auto-fit, minmax(320px, 1fr))";
  modalBody.style.gap = "10px";

  modal.appendChild(modalHead);
  modal.appendChild(controls);
  modal.appendChild(modalBody);
  modalBackdrop.appendChild(modal);

  document.body.appendChild(iconBtn);
  document.body.appendChild(panel);
  document.body.appendChild(modalBackdrop);

  let open = false;
  function setOpen(v: boolean) {
    open = v;
    panel.style.display = open ? "block" : "none";
  }

  function setModalOpen(v: boolean) {
    modalBackdrop.style.display = v ? "block" : "none";
  }

  iconBtn.addEventListener("click", () => setOpen(!open));
  closeBtn.addEventListener("click", () => setOpen(false));
  modalClose.addEventListener("click", () => setModalOpen(false));
  modalBackdrop.addEventListener("click", (ev) => {
    if (ev.target === modalBackdrop) setModalOpen(false);
  });

  let updateHandler: (() => void) | null = null;
  let resetHandler: (() => void) | null = null;
  let exportHandler: (() => void) | null = null;
  let tokenHandler: (() => void) | null = null;
  let openAnalysisHandler: (() => void) | null = null;
  let refreshAnalysisHandler: ((filter: { fromTs?: number; toTs?: number; mode?: string }) => void) | null = null;

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
    setModalOpen(true);
    openAnalysisHandler?.();
  });
  applyBtn.addEventListener("click", () => {
    refreshAnalysisHandler?.({
      fromTs: parseDateInput(fromInput.value, false),
      toTs: parseDateInput(toInput.value, true),
      mode: modeSelect.value || "all"
    });
  });
  resetFilterBtn.addEventListener("click", () => {
    fromInput.value = "";
    toInput.value = "";
    modeSelect.value = "all";
    refreshAnalysisHandler?.({ mode: "all" });
  });

  function renderSection(section: AnalysisSection): HTMLElement {
    const card = document.createElement("div");
    card.style.border = "1px solid #2a2a2a";
    card.style.borderRadius = "10px";
    card.style.background = "#171717";
    card.style.padding = "10px";
    const title2 = document.createElement("div");
    title2.textContent = section.title;
    title2.style.fontWeight = "700";
    title2.style.marginBottom = "6px";
    title2.style.fontSize = "13px";
    const body = document.createElement("pre");
    body.style.margin = "0";
    body.style.whiteSpace = "pre-wrap";
    body.style.fontSize = "12px";
    body.style.lineHeight = "1.35";
    body.textContent = section.lines.join("\n");
    card.appendChild(title2);
    if (section.chart?.type === "line" && section.chart.points.length > 1) {
      const chartWrap = document.createElement("div");
      chartWrap.style.marginBottom = "8px";
      chartWrap.style.border = "1px solid #2a2a2a";
      chartWrap.style.borderRadius = "8px";
      chartWrap.style.background = "#121212";
      chartWrap.style.padding = "6px";

      const points = section.chart.points.slice().sort((a, b) => a.x - b.x);
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
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
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
      chartWrap.appendChild(svg);
      card.appendChild(chartWrap);
    }
    card.appendChild(body);
    return card;
  }

  return {
    setVisible(visible) {
      iconBtn.style.display = visible ? "flex" : "none";
      if (!visible) {
        panel.style.display = "none";
        modalBackdrop.style.display = "none";
      }
    },
    setStatus(msg) {
      status.textContent = msg;
    },
    setCounts(value) {
      counts.textContent = `Data: ${value.games} games, ${value.rounds} rounds.`;
    },
    setAnalysisWindowData(data) {
      // set filter bounds/options once data comes in
      if (!fromInput.value && data.minPlayedAt) fromInput.value = isoDateLocal(data.minPlayedAt);
      if (!toInput.value && data.maxPlayedAt) toInput.value = isoDateLocal(data.maxPlayedAt);

      const prev = modeSelect.value || "all";
      modeSelect.innerHTML = "";
      for (const mode of data.availableModes) {
        const opt = document.createElement("option");
        opt.value = mode;
        opt.textContent = mode;
        modeSelect.appendChild(opt);
      }
      if ([...modeSelect.options].some((o) => o.value === prev)) modeSelect.value = prev;

      modalBody.innerHTML = "";
      for (const s of data.sections) {
        modalBody.appendChild(renderSection(s));
      }
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
