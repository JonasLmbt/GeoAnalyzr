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
  private modal: HTMLDivElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.modal = document.createElement("div");
    this.modal.className = "ga-drilldown-modal";
    this.modal.style.display = "none";
    this.root.appendChild(this.modal);
  }

  open(semantic: SemanticRegistry, req: DrilldownRequest): void {
    this.modal.innerHTML = "";
    this.modal.style.display = "block";

    const bg = document.createElement("div");
    bg.className = "ga-drilldown-bg";
    bg.addEventListener("click", () => this.close());

    const panel = document.createElement("div");
    panel.className = "ga-drilldown-panel";

    const header = document.createElement("div");
    header.className = "ga-drilldown-header";

    const hTitle = document.createElement("div");
    hTitle.className = "ga-drilldown-title";
    hTitle.textContent = req.title;

    const btn = document.createElement("button");
    btn.className = "ga-drilldown-close";
    btn.textContent = "Close";
    btn.addEventListener("click", () => this.close());

    header.appendChild(hTitle);
    header.appendChild(btn);

    const table = document.createElement("table");
    table.className = "ga-drilldown-table";

    const preset = semantic.drilldownPresets[req.target];
    const cols = preset?.columnsPresets?.[req.columnsPreset] ?? [];
    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    for (const c of cols) {
      const th = document.createElement("th");
      th.textContent = c;
      trh.appendChild(th);
    }
    thead.appendChild(trh);

    const tbody = document.createElement("tbody");
    for (const r of req.rows) {
      const tr = document.createElement("tr");
      for (const c of cols) {
        const td = document.createElement("td");
        const v = pickWithAliases(r, c, semantic.columnAliases);
        td.textContent = v === undefined || v === null ? "" : String(v);
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
}
