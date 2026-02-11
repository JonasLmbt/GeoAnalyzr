// src/ui/dashboardRenderer.ts
import type { SemanticRegistry } from "../config/semantic.types";
import type { DashboardDoc, WidgetDef } from "../config/dashboard.types";
import type { RoundRow } from "../db";
import { DrilldownOverlay } from "./drilldownOverlay";
import { renderStatListWidget } from "./widgets/statListWidget";
import { renderChartWidget } from "./widgets/chartWidget";
import { renderBreakdownWidget } from "./widgets/breakdownWidget";


export async function renderDashboard(
  root: HTMLElement,
  semantic: SemanticRegistry,
  dashboard: DashboardDoc,
  opts?: { rows?: RoundRow[] }
): Promise<void> {
  root.innerHTML = "";
  const doc = root.ownerDocument;

  const overlay = new DrilldownOverlay(root);
  const baseRows = opts?.rows;

  const tabBar = doc.createElement("div");
  tabBar.className = "ga-tabs";

  const content = doc.createElement("div");
  content.className = "ga-content";

  root.appendChild(tabBar);
  root.appendChild(content);

  const sections = dashboard.dashboard.sections;
  let active = sections[0]?.id ?? "";

  function makeTab(secId: string, label: string) {
    const btn = doc.createElement("button");
    btn.className = "ga-tab";
    btn.textContent = label;
    btn.addEventListener("click", async () => {
      active = secId;
      await renderActive();
      highlight();
    });
    tabBar.appendChild(btn);
  }

  function highlight() {
    const btns = Array.from(tabBar.querySelectorAll("button.ga-tab"));
    btns.forEach((b, i) => {
      b.classList.toggle("active", sections[i]?.id === active);
    });
  }

  async function renderWidget(widget: WidgetDef): Promise<HTMLElement> {
    if (widget.type === "stat_list") return await renderStatListWidget(semantic, widget, overlay, baseRows);
    if (widget.type === "chart") return await renderChartWidget(semantic, widget, overlay, baseRows);
    if (widget.type === "breakdown") return await renderBreakdownWidget(semantic, widget, overlay, baseRows);

    // placeholders for the next iterations
    const ph = doc.createElement("div");
    ph.className = "ga-widget ga-placeholder";
    ph.textContent = `Widget type '${widget.type}' not implemented yet`;
    return ph;
  }

  async function renderActive(): Promise<void> {
    content.innerHTML = "";
    const section = sections.find((s) => s.id === active);
    if (!section) return;

    const grid = doc.createElement("div");
    grid.className = "ga-grid";
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = `repeat(${section.layout.columns}, minmax(0, 1fr))`;
    grid.style.gap = "12px";

    for (const placed of section.layout.cards) {
      const card = doc.createElement("div");
      card.className = "ga-card";
      card.style.gridColumn = `${placed.x + 1} / span ${placed.w}`;
      card.style.gridRow = `${placed.y + 1} / span ${placed.h}`;

      const header = doc.createElement("div");
      header.className = "ga-card-header";
      header.textContent = placed.title;

      const body = doc.createElement("div");
      body.className = "ga-card-body";

      const inner = doc.createElement("div");
      inner.className = "ga-card-inner";
      inner.style.display = "grid";
      inner.style.gridTemplateColumns = `repeat(12, minmax(0, 1fr))`;
      inner.style.gap = "10px";

      for (const w of placed.card.children) {
        const container = doc.createElement("div");
        container.className = "ga-child";

        const p = w.placement ?? { x: 0, y: 0, w: 12, h: 3 };
        container.style.gridColumn = `${p.x + 1} / span ${p.w}`;
        container.style.gridRow = `${p.y + 1} / span ${p.h}`;

        container.appendChild(await renderWidget(w));
        inner.appendChild(container);
      }

      body.appendChild(inner);
      card.appendChild(header);
      card.appendChild(body);
      grid.appendChild(card);
    }

    content.appendChild(grid);
  }

  for (const s of sections) makeTab(s.id, s.title);

  await renderActive();
  highlight();
}
