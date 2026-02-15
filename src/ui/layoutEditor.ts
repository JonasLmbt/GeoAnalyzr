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
  input.addEventListener("change", () => onChange(input.value));
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

function mkToggle(doc: Document, label: string, checked: boolean, onChange: (next: boolean) => void): HTMLDivElement {
  const f = mkField(doc, label);
  const input = doc.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  f.inputHost.appendChild(input);
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

export function renderLayoutEditor(args: {
  doc: Document;
  semantic: SemanticRegistry;
  dashboard: DashboardDoc;
  onChange: OnChange;
  statusEl: HTMLElement;
}): HTMLElement {
  const { doc, semantic, onChange, statusEl } = args;

  const wrap = doc.createElement("div");
  wrap.className = "ga-layout-editor-wrap";

  const head = doc.createElement("div");
  head.className = "ga-le-head";

  const help = doc.createElement("div");
  help.className = "ga-settings-note";
  help.textContent =
    "Build your dashboard here (sections, cards, widgets, global filters). Use Apply changes when you're done. Advanced JSON editors let you configure drilldowns, stat rows, extra filters, etc.";

  const headActions = doc.createElement("div");
  headActions.className = "ga-le-head-actions";

  const autoWrap = doc.createElement("label");
  autoWrap.className = "ga-le-toggle";
  const auto = doc.createElement("input");
  auto.type = "checkbox";
  const autoTxt = doc.createElement("span");
  autoTxt.textContent = "Auto-apply";
  autoWrap.appendChild(auto);
  autoWrap.appendChild(autoTxt);

  const applyBtn = mkBtn(doc, "Apply changes", () => applyNow(), "primary");
  const revertBtn = mkBtn(doc, "Revert", () => revertNow(), "ghost");

  headActions.appendChild(autoWrap);
  headActions.appendChild(applyBtn);
  headActions.appendChild(revertBtn);

  head.appendChild(help);
  head.appendChild(headActions);
  wrap.appendChild(head);

  const root = doc.createElement("div");
  root.className = "ga-layout-editor";
  wrap.appendChild(root);

  let applied = cloneJson(args.dashboard);
  let draft = cloneJson(args.dashboard);
  let dirty = false;
  let autoApply = false;

  type Active = { kind: "global_filters" } | { kind: "section"; idx: number };
  let active: Active = { kind: "section", idx: 0 };

  const grains = allowedGrains(semantic);
  const grainDefault = grains[0] ?? "round";
  const grainOpts = grains.map((g) => ({ value: g, label: g }));

  const setStatus = (kind: "ok" | "error" | "info" | "neutral", message: string) => {
    statusEl.textContent = message;
    statusEl.className = "ga-settings-status";
    if (kind === "ok") statusEl.classList.add("ok");
    if (kind === "error") statusEl.classList.add("error");
  };

  const validateDraft = (): { ok: true } | { ok: false; error: string } => {
    try {
      validateDashboardAgainstSemantic(semantic, draft);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };

  const syncActions = () => {
    applyBtn.disabled = !dirty;
    revertBtn.disabled = !dirty;
  };

  const applyNow = () => {
    const res = validateDraft();
    if (!res.ok) return setStatus("error", res.error);
    onChange(cloneJson(draft));
    applied = cloneJson(draft);
    dirty = false;
    syncActions();
    setStatus("ok", "Layout applied.");
  };

  const revertNow = () => {
    if (!dirty) return;
    if (!confirm("Discard unsaved layout changes?")) return;
    draft = cloneJson(applied);
    dirty = false;
    syncActions();
    setStatus("neutral", "");
    render();
  };

  syncActions();

  let debounce: number | null = null;
  const markDirty = (rerender = true) => {
    dirty = true;
    syncActions();
    if (debounce !== null) (doc.defaultView as any)?.clearTimeout?.(debounce);
    debounce = (doc.defaultView as any)?.setTimeout?.(() => {
      debounce = null;
      const res = validateDraft();
      if (!res.ok) return setStatus("error", res.error);
      if (!autoApply) return setStatus("ok", "Valid. Click Apply changes to update the dashboard.");
      setStatus("info", "Applying...");
      applyNow();
    }, 200) as any;
    if (rerender) render();
  };

  auto.addEventListener("change", () => {
    autoApply = auto.checked;
    if (autoApply && dirty) markDirty(false);
  });

  const renderGlobalFilters = (right: HTMLElement) => {
    const current: any =
      (draft.dashboard as any).globalFilters ??
      ({
        enabled: true,
        layout: { variant: "compact" },
        controls: [],
        buttons: { apply: false, reset: true }
      } as any);

    const patch = (next: any) => {
      const n = cloneJson(draft) as any;
      n.dashboard.globalFilters = next;
      draft = n;
      markDirty();
    };

    const controls: any[] = Array.isArray(current.controls) ? current.controls : [];
    const dimsAll = Object.keys((semantic.dimensions ?? {}) as any).map((id) => ({ value: id, label: id }));

    const addRow = doc.createElement("div");
    addRow.className = "ga-le-toprow";
    addRow.appendChild(
      mkBtn(
        doc,
        "Add select filter",
        () => {
          const id = `filter_${Math.random().toString(36).slice(2, 7)}`;
          patch({
            ...current,
            controls: [
              ...controls,
              { id, type: "select", label: "New filter", dimension: "", default: "all", options: "auto_distinct", appliesTo: [grainDefault] }
            ]
          });
        },
        "primary"
      )
    );
    addRow.appendChild(
      mkBtn(
        doc,
        "Add date range",
        () => {
          const id = `date_${Math.random().toString(36).slice(2, 7)}`;
          patch({ ...current, controls: [...controls, { id, type: "date_range", label: "Date range", default: { fromTs: null, toTs: null }, appliesTo: [grainDefault] }] });
        },
        "primary"
      )
    );
    right.appendChild(addRow);

    right.appendChild(mkToggle(doc, "enabled", !!current.enabled, (v) => patch({ ...current, enabled: v })));
    right.appendChild(
      mkSelect(doc, "layout.variant", String(current?.layout?.variant ?? "compact"), [{ value: "compact", label: "compact" }, { value: "full", label: "full" }], (v) =>
        patch({ ...current, layout: { ...(current.layout ?? {}), variant: v } })
      )
    );
    right.appendChild(mkToggle(doc, "buttons.reset", current?.buttons?.reset !== false, (v) => patch({ ...current, buttons: { ...(current.buttons ?? {}), reset: v } })));
    right.appendChild(mkToggle(doc, "buttons.apply", !!current?.buttons?.apply, (v) => patch({ ...current, buttons: { ...(current.buttons ?? {}), apply: v } })));
    right.appendChild(renderAdvancedJson(doc, "Advanced JSON (globalFilters)", current, (next) => patch(next)));
    right.appendChild(mkHr(doc));

    controls.forEach((ctrl, idx) => {
      const item = doc.createElement("div");
      item.className = "ga-le-item";

      const row = doc.createElement("div");
      row.className = "ga-le-toprow";
      const t = doc.createElement("div");
      t.className = "ga-le-box-head";
      t.textContent = `${ctrl.type} — ${ctrl.label || ctrl.id}`;
      row.appendChild(t);
      row.appendChild(
        mkBtn(
          doc,
          "Delete",
          () => {
            if (!confirm(`Delete global filter '${ctrl.label || ctrl.id}'?`)) return;
            patch({ ...current, controls: controls.filter((_: any, i: number) => i !== idx) });
          },
          "danger"
        )
      );
      item.appendChild(row);

      const patchCtrl = (nextCtrl: any) => patch({ ...current, controls: controls.map((c, i) => (i === idx ? nextCtrl : c)) });

      item.appendChild(mkTextInput(doc, "id", String(ctrl.id ?? ""), (v) => patchCtrl({ ...ctrl, id: v })));
      item.appendChild(
        mkSelect(
          doc,
          "type",
          String(ctrl.type ?? "select"),
          [
            { value: "select", label: "select" },
            { value: "date_range", label: "date_range" }
          ],
          (v) => {
            if (v === ctrl.type) return;
            if (v === "date_range") {
              patchCtrl({ id: ctrl.id, type: "date_range", label: ctrl.label || "Date range", default: { fromTs: null, toTs: null }, appliesTo: ctrl.appliesTo ?? [grainDefault] });
            } else {
              patchCtrl({
                id: ctrl.id,
                type: "select",
                label: ctrl.label || "New filter",
                dimension: "",
                default: "all",
                options: "auto_distinct",
                appliesTo: ctrl.appliesTo ?? [grainDefault]
              });
            }
          }
        )
      );
      item.appendChild(mkTextInput(doc, "label", String(ctrl.label ?? ""), (v) => patchCtrl({ ...ctrl, label: v })));
      item.appendChild(mkMultiSelect(doc, "appliesTo", Array.isArray(ctrl.appliesTo) ? ctrl.appliesTo : [grainDefault], grainOpts, (vals) => patchCtrl({ ...ctrl, appliesTo: vals })));

      if (ctrl.type === "select") {
        item.appendChild(mkSelect(doc, "dimension", String(ctrl.dimension ?? ""), dimsAll, (v) => patchCtrl({ ...ctrl, dimension: v })));
        item.appendChild(
          mkSelect(doc, "options", String(ctrl.options ?? "auto_distinct"), [{ value: "auto_distinct", label: "auto_distinct" }, { value: "auto_teammates", label: "auto_teammates" }], (v) =>
            patchCtrl({ ...ctrl, options: v })
          )
        );
        item.appendChild(mkTextInput(doc, "default", String(ctrl.default ?? "all"), (v) => patchCtrl({ ...ctrl, default: v })));
        item.appendChild(
          mkSelect(doc, "presentation", String(ctrl.presentation ?? "dropdown"), [{ value: "dropdown", label: "dropdown" }, { value: "map", label: "map" }], (v) =>
            patchCtrl({ ...ctrl, presentation: v })
          )
        );
        if (ctrl.presentation === "map") {
          const map = ctrl.map ?? {};
          item.appendChild(
            mkSelect(doc, "map.variant", String(map.variant ?? "compact"), [{ value: "compact", label: "compact" }, { value: "wide", label: "wide" }], (v) =>
              patchCtrl({ ...ctrl, map: { ...map, variant: v } })
            )
          );
          item.appendChild(
            mkNumberInput(doc, "map.height", asInt(map.height, 340), (n) => patchCtrl({ ...ctrl, map: { ...map, height: Math.max(160, Math.min(1200, n)) } }), {
              min: 160,
              max: 1200,
              step: 10
            })
          );
          item.appendChild(mkToggle(doc, "map.restrictToOptions", !!map.restrictToOptions, (v) => patchCtrl({ ...ctrl, map: { ...map, restrictToOptions: v } })));
          item.appendChild(mkToggle(doc, "map.tintSelectable", map.tintSelectable !== false, (v) => patchCtrl({ ...ctrl, map: { ...map, tintSelectable: v } })));
        }
      } else if (ctrl.type === "date_range") {
        const btnRow = doc.createElement("div");
        btnRow.className = "ga-le-toprow";
        btnRow.appendChild(mkBtn(doc, "Reset default", () => patchCtrl({ ...ctrl, default: { fromTs: null, toTs: null } })));
        item.appendChild(btnRow);
      }

      item.appendChild(renderAdvancedJson(doc, "Advanced JSON (control)", ctrl, (next) => patchCtrl(next)));
      right.appendChild(item);
    });
  };

  const render = () => {
    root.innerHTML = "";

    const left = doc.createElement("div");
    left.className = "ga-le-left";
    const right = doc.createElement("div");
    right.className = "ga-le-right";

    const sections: SectionDef[] = ((draft.dashboard.sections ?? []) as any) ?? [];
    if (active.kind === "section") {
      if (active.idx < 0) active = { kind: "section", idx: 0 };
      if (active.idx >= sections.length) active = { kind: "section", idx: Math.max(0, sections.length - 1) };
    }

    const leftHead = doc.createElement("div");
    leftHead.className = "ga-le-left-head";
    leftHead.appendChild(
      mkBtn(
        doc,
        "Add section",
        () => {
          const next = cloneJson(draft) as any;
          next.dashboard.sections = [...(next.dashboard.sections ?? []), defaultSection()];
          draft = next;
          active = { kind: "section", idx: next.dashboard.sections.length - 1 };
          markDirty();
        },
        "primary"
      )
    );
    left.appendChild(leftHead);

    const list = doc.createElement("div");
    list.className = "ga-le-list";

    const globalItem = doc.createElement("button");
    globalItem.type = "button";
    globalItem.className = "ga-le-list-item";
    globalItem.classList.toggle("active", active.kind === "global_filters");
    globalItem.textContent = "Global filters";
    globalItem.addEventListener("click", () => {
      active = { kind: "global_filters" };
      render();
    });
    list.appendChild(globalItem);

    sections.forEach((s, idx) => {
      const item = doc.createElement("button");
      item.type = "button";
      item.className = "ga-le-list-item";
      item.classList.toggle("active", active.kind === "section" && active.idx === idx);
      item.textContent = s.title || s.id || "(untitled)";
      item.addEventListener("click", () => {
        active = { kind: "section", idx };
        render();
      });
      list.appendChild(item);
    });
    left.appendChild(list);

    if (active.kind === "global_filters") {
      renderGlobalFilters(right);
      root.appendChild(left);
      root.appendChild(right);
      return;
    }

    const section = sections[active.idx];
    if (!section) {
      const note = doc.createElement("div");
      note.className = "ga-settings-note";
      note.textContent = "No sections yet. Click Add section to get started.";
      right.appendChild(note);
      root.appendChild(left);
      root.appendChild(right);
      return;
    }

    const topRow = doc.createElement("div");
    topRow.className = "ga-le-toprow";
    topRow.appendChild(
      mkBtn(doc, "Move up", () => {
        if (active.idx <= 0) return;
        const next = cloneJson(draft) as any;
        const arr = [...next.dashboard.sections];
        const [picked] = arr.splice(active.idx, 1);
        arr.splice(active.idx - 1, 0, picked);
        next.dashboard.sections = arr;
        draft = next;
        active = { kind: "section", idx: active.idx - 1 };
        markDirty();
      })
    );
    topRow.appendChild(
      mkBtn(doc, "Move down", () => {
        if (active.idx >= sections.length - 1) return;
        const next = cloneJson(draft) as any;
        const arr = [...next.dashboard.sections];
        const [picked] = arr.splice(active.idx, 1);
        arr.splice(active.idx + 1, 0, picked);
        next.dashboard.sections = arr;
        draft = next;
        active = { kind: "section", idx: active.idx + 1 };
        markDirty();
      })
    );
    topRow.appendChild(
      mkBtn(
        doc,
        "Delete",
        () => {
          if (!confirm(`Delete section '${section.title || section.id}'?`)) return;
          const next = cloneJson(draft) as any;
          next.dashboard.sections = next.dashboard.sections.filter((_: any, i: number) => i !== active.idx);
          draft = next;
          active = { kind: "section", idx: Math.max(0, active.idx - 1) };
          markDirty();
        },
        "danger"
      )
    );
    right.appendChild(topRow);

    const patchSection = (partial: Partial<SectionDef> & { filterScope?: any }) => {
      const next = cloneJson(draft) as any;
      next.dashboard.sections[active.idx] = { ...next.dashboard.sections[active.idx], ...partial } as any;
      draft = next;
      markDirty();
    };

    right.appendChild(mkTextInput(doc, "section.id", section.id, (v) => patchSection({ id: v })));
    right.appendChild(mkTextInput(doc, "section.title", section.title, (v) => patchSection({ title: v })));
    right.appendChild(
      mkNumberInput(
        doc,
        "layout.columns",
        asInt(section.layout?.columns, 12),
        (n) => patchSection({ layout: { ...section.layout, columns: Math.max(1, Math.min(24, n)) } as any }),
        { min: 1, max: 24 }
      )
    );

    const gf = (draft.dashboard as any).globalFilters;
    const controlIds = gf?.enabled ? (gf.controls ?? []).map((c: any) => c.id) : [];
    const ctrlOpts = controlIds.map((id: string) => ({ value: id, label: id }));
    const include = Array.isArray((section as any)?.filterScope?.include) ? (section as any).filterScope.include : [];
    const exclude = Array.isArray((section as any)?.filterScope?.exclude) ? (section as any).filterScope.exclude : [];
    if (ctrlOpts.length > 0) {
      const fsBox = doc.createElement("div");
      fsBox.className = "ga-le-box";
      const fsHead = doc.createElement("div");
      fsHead.className = "ga-le-box-head";
      fsHead.textContent = "filterScope (optional)";
      fsBox.appendChild(fsHead);
      fsBox.appendChild(mkMultiSelect(doc, "include", include, ctrlOpts, (vals) => patchSection({ filterScope: normalizeFilterScope({ ...(section as any).filterScope, include: vals }) } as any)));
      fsBox.appendChild(mkMultiSelect(doc, "exclude", exclude, ctrlOpts, (vals) => patchSection({ filterScope: normalizeFilterScope({ ...(section as any).filterScope, exclude: vals }) } as any)));
      right.appendChild(fsBox);
    }

    right.appendChild(mkHr(doc));

    const widgetTypes: WidgetDef["type"][] = ["stat_list", "stat_value", "chart", "breakdown", "record_list", "leader_list"];
    const typeOpts = widgetTypes.map((t) => ({ value: t, label: t }));

    const cardsBox = doc.createElement("div");
    cardsBox.className = "ga-le-box";
    const ch = doc.createElement("div");
    ch.className = "ga-le-box-head";
    ch.textContent = "Cards";
    cardsBox.appendChild(ch);

    const patchCard = (cardIdx: number, partial: Partial<CardPlacementDef>) => {
      const next = cloneJson(draft) as any;
      const sec = next.dashboard.sections[active.idx];
      const cards = [...sec.layout.cards];
      cards[cardIdx] = { ...cards[cardIdx], ...partial } as any;
      sec.layout.cards = cards;
      draft = next;
      markDirty();
    };

    const patchWidget = (cardIdx: number, widgetIdx: number, nextWidget: WidgetDef) => {
      const next = cloneJson(draft) as any;
      const sec = next.dashboard.sections[active.idx];
      const card = sec.layout.cards[cardIdx];
      const children = ((card.card as any).children ?? []) as WidgetDef[];
      children[widgetIdx] = nextWidget;
      (card.card as any).children = children;
      draft = next;
      markDirty();
    };

    const moveCard = (cardIdx: number, delta: -1 | 1) => {
      const cards = (draft.dashboard.sections[active.idx].layout.cards ?? []) as any[];
      const nextIdx = cardIdx + delta;
      if (nextIdx < 0 || nextIdx >= cards.length) return;
      const next = cloneJson(draft) as any;
      const arr = [...next.dashboard.sections[active.idx].layout.cards];
      const [picked] = arr.splice(cardIdx, 1);
      arr.splice(nextIdx, 0, picked);
      next.dashboard.sections[active.idx].layout.cards = arr;
      draft = next;
      markDirty();
    };

    const moveWidget = (cardIdx: number, widgetIdx: number, delta: -1 | 1) => {
      const sec = draft.dashboard.sections[active.idx];
      const card = sec.layout.cards[cardIdx];
      const children: any[] = (card.card as any).children ?? [];
      const nextIdx = widgetIdx + delta;
      if (nextIdx < 0 || nextIdx >= children.length) return;
      const next = cloneJson(draft) as any;
      const c = next.dashboard.sections[active.idx].layout.cards[cardIdx];
      const arr: any[] = [...((c.card as any).children ?? [])];
      const [picked] = arr.splice(widgetIdx, 1);
      arr.splice(nextIdx, 0, picked);
      (c.card as any).children = arr;
      draft = next;
      markDirty();
    };

    cardsBox.appendChild(
      mkBtn(
        doc,
        "Add card",
        () => {
          const next = cloneJson(draft) as any;
          next.dashboard.sections[active.idx].layout.cards = [...(next.dashboard.sections[active.idx].layout.cards ?? []), defaultCard()];
          draft = next;
          markDirty();
        },
        "primary"
      )
    );

    (section.layout.cards ?? []).forEach((card: any, cardIdx: number) => {
      const details = doc.createElement("details");
      details.open = true;
      details.className = "ga-le-details";
      const summary = doc.createElement("summary");
      summary.textContent = `${card.title || "Card"} (${card.cardId})`;
      details.appendChild(summary);

      const cardItem = doc.createElement("div");
      cardItem.className = "ga-le-item";

      const cardActions = doc.createElement("div");
      cardActions.className = "ga-le-toprow";
      cardActions.appendChild(mkBtn(doc, "Up", () => moveCard(cardIdx, -1)));
      cardActions.appendChild(mkBtn(doc, "Down", () => moveCard(cardIdx, 1)));
      cardActions.appendChild(
        mkBtn(
          doc,
          "Delete card",
          () => {
            if (!confirm(`Delete card '${card.title || card.cardId}'?`)) return;
            const next = cloneJson(draft) as any;
            next.dashboard.sections[active.idx].layout.cards = next.dashboard.sections[active.idx].layout.cards.filter((_: any, i: number) => i !== cardIdx);
            draft = next;
            markDirty();
          },
          "danger"
        )
      );
      cardItem.appendChild(cardActions);

      cardItem.appendChild(mkTextInput(doc, "cardId", String(card.cardId ?? ""), (v) => patchCard(cardIdx, { cardId: v } as any)));
      cardItem.appendChild(mkTextInput(doc, "title", String(card.title ?? ""), (v) => patchCard(cardIdx, { title: v } as any)));

      const grid = doc.createElement("div");
      grid.className = "ga-le-grid4";
      grid.appendChild(mkNumberInput(doc, "x", asInt(card.x, 0), (n) => patchCard(cardIdx, { x: n } as any)));
      grid.appendChild(mkNumberInput(doc, "y", asInt(card.y, 0), (n) => patchCard(cardIdx, { y: n } as any)));
      grid.appendChild(mkNumberInput(doc, "w", asInt(card.w, 12), (n) => patchCard(cardIdx, { w: n } as any)));
      grid.appendChild(mkNumberInput(doc, "h", asInt(card.h, 10), (n) => patchCard(cardIdx, { h: n } as any)));
      cardItem.appendChild(grid);

      const wBox = doc.createElement("div");
      wBox.className = "ga-le-subbox";
      const wh = doc.createElement("div");
      wh.className = "ga-le-subhead";
      const children: WidgetDef[] = ((card.card as any).children ?? []) as any;
      wh.textContent = `Widgets (${children.length})`;
      wBox.appendChild(wh);
      wBox.appendChild(
        mkBtn(
          doc,
          "Add widget",
          () => {
            const next = cloneJson(draft) as any;
            const c = next.dashboard.sections[active.idx].layout.cards[cardIdx];
            const w = defaultWidget(grainDefault, widgetTypes[0]);
            (c.card as any).children = [...(((c.card as any).children ?? []) as any[]), w];
            draft = next;
            markDirty();
          },
          "primary"
        )
      );

      children.forEach((w: any, wIdx: number) => {
        const wDetails = doc.createElement("details");
        wDetails.open = false;
        wDetails.className = "ga-le-details";
        const wSummary = doc.createElement("summary");
        wSummary.textContent = `${w.type} — ${w.title || w.widgetId}`;
        wDetails.appendChild(wSummary);

        const wItem = doc.createElement("div");
        wItem.className = "ga-le-widget";

        const wActions = doc.createElement("div");
        wActions.className = "ga-le-toprow";
        wActions.appendChild(mkBtn(doc, "Up", () => moveWidget(cardIdx, wIdx, -1)));
        wActions.appendChild(mkBtn(doc, "Down", () => moveWidget(cardIdx, wIdx, 1)));
        wActions.appendChild(
          mkBtn(
            doc,
            "Delete",
            () => {
              if (!confirm(`Delete widget '${w.title || w.widgetId}'?`)) return;
              const next = cloneJson(draft) as any;
              const c = next.dashboard.sections[active.idx].layout.cards[cardIdx];
              (c.card as any).children = (((c.card as any).children ?? []) as any[]).filter((_: any, i: number) => i !== wIdx);
              draft = next;
              markDirty();
            },
            "danger"
          )
        );
        wItem.appendChild(wActions);

        wItem.appendChild(mkTextInput(doc, "widgetId", String(w.widgetId ?? ""), (v) => patchWidget(cardIdx, wIdx, { ...w, widgetId: v })));
        wItem.appendChild(
          mkSelect(doc, "type", String(w.type ?? "stat_list"), typeOpts, (v) => {
            const nextWidget = defaultWidget(String(w.grain ?? grainDefault), v as any);
            nextWidget.widgetId = w.widgetId;
            nextWidget.title = w.title;
            nextWidget.grain = w.grain ?? grainDefault;
            nextWidget.placement = w.placement;
            patchWidget(cardIdx, wIdx, nextWidget as any);
          })
        );
        wItem.appendChild(mkTextInput(doc, "title", String(w.title ?? ""), (v) => patchWidget(cardIdx, wIdx, { ...w, title: v })));
        wItem.appendChild(mkSelect(doc, "grain", String(w.grain ?? grainDefault), grainOpts, (v) => patchWidget(cardIdx, wIdx, { ...w, grain: v })));

        const p = (w.placement as any) ?? { x: 0, y: 0, w: 12, h: 3 };
        const pGrid = doc.createElement("div");
        pGrid.className = "ga-le-grid4";
        pGrid.appendChild(mkNumberInput(doc, "x", asInt(p.x, 0), (n) => patchWidget(cardIdx, wIdx, { ...w, placement: { ...p, x: n } })));
        pGrid.appendChild(mkNumberInput(doc, "y", asInt(p.y, 0), (n) => patchWidget(cardIdx, wIdx, { ...w, placement: { ...p, y: n } })));
        pGrid.appendChild(mkNumberInput(doc, "w", asInt(p.w, 12), (n) => patchWidget(cardIdx, wIdx, { ...w, placement: { ...p, w: n } })));
        pGrid.appendChild(mkNumberInput(doc, "h", asInt(p.h, 3), (n) => patchWidget(cardIdx, wIdx, { ...w, placement: { ...p, h: n } })));
        wItem.appendChild(pGrid);

        const widgetGrain = String(w.grain ?? grainDefault);
        const spec: any = w.spec ?? {};
        const dims = allowedDimensionOptions(semantic, widgetGrain);
        const meas = allowedMeasureOptions(semantic, widgetGrain);

        if (w.type === "chart") {
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
          wItem.appendChild(
            mkToggle(doc, "actions.hover", !!spec?.actions?.hover, (v) =>
              patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, actions: { ...(spec.actions ?? {}), hover: v } } } as any)
            )
          );
          wItem.appendChild(
            renderClickActionEditor(doc, "actions.click (drilldown)", spec.actions, (nextActions) =>
              patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, actions: nextActions } } as any)
            )
          );
        } else if (w.type === "breakdown") {
          wItem.appendChild(mkSelect(doc, "dimension", String(spec.dimension ?? ""), dims, (v) => patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, dimension: v } } as any)));
          wItem.appendChild(mkSelect(doc, "measure", String(spec.measure ?? ""), meas, (v) => patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, measure: v } } as any)));
          wItem.appendChild(mkNumberInput(doc, "limit", asInt(spec.limit, 12), (n) => patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, limit: n } } as any), { min: 1, max: 500 }));
          wItem.appendChild(
            renderClickActionEditor(doc, "actions.click (drilldown)", spec.actions, (nextActions) =>
              patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, actions: nextActions } } as any)
            )
          );
        } else if (w.type === "stat_value") {
          wItem.appendChild(mkTextInput(doc, "label", String(spec.label ?? ""), (v) => patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, label: v } } as any)));
          wItem.appendChild(mkSelect(doc, "measure", String(spec.measure ?? ""), meas, (v) => patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, measure: v } } as any)));
          wItem.appendChild(
            renderClickActionEditor(doc, "actions.click (drilldown)", spec.actions, (nextActions) =>
              patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, actions: nextActions } } as any)
            )
          );
        } else if (w.type === "stat_list") {
          const rows: any[] = Array.isArray(spec.rows) ? spec.rows : [];
          const rowsBox = doc.createElement("div");
          rowsBox.className = "ga-le-subbox";
          const rh = doc.createElement("div");
          rh.className = "ga-le-subhead";
          rh.textContent = `Rows (${rows.length})`;
          rowsBox.appendChild(rh);
          rowsBox.appendChild(
            mkBtn(doc, "Add row", () => patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, rows: [...rows, { label: "Row", measure: "" }] } } as any), "primary")
          );
          rows.forEach((r, rIdx) => {
            const rowItem = doc.createElement("div");
            rowItem.className = "ga-le-item";
            rowItem.appendChild(
              mkTextInput(doc, "label", String(r.label ?? ""), (v) => {
                const nextRows = rows.map((x, i) => (i === rIdx ? { ...x, label: v } : x));
                patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, rows: nextRows } } as any);
              })
            );
            rowItem.appendChild(
              mkSelect(doc, "measure", String(r.measure ?? ""), meas, (v) => {
                const nextRows = rows.map((x, i) => (i === rIdx ? { ...x, measure: v } : x));
                patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, rows: nextRows } } as any);
              })
            );
            rowItem.appendChild(
              renderClickActionEditor(doc, "row.actions.click (drilldown)", r.actions, (nextActions) => {
                const nextRows = rows.map((x, i) => (i === rIdx ? { ...x, actions: nextActions } : x));
                patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, rows: nextRows } } as any);
              })
            );
            const delRow = doc.createElement("div");
            delRow.className = "ga-le-toprow";
            delRow.appendChild(
              mkBtn(
                doc,
                "Delete row",
                () => {
                  if (!confirm("Delete this row?")) return;
                  const nextRows = rows.filter((_, i) => i !== rIdx);
                  patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, rows: nextRows } } as any);
                },
                "danger"
              )
            );
            rowItem.appendChild(delRow);
            rowsBox.appendChild(rowItem);
          });
          wItem.appendChild(rowsBox);
        } else {
          wItem.appendChild(renderWidgetSpecEditorPlaceholder(doc));
        }

        wItem.appendChild(renderAdvancedJson(doc, "Advanced JSON (spec)", spec, (next) => patchWidget(cardIdx, wIdx, { ...w, spec: next } as any)));

        wDetails.appendChild(wItem);
        wBox.appendChild(wDetails);
      });

      cardItem.appendChild(wBox);
      details.appendChild(cardItem);
      cardsBox.appendChild(details);
    });

    right.appendChild(cardsBox);

    root.appendChild(left);
    root.appendChild(right);
  };

  render();
  const initRes = validateDraft();
  if (!initRes.ok) setStatus("error", initRes.error);
  return wrap;
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
  note.textContent = "Advanced widget settings are available in the Advanced JSON editor below.";
  return note;
}

