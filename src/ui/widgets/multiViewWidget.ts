import type { SemanticRegistry } from "../../config/semantic.types";
import type { WidgetDef } from "../../config/dashboard.types";
import type { Grain } from "../../config/semantic.types";
import type { ChartSpec, BreakdownSpec, CountryMetricMapSpec, RegionMetricMapSpec, StatListSpec, StatValueSpec, RecordListSpec } from "../../config/dashboard.types";
import { DrilldownOverlay } from "../drilldownOverlay";

type MultiViewItem = {
  id: string;
  label: string;
  type: WidgetDef["type"];
  grain: Grain;
  spec: ChartSpec | StatListSpec | StatValueSpec | BreakdownSpec | CountryMetricMapSpec | RegionMetricMapSpec | RecordListSpec | { rows: any[] };
};

export type MultiViewSpec = {
  views: MultiViewItem[];
  activeView?: string;
};

export async function renderMultiViewWidget(args: {
  semantic: SemanticRegistry;
  widget: WidgetDef;
  overlay: DrilldownOverlay;
  datasets?: Partial<Record<Grain, any[]>>;
  context?: { dateRange?: { fromTs: number | null; toTs: number | null } };
  renderChild: (child: WidgetDef) => Promise<HTMLElement>;
}): Promise<HTMLElement> {
  const { widget, overlay, renderChild } = args;
  const spec = widget.spec as unknown as MultiViewSpec;
  const doc = overlay.getDocument();

  const wrap = doc.createElement("div");
  wrap.className = "ga-widget ga-multiview";

  const title = doc.createElement("div");
  title.className = "ga-widget-title";
  title.textContent = widget.title;

  const controls = doc.createElement("div");
  controls.className = "ga-chart-controls";

  const controlsLeft = doc.createElement("div");
  controlsLeft.className = "ga-chart-controls-left";
  controls.appendChild(controlsLeft);

  const actionsRight = doc.createElement("div");
  actionsRight.className = "ga-chart-actions";
  controls.appendChild(actionsRight);

  const host = doc.createElement("div");
  host.className = "ga-multiview-host";

  const views = Array.isArray(spec.views) ? spec.views : [];
  if (views.length === 0) {
    const empty = doc.createElement("div");
    empty.style.fontSize = "12px";
    empty.style.opacity = "0.75";
    empty.textContent = "No views configured.";
    host.appendChild(empty);
    wrap.appendChild(title);
    wrap.appendChild(controls);
    wrap.appendChild(host);
    return wrap;
  }

  const allIds = views.map((v) => String(v.id));
  let active = typeof spec.activeView === "string" && allIds.includes(spec.activeView) ? spec.activeView : allIds[0];

  const label = doc.createElement("label");
  label.style.fontSize = "12px";
  label.style.opacity = "0.9";
  label.textContent = "View:";

  const select = doc.createElement("select");
  select.style.background = "var(--ga-control-bg)";
  select.style.color = "var(--ga-control-text)";
  select.style.border = "1px solid var(--ga-control-border)";
  select.style.borderRadius = "8px";
  select.style.padding = "4px 8px";

  for (const v of views) {
    const opt = doc.createElement("option");
    opt.value = String(v.id);
    opt.textContent = String(v.label ?? v.id);
    if (String(v.id) === active) opt.selected = true;
    select.appendChild(opt);
  }

  const renderActive = async (): Promise<void> => {
    host.innerHTML = "";
    const v = views.find((x) => String(x.id) === active) ?? views[0];
    const child: WidgetDef = {
      widgetId: `${widget.widgetId}__${String(v.id)}`,
      type: v.type,
      title: "",
      grain: v.grain,
      spec: v.spec as any
    };
    const el = await renderChild(child);
    const firstTitle = el.querySelector?.(".ga-widget-title");
    if (firstTitle && firstTitle.parentElement === el) firstTitle.remove();
    host.appendChild(el);
  };

  select.addEventListener("change", () => {
    const next = select.value;
    if (!allIds.includes(next)) return;
    active = next;
    void renderActive();
  });

  controlsLeft.appendChild(label);
  controlsLeft.appendChild(select);

  wrap.appendChild(title);
  wrap.appendChild(controls);
  wrap.appendChild(host);

  await renderActive();
  return wrap;
}

