// src/ui/drilldownOverlay.ts
import type { SemanticRegistry } from "../config/semantic.types";
import type { FilterClause } from "../config/dashboard.types";
import { pickWithAliases } from "../engine/fieldAccess";

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
    hTitle.textContent = req.title;

    const btn = this.doc.createElement("button");
    btn.className = "ga-drilldown-close";
    btn.textContent = "Close";
    btn.addEventListener("click", () => this.close());

    header.appendChild(hTitle);
    header.appendChild(btn);

    const table = this.doc.createElement("table");
    table.className = "ga-drilldown-table";

    const preset = semantic.drilldownPresets[req.target];
    const cols = preset?.columnsPresets?.[req.columnsPreset] ?? [];
    const thead = this.doc.createElement("thead");
    const trh = this.doc.createElement("tr");
    for (const c of cols) {
      const th = this.doc.createElement("th");
      th.textContent = c;
      trh.appendChild(th);
    }
    thead.appendChild(trh);

    const tbody = this.doc.createElement("tbody");
    const dateFormat = this.readDateFormatMode();
    for (const r of req.rows) {
      const tr = this.doc.createElement("tr");
      for (const c of cols) {
        const td = this.doc.createElement("td");
        const v = pickWithAliases(r, c, semantic.columnAliases);
        td.textContent = this.formatCellValue(v, c, dateFormat);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }

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
    const looksLikeDateColumn = col.includes("date") || col.includes("time") || col.includes("playedat") || col.includes("timestamp");

    if (typeof value === "number" && Number.isFinite(value)) {
      if (looksLikeDateColumn && value > 946684800000 && value < 4102444800000) {
        return this.formatDate(value, dateMode);
      }
      return String(value);
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (looksLikeDateColumn) {
        const parsed = Date.parse(trimmed);
        if (Number.isFinite(parsed)) return this.formatDate(parsed, dateMode);
      }
      return value;
    }

    return String(value);
  }
}
