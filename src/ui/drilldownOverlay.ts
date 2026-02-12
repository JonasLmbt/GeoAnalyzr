// src/ui/drilldownOverlay.ts
import type { SemanticRegistry } from "../config/semantic.types";
import type { FilterClause } from "../config/dashboard.types";
import { pickWithAliases } from "../engine/fieldAccess";
import type { DrilldownColumnDef, DrilldownColumnSpec } from "../config/semantic.types";

export type DrilldownTarget = "rounds" | "games" | "sessions" | "players";

export interface DrilldownRequest {
  title: string;
  target: DrilldownTarget;
  columnsPreset: string;
  rows: any[];
  extraFilters?: FilterClause[];
}

export class DrilldownOverlay {
  private root: HTMLElement;
  private doc: Document;
  private modal: HTMLDivElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.doc = root.ownerDocument;
    this.modal = this.doc.createElement("div");
    this.modal.className = "ga-drilldown-modal";
    this.modal.style.display = "none";
    this.root.appendChild(this.modal);
  }

  getDocument(): Document {
    return this.doc;
  }

  open(semantic: SemanticRegistry, req: DrilldownRequest): void {
    this.modal.innerHTML = "";
    this.modal.style.display = "block";

    const bg = this.doc.createElement("div");
    bg.className = "ga-drilldown-bg";
    bg.addEventListener("click", () => this.close());

    const panel = this.doc.createElement("div");
    panel.className = "ga-drilldown-panel";

    const header = this.doc.createElement("div");
    header.className = "ga-drilldown-header";

    const hTitle = this.doc.createElement("div");
    hTitle.className = "ga-drilldown-title";
    hTitle.textContent = `${req.title} (${req.rows.length})`;

    const btn = this.doc.createElement("button");
    btn.className = "ga-drilldown-close";
    btn.type = "button";
    btn.setAttribute("aria-label", "Close");
    btn.textContent = "X";
    btn.addEventListener("click", () => this.close());

    header.appendChild(hTitle);
    header.appendChild(btn);

    const preset = semantic.drilldownPresets[req.target];
    const dateFormat = this.readDateFormatMode();

    const rawCols = (preset?.columnsPresets?.[req.columnsPreset] ?? []) as DrilldownColumnSpec[];
    const cols = rawCols.map((c) => (typeof c === "string" ? ({ key: c } as DrilldownColumnDef) : c));

    // Sorting state is per-overlay instance.
    let sortKey = cols.find((c) => c.sortable)?.key ?? cols[0]?.key ?? "";
    let sortDir: "asc" | "desc" = "desc";

    const sortRankForResult = (v: unknown): number => {
      const s = typeof v === "string" ? v.trim().toLowerCase() : "";
      if (s === "win" || s === "w" || s === "true") return 2;
      if (s === "tie" || s === "t") return 1;
      if (s === "loss" || s === "l" || s === "false") return 0;
      return -1;
    };

    const getSortValue = (row: any, col: DrilldownColumnDef): string | number => {
      const key = col.key;
      const v = this.getCellRawValue(row, key, semantic);
      if (key === "result") return sortRankForResult(v);
      if (typeof v === "number" && Number.isFinite(v)) return v;
      const s = typeof v === "string" ? v : String(v ?? "");
      // If this looks like a date, prefer timestamp sorting.
      const k = key.toLowerCase();
      if ((k.includes("date") || k.includes("time") || k.includes("playedat") || k.includes("ts")) && s) {
        const parsed = Date.parse(s);
        if (Number.isFinite(parsed)) return parsed;
      }
      return s.toLowerCase();
    };

    const isSameGame = (a: any, b: any): boolean => {
      const ga = pickWithAliases(a, "gameId", semantic.columnAliases);
      const gb = pickWithAliases(b, "gameId", semantic.columnAliases);
      return typeof ga === "string" && typeof gb === "string" && ga.length > 0 && ga === gb;
    };

    const sortRows = (rows: any[]): any[] => {
      const col = cols.find((c) => c.key === sortKey);
      if (!col) return rows;
      const sorted = [...rows].sort((a, b) => {
        const av = getSortValue(a, col);
        const bv = getSortValue(b, col);
        if (typeof av === "number" && typeof bv === "number") return sortDir === "asc" ? av - bv : bv - av;
        return sortDir === "asc"
          ? String(av).localeCompare(String(bv))
          : String(bv).localeCompare(String(av));
      });
      return sorted;
    };

    const table = this.doc.createElement("table");
    table.className = "ga-drilldown-table";

    const thead = this.doc.createElement("thead");
    const trh = this.doc.createElement("tr");
    thead.appendChild(trh);

    const tbody = this.doc.createElement("tbody");

    const renderHeader = () => {
      trh.innerHTML = "";
      for (const c of cols) {
        const th = this.doc.createElement("th");
        th.className = "ga-dd-th";
        const label = c.label ?? c.key;
        if (c.sortable) {
          th.classList.add("ga-dd-sortable");
          const arrow = c.key === sortKey ? (sortDir === "asc" ? " ^" : " v") : "";
          th.textContent = `${label}${arrow}`;
          th.addEventListener("click", () => {
            if (sortKey === c.key) sortDir = sortDir === "asc" ? "desc" : "asc";
            else {
              sortKey = c.key;
              sortDir = "desc";
            }
            renderBody(true);
            renderHeader();
          });
        } else {
          th.textContent = label;
        }
        trh.appendChild(th);
      }
    };

    const renderBody = (reset = false) => {
      const rows = sortRows(req.rows);
      if (reset) tbody.innerHTML = "";
      tbody.innerHTML = "";
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const tr = this.doc.createElement("tr");
        tr.className = "ga-dd-tr";
        const next = rows[i + 1];
        if (next && isSameGame(r, next)) tr.classList.add("ga-dd-no-sep");
        for (const c of cols) {
          const td = this.doc.createElement("td");
          td.className = "ga-dd-td";
          this.renderCell(td, r, c, semantic, dateFormat);
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
    };

    renderHeader();
    renderBody(true);

    table.appendChild(thead);
    table.appendChild(tbody);

    panel.appendChild(header);
    panel.appendChild(table);

    this.modal.appendChild(bg);
    this.modal.appendChild(panel);
  }

  close(): void {
    this.modal.style.display = "none";
  }

  private readDateFormatMode(): "dd/mm/yyyy" | "mm/dd/yyyy" | "yyyy-mm-dd" | "locale" {
    const root = this.root as HTMLElement & { dataset?: DOMStringMap };
    const mode = root.dataset?.gaDateFormat;
    return mode === "mm/dd/yyyy" || mode === "yyyy-mm-dd" || mode === "locale" ? mode : "dd/mm/yyyy";
  }

  private formatDate(ts: number, mode: "dd/mm/yyyy" | "mm/dd/yyyy" | "yyyy-mm-dd" | "locale"): string {
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return String(ts);
    if (mode === "locale") return d.toLocaleString();

    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");

    if (mode === "yyyy-mm-dd") return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
    if (mode === "mm/dd/yyyy") return `${m}/${day}/${y} ${hh}:${mm}:${ss}`;
    return `${day}/${m}/${y} ${hh}:${mm}:${ss}`;
  }

  private formatCellValue(
    value: unknown,
    columnName: string,
    dateMode: "dd/mm/yyyy" | "mm/dd/yyyy" | "yyyy-mm-dd" | "locale"
  ): string {
    if (value === undefined || value === null) return "";

    const col = columnName.toLowerCase();
    const looksLikeDateColumn =
      col === "ts" ||
      col === "playedat" ||
      col === "starttime" ||
      col === "endtime" ||
      col.includes("date") ||
      col.includes("time") ||
      col.includes("playedat") ||
      col.includes("timestamp");

    if (typeof value === "number" && Number.isFinite(value)) {
      if (looksLikeDateColumn && value > 946684800000 && value < 4102444800000) {
        return this.formatDate(value, dateMode);
      }
      return String(value);
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (looksLikeDateColumn) {
        // Handle raw numeric timestamps that come in as strings.
        if (/^[0-9]{10,13}$/.test(trimmed)) {
          const n = Number(trimmed);
          if (Number.isFinite(n)) {
            const ts = trimmed.length === 10 ? n * 1000 : n;
            if (ts > 946684800000 && ts < 4102444800000) return this.formatDate(ts, dateMode);
          }
        }
        const parsed = Date.parse(trimmed);
        if (Number.isFinite(parsed)) return this.formatDate(parsed, dateMode);
      }
      return value;
    }

    return String(value);
  }

  private getCellRawValue(row: any, key: string, semantic: SemanticRegistry): unknown {
    if (key === "guess_maps") {
      const lat = pickWithAliases(row, "player_self_guessLat", semantic.columnAliases);
      const lng = pickWithAliases(row, "player_self_guessLng", semantic.columnAliases);
      if (typeof lat === "number" && typeof lng === "number") return `https://www.google.com/maps?q=${lat},${lng}`;
      return undefined;
    }
    if (key === "street_view") {
      const lat = pickWithAliases(row, "trueLat", semantic.columnAliases);
      const lng = pickWithAliases(row, "trueLng", semantic.columnAliases);
      if (typeof lat === "number" && typeof lng === "number") return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
      return undefined;
    }
    return pickWithAliases(row, key, semantic.columnAliases);
  }

  private renderCell(
    td: HTMLTableCellElement,
    row: any,
    col: DrilldownColumnDef,
    semantic: SemanticRegistry,
    dateMode: "dd/mm/yyyy" | "mm/dd/yyyy" | "yyyy-mm-dd" | "locale"
  ): void {
    const key = col.key;
    const raw = this.getCellRawValue(row, key, semantic);

    if (col.type === "link" || key === "guess_maps" || key === "street_view") {
      const href = typeof raw === "string" ? raw : "";
      if (!href) return;
      const a = this.doc.createElement("a");
      a.className = "ga-dd-link";
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = col.link?.label ?? "Open";
      td.appendChild(a);
      return;
    }

    let text = this.formatCellValue(raw, key, dateMode);

    if (key === "result") {
      if (typeof raw === "boolean") text = raw ? "Win" : "Loss";
      else if (typeof raw === "string") text = raw;
      else text = "-";
    }

    if (key === "durationSeconds" && typeof raw === "number" && Number.isFinite(raw)) {
      text = `${raw.toFixed(1)}s`;
    }
    if (key === "damage" && typeof raw === "number" && Number.isFinite(raw)) {
      const signed = raw > 0 ? `+${Math.round(raw)}` : `${Math.round(raw)}`;
      text = signed;
    }
    if ((key === "true_country" || key === "trueCountry") && typeof raw === "string") {
      const iso2 = raw.trim().toUpperCase();
      if (/^[A-Z]{2}$/.test(iso2) && typeof Intl !== "undefined" && (Intl as any).DisplayNames) {
        try {
          const dn = new (Intl as any).DisplayNames(["en"], { type: "region" });
          text = dn.of(iso2) ?? raw;
        } catch {
          // keep raw
        }
      }
    }

    if (key === "gameId" && col.display?.truncate) {
      const head = typeof col.display.truncateHead === "number" ? col.display.truncateHead : 8;
      const s = typeof raw === "string" ? raw : text;
      if (s.length > head + 3) text = `${s.slice(0, head)}...`;
    }

    const span = this.doc.createElement("span");
    span.textContent = text;

    if (col.colored) {
      if (key === "result") {
        const s = (typeof raw === "string" ? raw : String(raw ?? "")).trim().toLowerCase();
        if (s === "win" || s === "w" || s === "true") span.classList.add("ga-dd-pos");
        else if (s === "loss" || s === "l" || s === "false") span.classList.add("ga-dd-neg");
      }
      if (key === "damage" && typeof raw === "number" && Number.isFinite(raw)) {
        if (raw > 0) span.classList.add("ga-dd-pos");
        else if (raw < 0) span.classList.add("ga-dd-neg");
      }
    }

    td.appendChild(span);
  }
}
