import type { CardPlacementDef, DashboardDoc, SectionDef, WidgetDef } from "../config/dashboard.types";
import type { SemanticRegistry } from "../config/semantic.types";
import { validateDashboardAgainstSemantic } from "../engine/validate";

type OnChange = (next: DashboardDoc) => void;

function cloneJson<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function asInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function mkBtn(doc: Document, label: string, onClick: () => void, kind: "primary" | "danger" | "ghost" = "ghost"): HTMLButtonElement {
  const b = doc.createElement("button");
  b.type = "button";
  b.className = `ga-le-btn ga-le-btn-${kind}`;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function mkField(doc: Document, label: string): { wrap: HTMLDivElement; inputHost: HTMLDivElement } {
  const wrap = doc.createElement("div");
  wrap.className = "ga-le-field";
  const l = doc.createElement("label");
  l.textContent = label;
  wrap.appendChild(l);
  const inputHost = doc.createElement("div");
  inputHost.className = "ga-le-inputhost";
  wrap.appendChild(inputHost);
  return { wrap, inputHost };
}

function mkTextInput(doc: Document, label: string, value: string, onChange: (next: string) => void): HTMLDivElement {
  const f = mkField(doc, label);
  const input = doc.createElement("input");
  input.type = "text";
  input.value = value ?? "";
  input.addEventListener("input", () => onChange(input.value));
  f.inputHost.appendChild(input);
  return f.wrap;
}

function mkNumberInput(
  doc: Document,
  label: string,
  value: number,
  onChange: (next: number) => void,
  opts?: { min?: number; max?: number; step?: number }
): HTMLDivElement {
  const f = mkField(doc, label);
  const input = doc.createElement("input");
  input.type = "number";
  if (opts?.min !== undefined) input.min = String(opts.min);
  if (opts?.max !== undefined) input.max = String(opts.max);
  input.step = String(opts?.step ?? 1);
  input.value = String(value);
  input.addEventListener("change", () => onChange(asInt(input.value, value)));
  f.inputHost.appendChild(input);
  return f.wrap;
}

function mkSelect(
  doc: Document,
  label: string,
  value: string,
  options: Array<{ value: string; label: string }>,
  onChange: (next: string) => void
): HTMLDivElement {
  const f = mkField(doc, label);
  const sel = doc.createElement("select");
  for (const o of options) sel.appendChild(new Option(o.label, o.value));
  if (options.some((o) => o.value === value)) sel.value = value;
  sel.addEventListener("change", () => onChange(sel.value));
  f.inputHost.appendChild(sel);
  return f.wrap;
}

function mkMultiSelect(
  doc: Document,
  label: string,
  values: string[],
  options: Array<{ value: string; label: string }>,
  onChange: (next: string[]) => void
): HTMLDivElement {
  const f = mkField(doc, label);
  const sel = doc.createElement("select");
  sel.multiple = true;
  sel.size = Math.min(10, Math.max(3, options.length));
  for (const o of options) {
    const opt = new Option(o.label, o.value);
    opt.selected = values.includes(o.value);
    sel.appendChild(opt);
  }
  sel.addEventListener("change", () => onChange(Array.from(sel.selectedOptions).map((o) => o.value)));
  f.inputHost.appendChild(sel);
  return f.wrap;
}

function mkHr(doc: Document): HTMLHRElement {
  const hr = doc.createElement("hr");
  hr.className = "ga-le-hr";
  return hr;
}

function allowedGrains(semantic: SemanticRegistry): string[] {
  return Object.keys(semantic.datasets ?? {}) as string[];
}

function allowedMeasureOptions(semantic: SemanticRegistry, grain: string): Array<{ value: string; label: string }> {
  const keys = Object.keys(semantic.measures ?? {});
  const out: Array<{ value: string; label: string }> = [];
  for (const id of keys) {
    const m: any = (semantic.measures as any)[id];
    if (m?.grain === grain) out.push({ value: id, label: `${id}${m?.label ? ` — ${m.label}` : ""}` });
  }
  out.sort((a, b) => a.value.localeCompare(b.value));
  return out;
}

function allowedDimensionOptions(semantic: SemanticRegistry, grain: string): Array<{ value: string; label: string }> {
  const keys = Object.keys(semantic.dimensions ?? {});
  const out: Array<{ value: string; label: string }> = [];
  for (const id of keys) {
    const d: any = (semantic.dimensions as any)[id];
    const grains = Array.isArray(d?.grain) ? d.grain : [d?.grain];
    if (grains.includes(grain)) out.push({ value: id, label: `${id}${d?.label ? ` — ${d.label}` : ""}` });
  }
  out.sort((a, b) => a.value.localeCompare(b.value));
  return out;
}

function defaultCard(): CardPlacementDef {
  return {
    cardId: `card_${Math.random().toString(36).slice(2, 7)}`,
    title: "Card",
    x: 0,
    y: 0,
    w: 12,
    h: 10,
    card: { type: "composite", children: [] }
  };
}

function defaultSection(): SectionDef {
  return {
    id: `section_${Math.random().toString(36).slice(2, 7)}`,
    title: "New Section",
    layout: { mode: "grid", columns: 12, cards: [defaultCard()] }
  };
}

function defaultWidget(grain: string, type: WidgetDef["type"]): WidgetDef {
  const widgetId = `w_${type}_${Math.random().toString(36).slice(2, 7)}`;
  const placement = { x: 0, y: 0, w: 12, h: 3 };
  const base: any = { widgetId, type, title: type, grain, placement };
  if (type === "stat_value") base.spec = { label: "Value", measure: "" };
  else if (type === "stat_list") base.spec = { rows: [{ label: "Row", measure: "" }] };
  else if (type === "chart") base.spec = { type: "bar", x: { dimension: "" }, y: { measure: "" }, actions: { hover: true } };
  else if (type === "breakdown") base.spec = { dimension: "", measure: "", limit: 12 };
  else if (type === "record_list") base.spec = { records: [] };
  else base.spec = {};
  return base as WidgetDef;
}

function normalizeFilterScope(fs: any): any {
  const include = Array.isArray(fs?.include) ? fs.include.filter((x: any) => typeof x === "string" && x.trim()) : [];
  const exclude = Array.isArray(fs?.exclude) ? fs.exclude.filter((x: any) => typeof x === "string" && x.trim()) : [];
  const out: any = {};
  if (include.length) out.include = include;
  if (exclude.length) out.exclude = exclude;
  return Object.keys(out).length ? out : undefined;
}

function renderWidgetSpecEditorPlaceholder(doc: Document): HTMLElement {
  const note = doc.createElement("div");
  note.className = "ga-settings-note";
  note.textContent = "Spec editor is available for common fields; advanced spec can still be edited in the Template tab.";
  return note;
}

export function renderLayoutEditor(args: {
  doc: Document;
  semantic: SemanticRegistry;
  dashboard: DashboardDoc;
  onChange: OnChange;
  statusEl: HTMLElement;
}): HTMLElement {
  const { doc, semantic, onChange, statusEl } = args;
  const root = doc.createElement("div");
  root.className = "ga-layout-editor";

  let draft = cloneJson(args.dashboard);
  let activeSectionIdx = 0;

  let debounce: number | null = null;
  const applyDraft = () => {
    if (debounce !== null) (doc.defaultView as any)?.clearTimeout?.(debounce);
    debounce = (doc.defaultView as any)?.setTimeout?.(() => {
      debounce = null;
      statusEl.textContent = "";
      statusEl.className = "ga-settings-status";
      try {
        validateDashboardAgainstSemantic(semantic, draft);
        statusEl.textContent = "Layout applied.";
        statusEl.classList.add("ok");
        onChange(cloneJson(draft));
      } catch (e) {
        statusEl.textContent = e instanceof Error ? e.message : String(e);
        statusEl.classList.add("error");
      }
    }, 200) as any;
  };

  const render = () => {
    root.innerHTML = "";

    const sections = draft.dashboard.sections ?? [];
    if (activeSectionIdx < 0) activeSectionIdx = 0;
    if (activeSectionIdx >= sections.length) activeSectionIdx = Math.max(0, sections.length - 1);

    const left = doc.createElement("div");
    left.className = "ga-le-left";
    const right = doc.createElement("div");
    right.className = "ga-le-right";

    const leftHead = doc.createElement("div");
    leftHead.className = "ga-le-left-head";
    leftHead.appendChild(
      mkBtn(doc, "Add section", () => {
        const next = cloneJson(draft);
        next.dashboard.sections = [...(next.dashboard.sections ?? []), defaultSection()];
        draft = next;
        activeSectionIdx = next.dashboard.sections.length - 1;
        applyDraft();
        render();
      }, "primary")
    );
    left.appendChild(leftHead);

    const list = doc.createElement("div");
    list.className = "ga-le-list";
    sections.forEach((s, idx) => {
      const item = doc.createElement("button");
      item.type = "button";
      item.className = "ga-le-list-item";
      item.classList.toggle("active", idx === activeSectionIdx);
      item.textContent = s.title || s.id || "(untitled)";
      item.addEventListener("click", () => {
        activeSectionIdx = idx;
        render();
      });
      list.appendChild(item);
    });
    left.appendChild(list);

    const section = sections[activeSectionIdx];
    if (!section) {
      root.appendChild(left);
      root.appendChild(right);
      return;
    }

    const topRow = doc.createElement("div");
    topRow.className = "ga-le-toprow";
    topRow.appendChild(
      mkBtn(doc, "Move up", () => {
        if (activeSectionIdx <= 0) return;
        const next = cloneJson(draft);
        const arr = [...next.dashboard.sections];
        const [picked] = arr.splice(activeSectionIdx, 1);
        arr.splice(activeSectionIdx - 1, 0, picked);
        next.dashboard.sections = arr;
        draft = next;
        activeSectionIdx--;
        applyDraft();
        render();
      })
    );
    topRow.appendChild(
      mkBtn(doc, "Move down", () => {
        if (activeSectionIdx >= sections.length - 1) return;
        const next = cloneJson(draft);
        const arr = [...next.dashboard.sections];
        const [picked] = arr.splice(activeSectionIdx, 1);
        arr.splice(activeSectionIdx + 1, 0, picked);
        next.dashboard.sections = arr;
        draft = next;
        activeSectionIdx++;
        applyDraft();
        render();
      })
    );
    topRow.appendChild(
      mkBtn(doc, "Delete", () => {
        if (!confirm(`Delete section '${section.title || section.id}'?`)) return;
        const next = cloneJson(draft);
        next.dashboard.sections = next.dashboard.sections.filter((_, i) => i !== activeSectionIdx);
        draft = next;
        activeSectionIdx = Math.max(0, activeSectionIdx - 1);
        applyDraft();
        render();
      }, "danger")
    );
    right.appendChild(topRow);

    const patchSection = (partial: Partial<SectionDef> & { filterScope?: any }) => {
      const next = cloneJson(draft);
      next.dashboard.sections[activeSectionIdx] = { ...next.dashboard.sections[activeSectionIdx], ...partial } as any;
      draft = next;
      applyDraft();
      render();
    };

    right.appendChild(mkTextInput(doc, "section.id", section.id, (v) => patchSection({ id: v })));
    right.appendChild(mkTextInput(doc, "section.title", section.title, (v) => patchSection({ title: v })));
    right.appendChild(
      mkNumberInput(doc, "layout.columns", asInt(section.layout?.columns, 12), (n) => {
        patchSection({ layout: { ...section.layout, columns: Math.max(1, Math.min(24, n)) } as any });
      }, { min: 1, max: 24 })
    );

    const gf = draft.dashboard.globalFilters;
    const controlIds = gf?.enabled ? gf.controls.map((c) => c.id) : [];
    const ctrlOpts = controlIds.map((id) => ({ value: id, label: id }));
    const include = Array.isArray((section as any)?.filterScope?.include) ? (section as any).filterScope.include : [];
    const exclude = Array.isArray((section as any)?.filterScope?.exclude) ? (section as any).filterScope.exclude : [];
    if (ctrlOpts.length > 0) {
      const fsBox = doc.createElement("div");
      fsBox.className = "ga-le-box";
      const fsHead = doc.createElement("div");
      fsHead.className = "ga-le-box-head";
      fsHead.textContent = "filterScope (optional)";
      fsBox.appendChild(fsHead);
      fsBox.appendChild(
        mkMultiSelect(doc, "include", include, ctrlOpts, (vals) => patchSection({ filterScope: normalizeFilterScope({ ...(section as any).filterScope, include: vals }) } as any))
      );
      fsBox.appendChild(
        mkMultiSelect(doc, "exclude", exclude, ctrlOpts, (vals) => patchSection({ filterScope: normalizeFilterScope({ ...(section as any).filterScope, exclude: vals }) } as any))
      );
      right.appendChild(fsBox);
    }

    right.appendChild(mkHr(doc));

    // Cards + widgets (common fields)
    const cardsBox = doc.createElement("div");
    cardsBox.className = "ga-le-box";
    const ch = doc.createElement("div");
    ch.className = "ga-le-box-head";
    ch.textContent = "Cards";
    cardsBox.appendChild(ch);
    cardsBox.appendChild(
      mkBtn(doc, "Add card", () => {
        const next = cloneJson(draft);
        next.dashboard.sections[activeSectionIdx].layout.cards = [...(next.dashboard.sections[activeSectionIdx].layout.cards ?? []), defaultCard()];
        draft = next;
        applyDraft();
        render();
      }, "primary")
    );

    const grains = allowedGrains(semantic);
    const grainDefault = grains[0] ?? "round";
    const widgetTypes: WidgetDef["type"][] = ["stat_list", "stat_value", "chart", "breakdown", "record_list", "team_section"];

    section.layout.cards.forEach((card, cardIdx) => {
      const cardItem = doc.createElement("div");
      cardItem.className = "ga-le-item";
      cardItem.appendChild(mkTextInput(doc, "cardId", card.cardId, (v) => patchCard(cardIdx, { cardId: v } as any)));
      cardItem.appendChild(mkTextInput(doc, "title", card.title, (v) => patchCard(cardIdx, { title: v } as any)));
      const grid = doc.createElement("div");
      grid.className = "ga-le-grid4";
      grid.appendChild(mkNumberInput(doc, "x", asInt(card.x, 0), (n) => patchCard(cardIdx, { x: n } as any)));
      grid.appendChild(mkNumberInput(doc, "y", asInt(card.y, 0), (n) => patchCard(cardIdx, { y: n } as any)));
      grid.appendChild(mkNumberInput(doc, "w", asInt(card.w, 12), (n) => patchCard(cardIdx, { w: n } as any)));
      grid.appendChild(mkNumberInput(doc, "h", asInt(card.h, 10), (n) => patchCard(cardIdx, { h: n } as any)));
      cardItem.appendChild(grid);

      const cardActions = doc.createElement("div");
      cardActions.className = "ga-le-toprow";
      cardActions.appendChild(mkBtn(doc, "Up", () => moveCard(cardIdx, -1)));
      cardActions.appendChild(mkBtn(doc, "Down", () => moveCard(cardIdx, +1)));
      cardActions.appendChild(
        mkBtn(doc, "Delete card", () => {
          if (!confirm(`Delete card '${card.title || card.cardId}'?`)) return;
          const next = cloneJson(draft);
          next.dashboard.sections[activeSectionIdx].layout.cards = next.dashboard.sections[activeSectionIdx].layout.cards.filter((_, i) => i !== cardIdx);
          draft = next;
          applyDraft();
          render();
        }, "danger")
      );
      cardItem.appendChild(cardActions);

      const wBox = doc.createElement("div");
      wBox.className = "ga-le-subbox";
      const wh = doc.createElement("div");
      wh.className = "ga-le-subhead";
      wh.textContent = "Widgets";
      wBox.appendChild(wh);

      const addRow = doc.createElement("div");
      addRow.className = "ga-le-toprow";
      const typeSel = doc.createElement("select");
      typeSel.className = "ga-le-inline-select";
      for (const t of widgetTypes) typeSel.appendChild(new Option(t, t));
      addRow.appendChild(typeSel);
      addRow.appendChild(
        mkBtn(doc, "Add widget", () => {
          const next = cloneJson(draft);
          const c = next.dashboard.sections[activeSectionIdx].layout.cards[cardIdx];
          const children = ((c.card as any).children ?? []) as WidgetDef[];
          (c.card as any).children = [...children, defaultWidget(grainDefault, typeSel.value as any)];
          draft = next;
          applyDraft();
          render();
        }, "primary")
      );
      wBox.appendChild(addRow);

      const children = (((card.card as any).children ?? []) as WidgetDef[]).filter(Boolean);
      children.forEach((w, wIdx) => {
        const wItem = doc.createElement("div");
        wItem.className = "ga-le-widget";
        const wActions = doc.createElement("div");
        wActions.className = "ga-le-toprow";
        wActions.appendChild(mkBtn(doc, "Up", () => moveWidget(cardIdx, wIdx, -1)));
        wActions.appendChild(mkBtn(doc, "Down", () => moveWidget(cardIdx, wIdx, +1)));
        wActions.appendChild(
          mkBtn(doc, "Delete", () => {
            const next = cloneJson(draft);
            const c = next.dashboard.sections[activeSectionIdx].layout.cards[cardIdx];
            (c.card as any).children = (((c.card as any).children ?? []) as any[]).filter((_, i) => i !== wIdx);
            draft = next;
            applyDraft();
            render();
          }, "danger")
        );
        wItem.appendChild(wActions);

        const grainsOpts = allowedGrains(semantic).map((g) => ({ value: g, label: g }));
        const typeOpts = widgetTypes.map((t) => ({ value: t, label: t }));
        wItem.appendChild(mkTextInput(doc, "widgetId", w.widgetId, (v) => patchWidget(cardIdx, wIdx, { ...w, widgetId: v })));
        wItem.appendChild(
          mkSelect(doc, "type", w.type, typeOpts, (v) => {
            const nextWidget = defaultWidget(String(w.grain), v as any);
            nextWidget.widgetId = w.widgetId;
            nextWidget.title = w.title;
            nextWidget.grain = w.grain;
            nextWidget.placement = w.placement;
            patchWidget(cardIdx, wIdx, nextWidget);
          })
        );
        wItem.appendChild(mkTextInput(doc, "title", w.title, (v) => patchWidget(cardIdx, wIdx, { ...w, title: v })));
        wItem.appendChild(mkSelect(doc, "grain", String(w.grain), grainsOpts, (v) => patchWidget(cardIdx, wIdx, { ...w, grain: v as any })));

        const p = (w.placement as any) ?? { x: 0, y: 0, w: 12, h: 3 };
        const pGrid = doc.createElement("div");
        pGrid.className = "ga-le-grid4";
        pGrid.appendChild(mkNumberInput(doc, "x", asInt(p.x, 0), (n) => patchWidget(cardIdx, wIdx, { ...w, placement: { ...p, x: n } })));
        pGrid.appendChild(mkNumberInput(doc, "y", asInt(p.y, 0), (n) => patchWidget(cardIdx, wIdx, { ...w, placement: { ...p, y: n } })));
        pGrid.appendChild(mkNumberInput(doc, "w", asInt(p.w, 12), (n) => patchWidget(cardIdx, wIdx, { ...w, placement: { ...p, w: n } })));
        pGrid.appendChild(mkNumberInput(doc, "h", asInt(p.h, 3), (n) => patchWidget(cardIdx, wIdx, { ...w, placement: { ...p, h: n } })));
        wItem.appendChild(pGrid);

        // Minimal spec guidance for the most common fields
        wItem.appendChild(renderWidgetSpecEditorPlaceholder(doc));
        if (w.type === "chart") {
          const spec: any = w.spec ?? {};
          const dims = allowedDimensionOptions(semantic, String(w.grain));
          const meas = allowedMeasureOptions(semantic, String(w.grain));
          wItem.appendChild(
            mkSelect(doc, "chart.type", String(spec.type ?? "bar"), [{ value: "bar", label: "bar" }, { value: "line", label: "line" }], (v) =>
              patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, type: v } } as any)
            )
          );
          wItem.appendChild(
            mkSelect(doc, "x.dimension", String(spec?.x?.dimension ?? ""), dims, (v) =>
              patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, x: { ...(spec.x ?? {}), dimension: v } } } as any)
            )
          );
          wItem.appendChild(
            mkSelect(doc, "y.measure", String(spec?.y?.measure ?? ""), meas, (v) =>
              patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, y: { ...(spec.y ?? {}), measure: v } } } as any)
            )
          );
        }
        if (w.type === "breakdown") {
          const spec: any = w.spec ?? {};
          const dims = allowedDimensionOptions(semantic, String(w.grain));
          const meas = allowedMeasureOptions(semantic, String(w.grain));
          wItem.appendChild(mkSelect(doc, "dimension", String(spec.dimension ?? ""), dims, (v) => patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, dimension: v } } as any)));
          wItem.appendChild(mkSelect(doc, "measure", String(spec.measure ?? ""), meas, (v) => patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, measure: v } } as any)));
          wItem.appendChild(mkNumberInput(doc, "limit", asInt(spec.limit, 12), (n) => patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, limit: n } } as any), { min: 1, max: 500 }));
        }
        if (w.type === "stat_value") {
          const spec: any = w.spec ?? {};
          const meas = allowedMeasureOptions(semantic, String(w.grain));
          wItem.appendChild(mkTextInput(doc, "label", String(spec.label ?? ""), (v) => patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, label: v } } as any)));
          wItem.appendChild(mkSelect(doc, "measure", String(spec.measure ?? ""), meas, (v) => patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, measure: v } } as any)));
        }
        if (w.type === "stat_list") {
          const spec: any = w.spec ?? { rows: [] };
          const rows: any[] = Array.isArray(spec.rows) ? spec.rows : [];
          const head = doc.createElement("div");
          head.className = "ga-settings-note";
          head.textContent = `Rows: ${rows.length}`;
          wItem.appendChild(head);
        }

        wBox.appendChild(wItem);
      });

      cardItem.appendChild(wBox);
      cardsBox.appendChild(cardItem);
    });

    right.appendChild(cardsBox);

    root.appendChild(left);
    root.appendChild(right);

    function patchCard(cardIdx: number, partial: Partial<CardPlacementDef>) {
      const next = cloneJson(draft);
      const sec = next.dashboard.sections[activeSectionIdx];
      const cards = [...sec.layout.cards];
      cards[cardIdx] = { ...cards[cardIdx], ...partial } as any;
      sec.layout.cards = cards;
      draft = next;
      applyDraft();
      render();
    }

    function patchWidget(cardIdx: number, widgetIdx: number, nextWidget: WidgetDef) {
      const next = cloneJson(draft);
      const sec = next.dashboard.sections[activeSectionIdx];
      const card = sec.layout.cards[cardIdx];
      const children = ((card.card as any).children ?? []) as WidgetDef[];
      children[widgetIdx] = nextWidget;
      (card.card as any).children = children;
      draft = next;
      applyDraft();
      render();
    }

    function moveCard(cardIdx: number, delta: -1 | 1) {
      const cards = draft.dashboard.sections[activeSectionIdx].layout.cards ?? [];
      const nextIdx = cardIdx + delta;
      if (nextIdx < 0 || nextIdx >= cards.length) return;
      const next = cloneJson(draft);
      const arr = [...next.dashboard.sections[activeSectionIdx].layout.cards];
      const [picked] = arr.splice(cardIdx, 1);
      arr.splice(nextIdx, 0, picked);
      next.dashboard.sections[activeSectionIdx].layout.cards = arr;
      draft = next;
      applyDraft();
      render();
    }

    function moveWidget(cardIdx: number, widgetIdx: number, delta: -1 | 1) {
      const sec = draft.dashboard.sections[activeSectionIdx];
      const card = sec.layout.cards[cardIdx];
      const children: any[] = (card.card as any).children ?? [];
      const nextIdx = widgetIdx + delta;
      if (nextIdx < 0 || nextIdx >= children.length) return;
      const next = cloneJson(draft);
      const c = next.dashboard.sections[activeSectionIdx].layout.cards[cardIdx];
      const arr: any[] = [...((c.card as any).children ?? [])];
      const [picked] = arr.splice(widgetIdx, 1);
      arr.splice(nextIdx, 0, picked);
      (c.card as any).children = arr;
      draft = next;
      applyDraft();
      render();
    }
  };

  render();
  return root;
}