function renderAdvancedJson(doc: Document, title: string, value: unknown, onApply: (next: any) => void): HTMLElement {
  const details = doc.createElement("details");
  details.className = "ga-le-adv";
  const summary = doc.createElement("summary");
  summary.textContent = title;
  details.appendChild(summary);

  const areaField = mkField(doc, "JSON");
  const area = doc.createElement("textarea");
  area.value = JSON.stringify(value ?? {}, null, 2);
  areaField.inputHost.appendChild(area);
  details.appendChild(areaField.wrap);

  const actions = doc.createElement("div");
  actions.className = "ga-le-toprow";
  actions.appendChild(
    mkBtn(doc, "Format", () => {
      try {
        const parsed = JSON.parse(area.value);
        area.value = JSON.stringify(parsed, null, 2);
      } catch {
        // ignore
      }
    })
  );
  actions.appendChild(
    mkBtn(
      doc,
      "Apply JSON",
      () => {
        const parsed = JSON.parse(area.value);
        onApply(parsed);
      },
      "primary"
    )
  );
  details.appendChild(actions);
  return details;
}

function renderClickActionEditor(doc: Document, title: string, actions: any, onChange: (nextActions: any) => void): HTMLElement {
  const box = doc.createElement("div");
  box.className = "ga-le-subbox";
  const head = doc.createElement("div");
  head.className = "ga-le-subhead";
  head.textContent = title;
  box.appendChild(head);

  const current = actions ?? {};
  const click = current?.click ?? null;

  box.appendChild(
    mkToggle(doc, "enabled", !!click, (enabled) => {
      const next = { ...(current ?? {}) };
      if (!enabled) delete next.click;
      else next.click = { type: "drilldown", target: "rounds", columnsPreset: "default" };
      onChange(next);
    })
  );

  if (!click) return box;

  box.appendChild(
    mkSelect(
      doc,
      "target",
      String(click.target ?? "rounds"),
      ["rounds", "games", "sessions", "players"].map((t) => ({ value: t, label: t })),
      (v) => onChange({ ...(current ?? {}), click: { ...click, target: v } })
    )
  );
  box.appendChild(mkTextInput(doc, "columnsPreset", String(click.columnsPreset ?? ""), (v) => onChange({ ...(current ?? {}), click: { ...click, columnsPreset: v } })));
  box.appendChild(mkToggle(doc, "filterFromPoint", !!click.filterFromPoint, (v) => onChange({ ...(current ?? {}), click: { ...click, filterFromPoint: v } })));

  const sortBox = doc.createElement("div");
  sortBox.className = "ga-le-subbox";
  const sh = doc.createElement("div");
  sh.className = "ga-le-subhead";
  sh.textContent = "initialSort (optional)";
  sortBox.appendChild(sh);
  sortBox.appendChild(
    mkTextInput(doc, "key", String(click?.initialSort?.key ?? ""), (v) => {
      const key = v.trim();
      if (!key) {
        const nextClick = { ...click };
        delete (nextClick as any).initialSort;
        return onChange({ ...(current ?? {}), click: nextClick });
      }
      onChange({ ...(current ?? {}), click: { ...click, initialSort: { key, dir: click?.initialSort?.dir ?? "desc" } } });
    })
  );
  sortBox.appendChild(
    mkSelect(doc, "dir", String(click?.initialSort?.dir ?? "desc"), [{ value: "asc", label: "asc" }, { value: "desc", label: "desc" }], (v) => {
      if (!click?.initialSort?.key) return;
      onChange({ ...(current ?? {}), click: { ...click, initialSort: { ...click.initialSort, dir: v } } });
    })
  );
  box.appendChild(sortBox);

  const note = doc.createElement("div");
  note.className = "ga-settings-note";
  note.textContent = "For extraFilters and advanced settings, use Advanced JSON.";
  box.appendChild(note);

  return box;
}
