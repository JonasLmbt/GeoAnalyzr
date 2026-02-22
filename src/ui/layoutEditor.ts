import type { CardPlacementDef, DashboardDoc, SectionDef, WidgetDef } from "../config/dashboard.types";
import type { SemanticRegistry } from "../config/semantic.types";
import { validateDashboardAgainstSemantic } from "../engine/validate";
import { getDrilldownPresetsOverrideFromDashboard, mergeSemanticWithDashboard } from "../engine/semanticMerge";

type OnChange = (next: DashboardDoc) => void;

function cloneJson<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function safePrompt(doc: Document, message: string, value?: string): string | null {
  try {
    const w = doc.defaultView as any;
    const out = typeof w?.prompt === "function" ? w.prompt(message, value ?? "") : null;
    return typeof out === "string" ? out : null;
  } catch {
    return null;
  }
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
  b.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    (ev as any).stopImmediatePropagation?.();
    onClick();
  });
  return b;
}

function mkIconBtn(
  doc: Document,
  label: string,
  onClick: () => void,
  kind: "primary" | "danger" | "ghost" = "ghost"
): HTMLButtonElement {
  const b = mkBtn(doc, label, onClick, kind);
  b.classList.add("ga-le-btn-icon");
  b.setAttribute("aria-label", label);
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
  mode?: "section_layout" | "global_filters" | "drilldowns";
}): HTMLElement {
  const { doc, semantic, onChange, statusEl } = args;
  const mode = args.mode ?? "section_layout";
  const win = doc.defaultView ?? window;
  const safeConfirm = (msg: string): boolean => {
    try {
      return typeof (win as any).confirm === "function" ? (win as any).confirm(msg) : true;
    } catch {
      return true;
    }
  };

  const wrap = doc.createElement("div");
  wrap.className = "ga-layout-editor-wrap";

  const head = doc.createElement("div");
  head.className = "ga-le-head";

  const help = doc.createElement("div");
  help.className = "ga-settings-note";
  help.textContent =
    "Build your dashboard here (sections, cards, widgets, global filters). Tip: text fields apply on blur (click outside). Use Focus mode + the Outline to jump between cards/widgets without drowning in nested panels. Advanced JSON is optional - use it for drilldowns and other power features.";

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

  let editSectionIdx: number | null = null;
  let newPresetIdByTarget: Record<string, string> = {};

  // Legacy state kept for compile stability (legacy UI is now bypassed).
  type Active = { kind: "global_filters" } | { kind: "section"; idx: number };
  let active: Active = { kind: "section", idx: 0 };
  let lastSectionIdx = 0;
  let focusMode = true;
  let focusCardIdx = 0;
  let focusWidgetIdx = 0;
  let scrollToId: string | null = null;
  let editGlobalFilters = false;
  let editGlobalFilterIdx: number | null = null;
  let editDrilldownTarget: string | null = null;
  let editDrilldownPreset: { target: string; presetId: string } | null = null;

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
      validateDashboardAgainstSemantic(mergeSemanticWithDashboard(semantic, draft), draft);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };

  const syncActions = () => {
    applyBtn.disabled = !dirty;
    revertBtn.disabled = false;
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
    if (!dirty) {
      setStatus("ok", "Nothing to revert.");
      return;
    }
    if (!safeConfirm("Discard unsaved layout changes?")) return;
    draft = cloneJson(applied);
    dirty = false;
    syncActions();
    setStatus("ok", "Reverted.");
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

    const presets: Array<{ id: string; label: string; make: () => any }> = [
      {
        id: "country_map",
        label: "Country (map)",
        make: () => ({
          id: `country_${Math.random().toString(36).slice(2, 7)}`,
          type: "select",
          label: "Country",
          dimension: "true_country",
          default: "all",
          options: "auto_distinct",
          appliesTo: ["round"],
          presentation: "map",
          map: { variant: "compact", height: 340, restrictToOptions: true, tintSelectable: true }
        })
      },
      {
        id: "movement",
        label: "Movement",
        make: () => ({
          id: `move_${Math.random().toString(36).slice(2, 7)}`,
          type: "select",
          label: "Movement",
          dimension: "movement_type",
          default: "all",
          options: "auto_distinct",
          appliesTo: ["round"]
        })
      },
      {
        id: "mode_family",
        label: "Mode family",
        make: () => ({
          id: `mode_${Math.random().toString(36).slice(2, 7)}`,
          type: "select",
          label: "Mode family",
          dimension: "mode_family",
          default: "all",
          options: "auto_distinct",
          appliesTo: ["round"]
        })
      },
      {
        id: "guess_time",
        label: "Guess time bucket",
        make: () => ({
          id: `time_${Math.random().toString(36).slice(2, 7)}`,
          type: "select",
          label: "Guess time",
          dimension: "duration_bucket",
          default: "all",
          options: "auto_distinct",
          appliesTo: ["round"]
        })
      },
      {
        id: "teammate",
        label: "Teammate",
        make: () => ({
          id: `mate_${Math.random().toString(36).slice(2, 7)}`,
          type: "select",
          label: "Teammate",
          dimension: "teammate_name",
          default: "all",
          options: "auto_teammates",
          appliesTo: ["round"]
        })
      }
    ];

    const presetSel = doc.createElement("select");
    presetSel.className = "ga-le-inline-select";
    for (const p of presets) presetSel.appendChild(new Option(p.label, p.id));
    addRow.appendChild(presetSel);
    addRow.appendChild(
      mkBtn(
        doc,
        "Add preset",
        () => {
          const picked = presets.find((p) => p.id === presetSel.value) ?? presets[0];
          if (!picked) return;
          const ctrl = picked.make();
          // Keep appliesTo aligned with current grainDefault if possible.
          if (Array.isArray(ctrl.appliesTo) && ctrl.appliesTo.length) ctrl.appliesTo = [grainDefault];
          patch({ ...current, controls: [...controls, ctrl] });
        },
        "primary"
      )
    );
    right.appendChild(addRow);

    right.appendChild(mkToggle(doc, "enabled", !!current.enabled, (v) => patch({ ...current, enabled: v })));
    const gfNote = doc.createElement("div");
    gfNote.className = "ga-settings-note";
    gfNote.textContent = "`appliesTo` controls where each filter is active (round/game/session).";
    right.appendChild(gfNote);
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
            if (!safeConfirm(`Delete global filter '${ctrl.label || ctrl.id}'?`)) return;
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

  const mkModal = (title: string, onClose: () => void): { overlay: HTMLDivElement; body: HTMLDivElement } => {
    const overlay = doc.createElement("div");
    overlay.className = "ga-le-modal";

    const bg = doc.createElement("div");
    bg.className = "ga-le-modal-bg";
    bg.addEventListener("click", onClose);

    const panel = doc.createElement("div");
    panel.className = "ga-le-modal-panel";

    const header = doc.createElement("div");
    header.className = "ga-le-modal-header";
    const ht = doc.createElement("div");
    ht.className = "ga-le-modal-title";
    ht.textContent = title;
    header.appendChild(ht);
    header.appendChild(mkBtn(doc, "Close", onClose));

    const body = doc.createElement("div");
    body.className = "ga-le-modal-body";

    panel.appendChild(header);
    panel.appendChild(body);
    overlay.appendChild(bg);
    overlay.appendChild(panel);
    return { overlay, body };
  };

  function renderPanels(): boolean {
    try {
      wrap.querySelector(".ga-le-modal")?.remove();
    } catch {
      // ignore
    }

    const sem = mergeSemanticWithDashboard(semantic, draft);

    const panels = doc.createElement("div");
    panels.className = "ga-le-panels";
    // Root is a 2-column grid in legacy mode; span full width.
    (panels.style as any).gridColumn = "1 / -1";
    root.appendChild(panels);

    const sections: any[] = Array.isArray((draft.dashboard as any)?.sections) ? ((draft.dashboard as any).sections as any[]) : [];
    const setSections = (nextSections: any[]) => {
      const next = cloneJson(draft) as any;
      next.dashboard.sections = nextSections;
      draft = next;
      markDirty();
    };

    const ensureOneCardContainer = (sectionIdx: number) => {
      const next = cloneJson(draft) as any;
      const sec = next.dashboard.sections?.[sectionIdx];
      if (!sec) return;
      const cols = Math.max(1, Math.min(24, asInt(sec.layout?.columns, 12)));
      sec.layout = sec.layout ?? { mode: "grid", columns: cols, cards: [] };
      sec.layout.columns = cols;
      const cards = Array.isArray(sec.layout.cards) ? sec.layout.cards : [];
      if (cards.length === 0) cards.push(defaultCard());
      const first = cards[0];
      first.x = 0;
      first.y = 0;
      first.w = cols;
      first.h = Math.max(10, asInt(first.h, 12));
      first.title = String(sec.title ?? first.title ?? "Section");
      first.card = first.card ?? { type: "composite", children: [] };
      (first.card as any).children = Array.isArray((first.card as any).children) ? (first.card as any).children : [];
      sec.layout.cards = [first];
      next.dashboard.sections[sectionIdx] = sec;
      draft = next;
      markDirty();
    };

    const flattenCardsIntoFirst = (sectionIdx: number) => {
      const next = cloneJson(draft) as any;
      const sec = next.dashboard.sections?.[sectionIdx];
      if (!sec) return;
      const cols = Math.max(1, Math.min(24, asInt(sec.layout?.columns, 12)));
      const cards = Array.isArray(sec.layout?.cards) ? sec.layout.cards : [];
      if (cards.length <= 1) return ensureOneCardContainer(sectionIdx);

      const base = cards[0];
      base.card = base.card ?? { type: "composite", children: [] };
      const baseChildren: any[] = Array.isArray((base.card as any).children) ? (base.card as any).children : [];
      let cursorY = 0;
      for (const w of baseChildren) {
        const p = (w as any)?.placement ?? {};
        cursorY = Math.max(cursorY, asInt(p.y, 0) + asInt(p.h, 3));
      }
      cursorY += 1;

      for (const c of cards.slice(1)) {
        const kids: any[] = Array.isArray((c?.card as any)?.children) ? (c.card as any).children : [];
        for (const w of kids) {
          const p = (w as any)?.placement ?? { x: 0, y: 0, w: cols, h: 3 };
          baseChildren.push({ ...w, placement: { ...p, y: asInt(p.y, 0) + cursorY } });
        }
        let maxLocal = 0;
        for (const w of kids) {
          const p = (w as any)?.placement ?? {};
          maxLocal = Math.max(maxLocal, asInt(p.y, 0) + asInt(p.h, 3));
        }
        cursorY += maxLocal + 1;
      }

      (base.card as any).children = baseChildren;
      base.x = 0;
      base.y = 0;
      base.w = cols;
      base.h = Math.max(10, asInt(base.h, 12));
      base.title = String(sec.title ?? base.title ?? "Section");
      sec.layout.cards = [base];
      next.dashboard.sections[sectionIdx] = sec;
      draft = next;
      markDirty();
    };

    const getSectionChildren = (sectionIdx: number): any[] => {
      const sec = (draft.dashboard.sections as any[])?.[sectionIdx] ?? null;
      const c0 = Array.isArray(sec?.layout?.cards) ? sec.layout.cards[0] : null;
      const kids = c0?.card ? (c0.card as any).children : null;
      return Array.isArray(kids) ? kids : [];
    };

    const setSectionChildren = (sectionIdx: number, nextChildren: any[]) => {
      const next = cloneJson(draft) as any;
      const sec = next.dashboard.sections?.[sectionIdx];
      if (!sec) return;
      const cols = Math.max(1, Math.min(24, asInt(sec.layout?.columns, 12)));
      sec.layout = sec.layout ?? { mode: "grid", columns: cols, cards: [] };
      sec.layout.columns = cols;
      const cards = Array.isArray(sec.layout.cards) ? sec.layout.cards : [];
      if (cards.length === 0) cards.push(defaultCard());
      const first = cards[0];
      first.x = 0;
      first.y = 0;
      first.w = cols;
      first.h = Math.max(10, asInt(first.h, 12));
      first.title = String(sec.title ?? first.title ?? "Section");
      first.card = first.card ?? { type: "composite", children: [] };
      (first.card as any).children = nextChildren;
      sec.layout.cards = [first];
      next.dashboard.sections[sectionIdx] = sec;
      draft = next;
      markDirty();
    };

    const sectionsBox = doc.createElement("div");
    sectionsBox.className = "ga-le-box";
    const sHead = doc.createElement("div");
    sHead.className = "ga-le-box-head";
    sHead.textContent = "Sections";
    sectionsBox.appendChild(sHead);
    const sNote = doc.createElement("div");
    sNote.className = "ga-settings-note";
    sNote.textContent = "Sections are your tabs. Rename, reorder, and click Edit to configure widgets.";
    sectionsBox.appendChild(sNote);

    // "Add" uses a compact + row (keeps the list consistent with section rows).

    const reorderSection = (fromIdx: number, toIdx: number) => {
      if (fromIdx === toIdx) return;
      if (fromIdx < 0 || fromIdx >= sections.length) return;
      if (toIdx < 0 || toIdx >= sections.length) return;
      const next = [...sections];
      const [picked] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, picked);
      setSections(next);
    };

    sections.forEach((sec, idx) => {
      const row = doc.createElement("div");
      row.className = "ga-le-compact-row";
      row.draggable = true;
      row.dataset.idx = String(idx);

      row.addEventListener("dragstart", (ev) => {
        try {
          ev.dataTransfer?.setData("text/plain", String(idx));
          ev.dataTransfer?.setDragImage?.(row, 12, 12);
        } catch {
          // ignore
        }
        row.classList.add("dragging");
      });
      row.addEventListener("dragend", () => row.classList.remove("dragging"));
      row.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        row.classList.add("dragover");
      });
      row.addEventListener("dragleave", () => row.classList.remove("dragover"));
      row.addEventListener("drop", (ev) => {
        ev.preventDefault();
        row.classList.remove("dragover");
        const raw = ev.dataTransfer?.getData("text/plain") ?? "";
        const fromIdx = asInt(raw, -1);
        if (fromIdx < 0) return;
        reorderSection(fromIdx, idx);
      });

      const drag = doc.createElement("div");
      drag.className = "ga-le-drag";
      drag.title = "Drag to reorder";
      drag.textContent = "⋮⋮";
      row.appendChild(drag);

      const title = doc.createElement("div");
      title.className = "ga-le-compact-title";
      title.textContent = sec?.title || sec?.id || "Untitled";
      row.appendChild(title);

      const meta = doc.createElement("div");
      meta.className = "ga-le-compact-meta";
      meta.textContent = String(sec?.id || "");
      row.appendChild(meta);

      const actions = doc.createElement("div");
      actions.className = "ga-le-compact-actions";
      actions.appendChild(
        mkIconBtn(doc, "✎", () => {
          const nextTitle = safePrompt(doc, "Rename section title:", String(sec?.title ?? ""));
          if (nextTitle === null) return;
          const next = [...sections];
          next[idx] = { ...sec, title: nextTitle };
          setSections(next);
        })
      );
      actions.appendChild(
        mkIconBtn(
          doc,
          "🗑",
          () => {
            if (!safeConfirm(`Delete section '${sec?.title || sec?.id}'?`)) return;
            const next = sections.filter((_, i) => i !== idx);
            setSections(next);
            if (editSectionIdx === idx) editSectionIdx = null;
          },
          "danger"
        )
      );
      actions.appendChild(
        mkBtn(
          doc,
          "Edit",
          () => {
            editSectionIdx = idx;
            render();
          },
          "primary"
        )
      );
      row.appendChild(actions);

      sectionsBox.appendChild(row);
    });

    const addSectionRow = doc.createElement("div");
    addSectionRow.className = "ga-le-compact-row";
    addSectionRow.title = "Add section";
    const addSection = () => {
      const next = [...sections, defaultSection()];
      setSections(next);
      editSectionIdx = Math.max(0, next.length - 1);
      render();
    };
    addSectionRow.addEventListener("click", () => addSection());

    const addDrag = doc.createElement("div");
    addDrag.className = "ga-le-drag";
    addDrag.textContent = "+";
    addSectionRow.appendChild(addDrag);

    const addTitle = doc.createElement("div");
    addTitle.className = "ga-le-compact-title";
    addTitle.textContent = "Add section";
    addSectionRow.appendChild(addTitle);

    const addMeta = doc.createElement("div");
    addMeta.className = "ga-le-compact-meta";
    addMeta.textContent = "";
    addSectionRow.appendChild(addMeta);

    const addActions = doc.createElement("div");
    addActions.className = "ga-le-compact-actions";
    addActions.appendChild(mkBtn(doc, "+", () => addSection(), "primary"));
    addSectionRow.appendChild(addActions);
    sectionsBox.appendChild(addSectionRow);

    if (mode === "section_layout") {
      panels.appendChild(sectionsBox);
    }

    // Placeholders for the next panels (filled in subsequent patches).

    if (mode === "global_filters") {
      const gfFallback: any = {
        enabled: true,
        layout: { variant: "compact" },
        controls: [],
        buttons: { apply: false, reset: true }
      };
      const gfRaw: any = (draft.dashboard as any).globalFilters;
      const gfCurrent: any = gfRaw && typeof gfRaw === "object" ? { ...gfFallback, ...gfRaw } : gfFallback;
      if (!gfCurrent.layout || typeof gfCurrent.layout !== "object") gfCurrent.layout = { variant: "compact" };
      if (!gfCurrent.buttons || typeof gfCurrent.buttons !== "object") gfCurrent.buttons = { apply: false, reset: true };
      const gfControls: any[] = Array.isArray(gfCurrent.controls) ? gfCurrent.controls : [];

      const setGlobalFilters = (nextGlobalFilters: any) => {
        const next = cloneJson(draft) as any;
        next.dashboard.globalFilters = nextGlobalFilters;
        draft = next;
        markDirty();
      };
      const setControls = (nextControls: any[]) => setGlobalFilters({ ...gfCurrent, controls: nextControls });

      const gfBox = doc.createElement("div");
      gfBox.className = "ga-le-box";
      const gfh = doc.createElement("div");
      gfh.className = "ga-le-box-head";
      gfh.textContent = "Global filters";
      gfBox.appendChild(gfh);
      const gfNote = doc.createElement("div");
      gfNote.className = "ga-settings-note";
      gfNote.textContent = "Drag to reorder. Click Edit to configure a filter. Use + to add a new filter.";
      gfBox.appendChild(gfNote);

      const gfEnabled = gfCurrent?.enabled !== false;

      const barRow = doc.createElement("div");
      barRow.className = "ga-le-compact-row";
      const barDrag = doc.createElement("div");
      barDrag.className = "ga-le-drag";
      barDrag.textContent = "";
      barRow.appendChild(barDrag);
      const barTitle = doc.createElement("div");
      barTitle.className = "ga-le-compact-title";
      barTitle.textContent = "Global filter bar";
      barRow.appendChild(barTitle);
      const barMeta = doc.createElement("div");
      barMeta.className = "ga-le-compact-meta";
      barMeta.textContent = `${gfEnabled ? "Enabled" : "Disabled"} • ${String(gfCurrent?.layout?.variant ?? "compact")}`;
      barRow.appendChild(barMeta);
      const barActions = doc.createElement("div");
      barActions.className = "ga-le-compact-actions";
      barActions.appendChild(
        mkBtn(
          doc,
          gfEnabled ? "Disable" : "Enable",
          () => setGlobalFilters({ ...gfCurrent, enabled: !gfEnabled }),
          gfEnabled ? "ghost" : "primary"
        )
      );
      barActions.appendChild(
        mkBtn(
          doc,
          "Advanced",
          () => {
            editGlobalFilters = true;
            render();
          },
          "ghost"
        )
      );
      barRow.appendChild(barActions);
      gfBox.appendChild(barRow);

      const reorderControl = (fromIdx: number, toIdx: number) => {
        if (fromIdx === toIdx) return;
        if (fromIdx < 0 || fromIdx >= gfControls.length) return;
        if (toIdx < 0 || toIdx >= gfControls.length) return;
        const next = [...gfControls];
        const [picked] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, picked);
        setControls(next);
      };

      gfControls.forEach((ctrl, idx) => {
        const row = doc.createElement("div");
        row.className = "ga-le-compact-row";
        row.draggable = true;
        row.dataset.idx = String(idx);
        row.addEventListener("click", () => {
          editGlobalFilterIdx = idx;
          render();
        });

        row.addEventListener("dragstart", (ev) => {
          try {
            ev.dataTransfer?.setData("text/plain", String(idx));
            ev.dataTransfer?.setDragImage?.(row, 12, 12);
          } catch {
            // ignore
          }
          row.classList.add("dragging");
        });
        row.addEventListener("dragend", () => row.classList.remove("dragging"));
        row.addEventListener("dragover", (ev) => {
          ev.preventDefault();
          row.classList.add("dragover");
        });
        row.addEventListener("dragleave", () => row.classList.remove("dragover"));
        row.addEventListener("drop", (ev) => {
          ev.preventDefault();
          row.classList.remove("dragover");
          const raw = ev.dataTransfer?.getData("text/plain") ?? "";
          const fromIdx = asInt(raw, -1);
          if (fromIdx < 0) return;
          reorderControl(fromIdx, idx);
        });

        const drag = doc.createElement("div");
        drag.className = "ga-le-drag";
        drag.title = "Drag to reorder";
        drag.textContent = "⋮⋮";
        row.appendChild(drag);

        const title = doc.createElement("div");
        title.className = "ga-le-compact-title";
        title.textContent = String(ctrl?.label || ctrl?.id || "Untitled filter");
        row.appendChild(title);

        const meta = doc.createElement("div");
        meta.className = "ga-le-compact-meta";
        const metaParts: string[] = [];
        if (ctrl?.id) metaParts.push(String(ctrl.id));
        metaParts.push(String(ctrl?.type ?? "select"));
        if (ctrl?.type === "select") metaParts.push(String(ctrl?.dimension ?? "(no dimension)"));
        if (Array.isArray(ctrl?.appliesTo) && ctrl.appliesTo.length) metaParts.push(String(ctrl.appliesTo.join(",")));
        meta.textContent = metaParts.filter(Boolean).join(" • ");
        row.appendChild(meta);

        const actions = doc.createElement("div");
        actions.className = "ga-le-compact-actions";
        actions.appendChild(
          mkIconBtn(doc, "✎", () => {
            editGlobalFilterIdx = idx;
            render();
          })
        );
        actions.appendChild(
          mkIconBtn(
            doc,
            "🗑",
            () => {
              if (!safeConfirm(`Delete global filter '${ctrl?.label || ctrl?.id}'?`)) return;
              setControls(gfControls.filter((_: any, i: number) => i !== idx));
              if (editGlobalFilterIdx === idx) editGlobalFilterIdx = null;
            },
            "danger"
          )
        );
        actions.appendChild(
          mkBtn(
            doc,
            "Edit",
            () => {
              editGlobalFilterIdx = idx;
              render();
            },
            "primary"
          )
        );
        row.appendChild(actions);
        gfBox.appendChild(row);
      });

      const addFilter = () => {
        const id = `filter_${Math.random().toString(36).slice(2, 7)}`;
        const next = [
          ...gfControls,
          { id, type: "select", label: "New filter", dimension: "", default: "all", options: "auto_distinct", appliesTo: [grainDefault] }
        ];
        setControls(next);
        editGlobalFilterIdx = Math.max(0, next.length - 1);
        render();
      };

      const addFilterRow = doc.createElement("div");
      addFilterRow.className = "ga-le-compact-row";
      addFilterRow.title = "Add filter";
      addFilterRow.addEventListener("click", () => addFilter());

      const addDrag = doc.createElement("div");
      addDrag.className = "ga-le-drag";
      addDrag.textContent = "+";
      addFilterRow.appendChild(addDrag);

      const addTitle = doc.createElement("div");
      addTitle.className = "ga-le-compact-title";
      addTitle.textContent = "Add filter";
      addFilterRow.appendChild(addTitle);

      const addMeta = doc.createElement("div");
      addMeta.className = "ga-le-compact-meta";
      addMeta.textContent = "";
      addFilterRow.appendChild(addMeta);

      const addActions = doc.createElement("div");
      addActions.className = "ga-le-compact-actions";
      addActions.appendChild(mkBtn(doc, "+", () => addFilter(), "primary"));
      addFilterRow.appendChild(addActions);
      gfBox.appendChild(addFilterRow);

      panels.appendChild(gfBox);
    }

    if (mode === "drilldowns") {
      panels.appendChild(mkHr(doc));
    const ddBox = doc.createElement("div");
    ddBox.className = "ga-le-box";
    const ddh = doc.createElement("div");
    ddh.className = "ga-le-box-head";
    ddh.textContent = "Drilldown presets";
    ddBox.appendChild(ddh);
    const ddn = doc.createElement("div");
    ddn.className = "ga-settings-note";
    ddn.textContent = "Define which columns show up in drilldown tables (and which are sortable). Saved into your template.";
    ddBox.appendChild(ddn);

    const ddOverride: any = (draft.dashboard as any)?.drilldownPresets ?? {};
    const setDdOverride = (target: string, nextTarget: any) => {
      const next = cloneJson(draft) as any;
      const cur = (next.dashboard.drilldownPresets ?? {}) as any;
      next.dashboard.drilldownPresets = { ...cur, [target]: nextTarget };
      draft = next;
      markDirty();
    };
    const removeDdOverride = (target: string) => {
      const next = cloneJson(draft) as any;
      const cur = (next.dashboard.drilldownPresets ?? {}) as any;
      const { [target]: _, ...rest } = cur;
      next.dashboard.drilldownPresets = rest;
      draft = next;
      markDirty();
    };

    const targets = Object.keys((sem as any)?.drilldownPresets ?? {});
    if (targets.length === 0) {
      const none = doc.createElement("div");
      none.className = "ga-settings-note";
      none.textContent = "No drilldown targets found.";
      ddBox.appendChild(none);
    }

    targets.forEach((target) => {
      const preset = (sem as any)?.drilldownPresets?.[target] ?? {};
      const keys = Object.keys(preset?.columnsPresets ?? {});
      const left = doc.createElement("div");
      left.className = "ga-le-compact-title";
      left.textContent = `${target} • ${keys.length} presets`;

      const row = doc.createElement("div");
      row.className = "ga-le-compact-row";
      row.appendChild(left);
      const actions = doc.createElement("div");
      actions.className = "ga-le-compact-actions";
      actions.appendChild(
        mkBtn(
          doc,
          "Edit",
          () => {
            editDrilldownTarget = target;
            render();
          },
          "primary"
        )
      );
      row.appendChild(actions);
      ddBox.appendChild(row);
    });
    panels.appendChild(ddBox);
    }

    if (editGlobalFilters) {
      const { overlay, body } = mkModal("Global filters", () => {
        editGlobalFilters = false;
        render();
      });
      renderGlobalFilters(body);
      wrap.appendChild(overlay);
    }

    if (editGlobalFilterIdx !== null) {
      const gfFallback: any = {
        enabled: true,
        layout: { variant: "compact" },
        controls: [],
        buttons: { apply: false, reset: true }
      };
      const gfRaw: any = (draft.dashboard as any).globalFilters;
      const gfCurrent: any = gfRaw && typeof gfRaw === "object" ? { ...gfFallback, ...gfRaw } : gfFallback;
      if (!gfCurrent.layout || typeof gfCurrent.layout !== "object") gfCurrent.layout = { variant: "compact" };
      if (!gfCurrent.buttons || typeof gfCurrent.buttons !== "object") gfCurrent.buttons = { apply: false, reset: true };
      const controls: any[] = Array.isArray(gfCurrent.controls) ? gfCurrent.controls : [];
      const idx = editGlobalFilterIdx;
      const ctrl = controls[idx];
      if (!ctrl) {
        editGlobalFilterIdx = null;
      } else {
        const { overlay, body } = mkModal(`Global filter: ${String(ctrl?.label || ctrl?.id || "")}`, () => {
          editGlobalFilterIdx = null;
          render();
        });

        const setGlobalFilters = (nextGlobalFilters: any) => {
          const next = cloneJson(draft) as any;
          next.dashboard.globalFilters = nextGlobalFilters;
          draft = next;
          markDirty();
        };
        const patchCtrl = (nextCtrl: any) => setGlobalFilters({ ...gfCurrent, controls: controls.map((c, i) => (i === idx ? nextCtrl : c)) });

        const top = doc.createElement("div");
        top.className = "ga-le-toprow";
        top.appendChild(
          mkBtn(
            doc,
            "Delete",
            () => {
              if (!safeConfirm(`Delete global filter '${ctrl?.label || ctrl?.id}'?`)) return;
              setGlobalFilters({ ...gfCurrent, controls: controls.filter((_: any, i: number) => i !== idx) });
              editGlobalFilterIdx = null;
              render();
            },
            "danger"
          )
        );
        top.appendChild(
          mkBtn(doc, "Advanced (all)", () => {
            editGlobalFilterIdx = null;
            editGlobalFilters = true;
            render();
          })
        );
        body.appendChild(top);

        const dimsAll = Object.keys((semantic.dimensions ?? {}) as any).map((id) => ({ value: id, label: id }));

        body.appendChild(mkTextInput(doc, "id", String(ctrl.id ?? ""), (v) => patchCtrl({ ...ctrl, id: v })));
        body.appendChild(
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
                patchCtrl({
                  id: ctrl.id,
                  type: "date_range",
                  label: ctrl.label || "Date range",
                  default: { fromTs: null, toTs: null },
                  appliesTo: ctrl.appliesTo ?? [grainDefault]
                });
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
        body.appendChild(mkTextInput(doc, "label", String(ctrl.label ?? ""), (v) => patchCtrl({ ...ctrl, label: v })));
        body.appendChild(
          mkMultiSelect(doc, "appliesTo", Array.isArray(ctrl.appliesTo) ? ctrl.appliesTo : [grainDefault], grainOpts, (vals) => patchCtrl({ ...ctrl, appliesTo: vals }))
        );

        if (ctrl.type === "select") {
          body.appendChild(mkSelect(doc, "dimension", String(ctrl.dimension ?? ""), dimsAll, (v) => patchCtrl({ ...ctrl, dimension: v })));
          body.appendChild(
            mkSelect(
              doc,
              "options",
              String(ctrl.options ?? "auto_distinct"),
              [
                { value: "auto_distinct", label: "auto_distinct" },
                { value: "auto_teammates", label: "auto_teammates" }
              ],
              (v) => patchCtrl({ ...ctrl, options: v })
            )
          );
          body.appendChild(mkTextInput(doc, "default", String(ctrl.default ?? "all"), (v) => patchCtrl({ ...ctrl, default: v })));
          body.appendChild(
            mkSelect(doc, "presentation", String(ctrl.presentation ?? "dropdown"), [{ value: "dropdown", label: "dropdown" }, { value: "map", label: "map" }], (v) =>
              patchCtrl({ ...ctrl, presentation: v })
            )
          );
          if (ctrl.presentation === "map") {
            const map = ctrl.map ?? {};
            body.appendChild(
              mkSelect(doc, "map.variant", String(map.variant ?? "compact"), [{ value: "compact", label: "compact" }, { value: "wide", label: "wide" }], (v) =>
                patchCtrl({ ...ctrl, map: { ...map, variant: v } })
              )
            );
            body.appendChild(
              mkNumberInput(doc, "map.height", asInt(map.height, 340), (n) => patchCtrl({ ...ctrl, map: { ...map, height: Math.max(160, Math.min(1200, n)) } }), {
                min: 160,
                max: 1200,
                step: 10
              })
            );
            body.appendChild(mkToggle(doc, "map.restrictToOptions", !!map.restrictToOptions, (v) => patchCtrl({ ...ctrl, map: { ...map, restrictToOptions: v } })));
            body.appendChild(mkToggle(doc, "map.tintSelectable", map.tintSelectable !== false, (v) => patchCtrl({ ...ctrl, map: { ...map, tintSelectable: v } })));
          }
        } else if (ctrl.type === "date_range") {
          const btnRow = doc.createElement("div");
          btnRow.className = "ga-le-toprow";
          btnRow.appendChild(mkBtn(doc, "Reset default", () => patchCtrl({ ...ctrl, default: { fromTs: null, toTs: null } })));
          body.appendChild(btnRow);
        }

        body.appendChild(renderAdvancedJson(doc, "Advanced JSON (control)", ctrl, (next) => patchCtrl(next)));
        wrap.appendChild(overlay);
      }
    }

    if (editDrilldownTarget) {
      const target = editDrilldownTarget;
      const preset = (sem as any)?.drilldownPresets?.[target] ?? {};
      const keys = Object.keys(preset?.columnsPresets ?? {});
      const override = ddOverride?.[target] ?? {};
      const { overlay, body } = mkModal(`Drilldown presets: ${target}`, () => {
        editDrilldownTarget = null;
        editDrilldownPreset = null;
        render();
      });

      if (override && Object.keys(override).length) {
        const top = doc.createElement("div");
        top.className = "ga-le-toprow";
        top.appendChild(mkBtn(doc, "Reset overrides", () => removeDdOverride(target), "danger"));
        body.appendChild(top);
      }

      if (keys.length > 0) {
        body.appendChild(
          mkSelect(
            doc,
            "defaultPreset",
            String(preset?.defaultPreset ?? keys[0]),
            keys.map((k: string) => ({ value: k, label: k })),
            (v) => setDdOverride(target, { ...override, defaultPreset: v, columnsPresets: override?.columnsPresets ?? {} })
          )
        );
      }

      const addRow = doc.createElement("div");
      addRow.className = "ga-le-toprow";
      const input = doc.createElement("input");
      input.type = "text";
      input.className = "ga-le-inline-input";
      input.placeholder = "new preset id (e.g. myPreset)";
      input.value = String(newPresetIdByTarget[target] ?? "");
      input.addEventListener("input", () => (newPresetIdByTarget[target] = input.value));
      addRow.appendChild(input);
      addRow.appendChild(
        mkBtn(
          doc,
          "Add preset",
          () => {
            const id = String(newPresetIdByTarget[target] ?? "").trim();
            if (!id) return;
            const colsNext = { ...(override?.columnsPresets ?? {}) };
            if (colsNext[id]) return;
            colsNext[id] = [{ key: "ts", label: "Date", sortable: true }];
            setDdOverride(target, { ...override, columnsPresets: colsNext });
            newPresetIdByTarget[target] = "";
            render();
          },
          "primary"
        )
      );
      body.appendChild(addRow);

      const mergedPresets: any = preset?.columnsPresets ?? {};
      for (const [pid, cols] of Object.entries(mergedPresets)) {
        const isEditable = !!override?.columnsPresets?.[pid];

        const row = doc.createElement("div");
        row.className = "ga-le-compact-row";
        const left = doc.createElement("div");
        left.className = "ga-le-compact-title";
        left.textContent = `${pid} • ${Array.isArray(cols) ? cols.length : 0} cols`;
        row.appendChild(left);

        const actions = doc.createElement("div");
        actions.className = "ga-le-compact-actions";
        if (!isEditable) {
          actions.appendChild(
            mkBtn(doc, "Customize", () => {
              const colsNext = { ...(override?.columnsPresets ?? {}) };
              colsNext[pid] = cloneJson(cols as any[]);
              setDdOverride(target, { ...override, columnsPresets: colsNext });
              editDrilldownPreset = { target, presetId: pid };
              render();
            })
          );
        } else {
          actions.appendChild(
            mkIconBtn(
              doc,
              "🗑",
              () => {
                if (!safeConfirm(`Delete preset '${pid}'?`)) return;
                const colsNext = { ...(override?.columnsPresets ?? {}) };
                delete colsNext[pid];
                setDdOverride(target, { ...override, columnsPresets: colsNext });
                if (editDrilldownPreset?.target === target && editDrilldownPreset?.presetId === pid) editDrilldownPreset = null;
                render();
              },
              "danger"
            )
          );
        }
        actions.appendChild(
          mkBtn(
            doc,
            "Edit",
            () => {
              if (!isEditable) {
                const colsNext = { ...(override?.columnsPresets ?? {}) };
                colsNext[pid] = cloneJson(cols as any[]);
                setDdOverride(target, { ...override, columnsPresets: colsNext });
              }
              editDrilldownPreset = { target, presetId: pid };
              render();
            },
            "primary"
          )
        );
        row.appendChild(actions);
        body.appendChild(row);
      }

      wrap.appendChild(overlay);
    }

    if (editDrilldownPreset) {
      const { target, presetId } = editDrilldownPreset;
      const semPreset = (sem as any)?.drilldownPresets?.[target] ?? {};
      const mergedCols = semPreset?.columnsPresets?.[presetId] ?? [];
      const override = ddOverride?.[target] ?? {};
      const isEditable = !!override?.columnsPresets?.[presetId];
      if (!isEditable) {
        // Shouldn't happen (we auto-customize before opening), but guard anyway.
        editDrilldownPreset = null;
      } else {
        const colsArr: any[] = Array.isArray(mergedCols) ? (mergedCols as any[]) : [];
        const { overlay, body } = mkModal(`Edit columns: ${target}.${presetId}`, () => {
          editDrilldownPreset = null;
          render();
        });

        const colsNextBase = () => ({ ...(override?.columnsPresets ?? {}) });
        const setColsForPreset = (nextArr: any[]) => {
          const colsNext = colsNextBase();
          colsNext[presetId] = nextArr;
          setDdOverride(target, { ...override, columnsPresets: colsNext });
        };

        const addRow = doc.createElement("div");
        addRow.className = "ga-le-toprow";
        addRow.appendChild(
          mkBtn(
            doc,
            "Add column",
            () => setColsForPreset([...colsArr, { key: "", label: "", sortable: false }]),
            "primary"
          )
        );
        body.appendChild(addRow);

        const reorder = (fromIdx: number, toIdx: number) => {
          if (fromIdx === toIdx) return;
          if (fromIdx < 0 || toIdx < 0) return;
          if (fromIdx >= colsArr.length || toIdx >= colsArr.length) return;
          const next = [...colsArr];
          const [picked] = next.splice(fromIdx, 1);
          next.splice(toIdx, 0, picked);
          setColsForPreset(next);
        };

        colsArr.forEach((c: any, cIdx: number) => {
          const row = doc.createElement("div");
          row.className = "ga-le-compact-row ga-le-compact-row-col";
          row.draggable = true;
          row.addEventListener("dragstart", (ev) => {
            try {
              ev.dataTransfer?.setData("text/plain", String(cIdx));
              ev.dataTransfer?.setDragImage?.(row, 12, 12);
            } catch {
              // ignore
            }
            row.classList.add("dragging");
          });
          row.addEventListener("dragend", () => row.classList.remove("dragging"));
          row.addEventListener("dragover", (ev) => {
            ev.preventDefault();
            row.classList.add("dragover");
          });
          row.addEventListener("dragleave", () => row.classList.remove("dragover"));
          row.addEventListener("drop", (ev) => {
            ev.preventDefault();
            row.classList.remove("dragover");
            const raw = ev.dataTransfer?.getData("text/plain") ?? "";
            reorder(asInt(raw, -1), cIdx);
          });

          const drag = doc.createElement("div");
          drag.className = "ga-le-drag";
          drag.title = "Drag to reorder";
          drag.textContent = "⋮⋮";
          row.appendChild(drag);

          const key = doc.createElement("input");
          key.type = "text";
          key.className = "ga-le-inline-input ga-le-col-key";
          key.placeholder = "key";
          key.value = String(c?.key ?? "");
          key.addEventListener("change", () => {
            const next = [...colsArr];
            next[cIdx] = { ...c, key: key.value };
            setColsForPreset(next);
          });
          row.appendChild(key);

          const label = doc.createElement("input");
          label.type = "text";
          label.className = "ga-le-inline-input ga-le-col-label";
          label.placeholder = "label";
          label.value = String(c?.label ?? "");
          label.addEventListener("change", () => {
            const next = [...colsArr];
            next[cIdx] = { ...c, label: label.value };
            setColsForPreset(next);
          });
          row.appendChild(label);

          const mkChk = (txt: string, checked: boolean, onChange: (v: boolean) => void) => {
            const w = doc.createElement("label");
            w.className = "ga-le-compact-chk";
            const cb = doc.createElement("input");
            cb.type = "checkbox";
            cb.checked = checked;
            cb.addEventListener("change", () => onChange(cb.checked));
            const s = doc.createElement("span");
            s.textContent = txt;
            w.appendChild(cb);
            w.appendChild(s);
            return w;
          };

          row.appendChild(
            mkChk("sort", !!c?.sortable, (v) => {
              const next = [...colsArr];
              next[cIdx] = { ...c, sortable: v };
              setColsForPreset(next);
            })
          );
          row.appendChild(
            mkChk("color", !!c?.colored, (v) => {
              const next = [...colsArr];
              next[cIdx] = { ...c, colored: v };
              setColsForPreset(next);
            })
          );

          row.appendChild(
            mkIconBtn(
              doc,
              "🗑",
              () => setColsForPreset(colsArr.filter((_: any, i: number) => i !== cIdx)),
              "danger"
            )
          );

          body.appendChild(row);

          const adv = renderAdvancedJson(doc, "Advanced JSON (column)", c, (nextCol) => {
            const next = [...colsArr];
            next[cIdx] = nextCol;
            setColsForPreset(next);
          });
          body.appendChild(adv);
        });

        wrap.appendChild(overlay);
      }
    }

    // Section modal
    if (editSectionIdx !== null && sections[editSectionIdx]) {
      const sec = sections[editSectionIdx] as any;

      const overlay = doc.createElement("div");
      overlay.className = "ga-le-modal";

      const bg = doc.createElement("div");
      bg.className = "ga-le-modal-bg";
      bg.addEventListener("click", () => {
        editSectionIdx = null;
        render();
      });

      const panel = doc.createElement("div");
      panel.className = "ga-le-modal-panel";

      const header = doc.createElement("div");
      header.className = "ga-le-modal-header";
      const ht = doc.createElement("div");
      ht.className = "ga-le-modal-title";
      ht.textContent = `Edit section: ${sec?.title || sec?.id || editSectionIdx}`;
      header.appendChild(ht);
      header.appendChild(
        mkBtn(doc, "Close", () => {
          editSectionIdx = null;
          render();
        })
      );
      panel.appendChild(header);

      const body = doc.createElement("div");
      body.className = "ga-le-modal-body";

      const patchSection = (partial: any) => {
        const next = [...sections];
        next[editSectionIdx!] = { ...sec, ...partial };
        setSections(next);
      };

      body.appendChild(mkTextInput(doc, "section.id", String(sec?.id ?? ""), (v) => patchSection({ id: v })));
      body.appendChild(mkTextInput(doc, "section.title", String(sec?.title ?? ""), (v) => patchSection({ title: v })));
      const colNote = doc.createElement("div");
      colNote.className = "ga-settings-note";
      colNote.textContent = "layout.columns = the grid width inside the section (recommended: 12).";
      body.appendChild(colNote);
      body.appendChild(
        mkNumberInput(
          doc,
          "layout.columns",
          asInt(sec?.layout?.columns, 12),
          (n) => patchSection({ layout: { ...(sec.layout ?? {}), columns: Math.max(1, Math.min(24, n)) } }),
          { min: 1, max: 24 }
        )
      );

      const cardsCount = Array.isArray(sec?.layout?.cards) ? sec.layout.cards.length : 0;
      if (cardsCount !== 1) {
        const warn = doc.createElement("div");
        warn.className = "ga-settings-note";
        warn.textContent =
          cardsCount === 0
            ? "This section has no container yet. Create one to add widgets."
            : `This section has ${cardsCount} cards. Layout UI assumes 1 container per section.`;
        body.appendChild(warn);
        const fix = doc.createElement("div");
        fix.className = "ga-le-toprow";
        fix.appendChild(
          mkBtn(
            doc,
            cardsCount === 0 ? "Create container" : "Flatten to 1 container",
            () => {
              if (cardsCount <= 1) ensureOneCardContainer(editSectionIdx!);
              else {
                if (!safeConfirm("Flatten all cards into one container?")) return;
                flattenCardsIntoFirst(editSectionIdx!);
              }
              render();
            },
            "primary"
          )
        );
        body.appendChild(fix);
      }

      body.appendChild(mkHr(doc));

      const cols = Math.max(1, Math.min(24, asInt(sec?.layout?.columns, 12)));
      const children = getSectionChildren(editSectionIdx!);

      const addRow = doc.createElement("div");
      addRow.className = "ga-le-toprow";
      addRow.appendChild(mkBtn(doc, "Add graph", () => setSectionChildren(editSectionIdx!, [...children, defaultWidget(grainDefault, "chart", cols)]), "primary"));
      addRow.appendChild(mkBtn(doc, "Add stat rows", () => setSectionChildren(editSectionIdx!, [...children, defaultWidget(grainDefault, "stat_list", cols)]), "primary"));
      addRow.appendChild(mkBtn(doc, "Add box", () => setSectionChildren(editSectionIdx!, [...children, defaultWidget(grainDefault, "stat_value", cols)]), "primary"));
      body.appendChild(addRow);

      const widgetTypes: WidgetDef["type"][] = ["stat_list", "stat_value", "chart", "breakdown", "record_list", "leader_list"];
      const typeOpts = widgetTypes.map((t) => ({ value: t, label: t }));

      const patchWidgetAt = (wIdx: number, nextWidget: any) => {
        const next = children.map((x, i) => (i === wIdx ? nextWidget : x));
        setSectionChildren(editSectionIdx!, next);
      };

      const moveWidget = (wIdx: number, delta: -1 | 1) => {
        const nextIdx = wIdx + delta;
        if (nextIdx < 0 || nextIdx >= children.length) return;
        const next = [...children];
        const [picked] = next.splice(wIdx, 1);
        next.splice(nextIdx, 0, picked);
        setSectionChildren(editSectionIdx!, next);
      };

      const renderWidgetEditor = (w: any, wIdx: number): HTMLElement => {
        const det = doc.createElement("details");
        det.className = "ga-le-details";
        det.open = false;
        const sum = doc.createElement("summary");
        sum.textContent = `${w.type} - ${w.title || w.widgetId}`;
        det.appendChild(sum);

        const wItem = doc.createElement("div");
        wItem.className = "ga-le-widget";

        const actions = doc.createElement("div");
        actions.className = "ga-le-toprow";
        actions.appendChild(mkBtn(doc, "Up", () => moveWidget(wIdx, -1)));
        actions.appendChild(mkBtn(doc, "Down", () => moveWidget(wIdx, 1)));
        actions.appendChild(
          mkBtn(
            doc,
            "Delete",
            () => {
              if (!safeConfirm(`Delete widget '${w.title || w.widgetId}'?`)) return;
              setSectionChildren(editSectionIdx!, children.filter((_, i) => i !== wIdx));
            },
            "danger"
          )
        );
        wItem.appendChild(actions);

        wItem.appendChild(mkTextInput(doc, "widgetId", String(w.widgetId ?? ""), (v) => patchWidgetAt(wIdx, { ...w, widgetId: v })));
        wItem.appendChild(
          mkSelect(doc, "type", String(w.type ?? "stat_list"), typeOpts, (v) => {
            const nextWidget = defaultWidget(String(w.grain ?? grainDefault), v as any);
            nextWidget.widgetId = w.widgetId;
            nextWidget.title = w.title;
            nextWidget.grain = w.grain ?? grainDefault;
            nextWidget.placement = w.placement;
            patchWidgetAt(wIdx, nextWidget as any);
          })
        );
        wItem.appendChild(mkTextInput(doc, "title", String(w.title ?? ""), (v) => patchWidgetAt(wIdx, { ...w, title: v })));
        wItem.appendChild(mkSelect(doc, "grain", String(w.grain ?? grainDefault), grainOpts, (v) => patchWidgetAt(wIdx, { ...w, grain: v })));

        const p = (w.placement as any) ?? { x: 0, y: 0, w: cols, h: 3 };
        const pGrid = doc.createElement("div");
        pGrid.className = "ga-le-grid4";
        pGrid.appendChild(mkNumberInput(doc, "x", asInt(p.x, 0), (n) => patchWidgetAt(wIdx, { ...w, placement: { ...p, x: n } })));
        pGrid.appendChild(mkNumberInput(doc, "y", asInt(p.y, 0), (n) => patchWidgetAt(wIdx, { ...w, placement: { ...p, y: n } })));
        pGrid.appendChild(mkNumberInput(doc, "w", asInt(p.w, cols), (n) => patchWidgetAt(wIdx, { ...w, placement: { ...p, w: n } })));
        pGrid.appendChild(mkNumberInput(doc, "h", asInt(p.h, 3), (n) => patchWidgetAt(wIdx, { ...w, placement: { ...p, h: n } })));
        wItem.appendChild(pGrid);

        const widgetGrain = String(w.grain ?? grainDefault);
        const spec: any = w.spec ?? {};
        const dims = allowedDimensionOptions(semantic, widgetGrain);
        const meas = allowedMeasureOptions(semantic, widgetGrain);

        if (w.type === "chart") {
          wItem.appendChild(
            mkSelect(
              doc,
              "chart.type",
              String(spec.type ?? "bar"),
              [
                { value: "bar", label: "bar" },
                { value: "line", label: "line" }
              ],
              (v) => patchWidgetAt(wIdx, { ...w, spec: { ...spec, type: v } } as any)
            )
          );
          wItem.appendChild(
            mkSelect(doc, "x.dimension", String(spec?.x?.dimension ?? ""), dims, (v) =>
              patchWidgetAt(wIdx, { ...w, spec: { ...spec, x: { ...(spec.x ?? {}), dimension: v } } } as any)
            )
          );
          wItem.appendChild(
            mkSelect(doc, "y.measure", String(spec?.y?.measure ?? ""), meas, (v) =>
              patchWidgetAt(wIdx, { ...w, spec: { ...spec, y: { ...(spec.y ?? {}), measure: v } } } as any)
            )
          );
          wItem.appendChild(
            renderClickActionEditor(doc, sem, "actions.click (drilldown)", spec.actions, (nextActions) =>
              patchWidgetAt(wIdx, { ...w, spec: { ...spec, actions: nextActions } } as any)
            )
          );
        } else if (w.type === "breakdown") {
          wItem.appendChild(mkSelect(doc, "dimension", String(spec.dimension ?? ""), dims, (v) => patchWidgetAt(wIdx, { ...w, spec: { ...spec, dimension: v } } as any)));
          wItem.appendChild(mkSelect(doc, "measure", String(spec.measure ?? ""), meas, (v) => patchWidgetAt(wIdx, { ...w, spec: { ...spec, measure: v } } as any)));
          wItem.appendChild(mkNumberInput(doc, "limit", asInt(spec.limit, 12), (n) => patchWidgetAt(wIdx, { ...w, spec: { ...spec, limit: n } } as any), { min: 1, max: 500 }));
          wItem.appendChild(
            renderClickActionEditor(doc, sem, "actions.click (drilldown)", spec.actions, (nextActions) =>
              patchWidgetAt(wIdx, { ...w, spec: { ...spec, actions: nextActions } } as any)
            )
          );
        } else if (w.type === "stat_value") {
          wItem.appendChild(mkTextInput(doc, "label", String(spec.label ?? ""), (v) => patchWidgetAt(wIdx, { ...w, spec: { ...spec, label: v } } as any)));
          wItem.appendChild(mkSelect(doc, "measure", String(spec.measure ?? ""), meas, (v) => patchWidgetAt(wIdx, { ...w, spec: { ...spec, measure: v } } as any)));
          wItem.appendChild(
            renderClickActionEditor(doc, sem, "actions.click (drilldown)", spec.actions, (nextActions) =>
              patchWidgetAt(wIdx, { ...w, spec: { ...spec, actions: nextActions } } as any)
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
          rowsBox.appendChild(mkBtn(doc, "Add row", () => patchWidgetAt(wIdx, { ...w, spec: { ...spec, rows: [...rows, { label: "Row", measure: "" }] } } as any), "primary"));
          rows.forEach((r, rIdx) => {
            const rowItem = doc.createElement("div");
            rowItem.className = "ga-le-item";
            rowItem.appendChild(
              mkTextInput(doc, "label", String(r.label ?? ""), (v) => {
                const nextRows = rows.map((x, i) => (i === rIdx ? { ...x, label: v } : x));
                patchWidgetAt(wIdx, { ...w, spec: { ...spec, rows: nextRows } } as any);
              })
            );
            rowItem.appendChild(
              mkSelect(doc, "measure", String(r.measure ?? ""), meas, (v) => {
                const nextRows = rows.map((x, i) => (i === rIdx ? { ...x, measure: v } : x));
                patchWidgetAt(wIdx, { ...w, spec: { ...spec, rows: nextRows } } as any);
              })
            );
            rowItem.appendChild(
              renderClickActionEditor(doc, sem, "row.actions.click (drilldown)", r.actions, (nextActions) => {
                const nextRows = rows.map((x, i) => (i === rIdx ? { ...x, actions: nextActions } : x));
                patchWidgetAt(wIdx, { ...w, spec: { ...spec, rows: nextRows } } as any);
              })
            );
            rowItem.appendChild(
              mkBtn(
                doc,
                "Delete row",
                () => {
                  if (!safeConfirm("Delete this row?")) return;
                  patchWidgetAt(wIdx, { ...w, spec: { ...spec, rows: rows.filter((_, i) => i !== rIdx) } } as any);
                },
                "danger"
              )
            );
            rowsBox.appendChild(rowItem);
          });
          wItem.appendChild(rowsBox);
        } else {
          wItem.appendChild(renderWidgetSpecEditorPlaceholder(doc));
        }

        wItem.appendChild(renderAdvancedJson(doc, "Advanced JSON (spec)", spec, (nextSpec) => patchWidgetAt(wIdx, { ...w, spec: nextSpec } as any)));
        det.appendChild(wItem);
        return det;
      };

      const byCat: Record<string, number[]> = { graphs: [], statrows: [], boxes: [], other: [] };
      children.forEach((w: any, i: number) => {
        const t = String(w?.type ?? "");
        if (t === "chart" || t === "breakdown") byCat.graphs.push(i);
        else if (t === "stat_list") byCat.statrows.push(i);
        else if (t === "stat_value" || t === "record_list" || t === "leader_list") byCat.boxes.push(i);
        else byCat.other.push(i);
      });

      const renderCat = (title: string, idxs: number[]) => {
        const det = doc.createElement("details");
        det.className = "ga-le-details";
        det.open = true;
        const sum = doc.createElement("summary");
        sum.textContent = `${title} (${idxs.length})`;
        det.appendChild(sum);
        const host = doc.createElement("div");
        host.className = "ga-le-item";
        idxs.forEach((i) => host.appendChild(renderWidgetEditor(children[i], i)));
        det.appendChild(host);
        body.appendChild(det);
      };

      renderCat("Graphs", byCat.graphs);
      renderCat("Stat rows", byCat.statrows);
      renderCat("Boxes", byCat.boxes);
      if (byCat.other.length) renderCat("Other", byCat.other);

      panel.appendChild(body);
      overlay.appendChild(bg);
      overlay.appendChild(panel);
      wrap.appendChild(overlay);
    }

    void sem;
    return true;
  }

  const render = () => {
    root.innerHTML = "";
    if (renderPanels()) return;

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

    if (lastSectionIdx !== active.idx) {
      lastSectionIdx = active.idx;
      focusCardIdx = 0;
      focusWidgetIdx = 0;
      scrollToId = null;
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
          setStatus("info", "Deleting section…");
          if (!safeConfirm(`Delete section '${section.title || section.id}'?`)) return;
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
      fsHead.textContent = "Global filter visibility (optional)";
      fsBox.appendChild(fsHead);

      const note = doc.createElement("div");
      note.className = "ga-settings-note";
      note.textContent = "Choose which global filter controls are shown for this section. Default: show all.";
      fsBox.appendChild(note);

      const mode = include.length ? "only" : exclude.length ? "except" : "all";
      fsBox.appendChild(
        mkSelect(
          doc,
          "Mode",
          mode,
          [
            { value: "all", label: "Show all filters" },
            { value: "only", label: "Show only selected" },
            { value: "except", label: "Show all except selected" }
          ],
          (v) => {
            if (v === "all") return patchSection({ filterScope: undefined } as any);
            if (v === "only") return patchSection({ filterScope: normalizeFilterScope({ include, exclude: [] }) } as any);
            return patchSection({ filterScope: normalizeFilterScope({ include: [], exclude }) } as any);
          }
        )
      );

      const selected = mode === "only" ? include : mode === "except" ? exclude : [];
      if (mode !== "all") {
        fsBox.appendChild(
          mkMultiSelect(doc, "Filters", selected, ctrlOpts, (vals) => {
            if (mode === "only") return patchSection({ filterScope: normalizeFilterScope({ include: vals, exclude: [] }) } as any);
            return patchSection({ filterScope: normalizeFilterScope({ include: [], exclude: vals }) } as any);
          })
        );
      }
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

    const cards: any[] = ((section.layout.cards ?? []) as any[]) ?? [];
    if (focusCardIdx < 0) focusCardIdx = 0;
    if (focusCardIdx >= cards.length) focusCardIdx = Math.max(0, cards.length - 1);
    const focusedCard: any = cards[focusCardIdx] ?? null;
    const focusedChildren: any[] = focusedCard ? (((focusedCard.card as any).children ?? []) as any[]) : [];
    if (focusWidgetIdx < 0) focusWidgetIdx = 0;
    if (focusWidgetIdx >= focusedChildren.length) focusWidgetIdx = Math.max(0, focusedChildren.length - 1);

    const cardsTop = doc.createElement("div");
    cardsTop.className = "ga-le-toprow";
    cardsTop.appendChild(
      mkBtn(
        doc,
        "Add card",
        () => {
          const next = cloneJson(draft) as any;
          next.dashboard.sections[active.idx].layout.cards = [...(next.dashboard.sections[active.idx].layout.cards ?? []), defaultCard()];
          draft = next;
          focusCardIdx = Math.max(0, (next.dashboard.sections[active.idx].layout.cards ?? []).length - 1);
          focusWidgetIdx = 0;
          scrollToId = `ga-le-card-${focusCardIdx}`;
          markDirty();
        },
        "primary"
      )
    );

    const focusWrap = doc.createElement("label");
    focusWrap.className = "ga-le-toggle";
    const focusInput = doc.createElement("input");
    focusInput.type = "checkbox";
    focusInput.checked = focusMode;
    const focusTxt = doc.createElement("span");
    focusTxt.textContent = "Focus mode";
    focusWrap.appendChild(focusInput);
    focusWrap.appendChild(focusTxt);
    focusInput.addEventListener("change", () => {
      focusMode = focusInput.checked;
      render();
    });
    cardsTop.appendChild(focusWrap);

    cardsTop.appendChild(
      mkBtn(
        doc,
        focusMode ? "Show all" : "Focus selected",
        () => {
          focusMode = !focusMode;
          render();
        },
        "ghost"
      )
    );
    cardsBox.appendChild(cardsTop);

    const cardsLayout = doc.createElement("div");
    cardsLayout.className = "ga-le-cards-layout";

    const outline = doc.createElement("div");
    outline.className = "ga-le-outline";
    const oh = doc.createElement("div");
    oh.className = "ga-le-outline-head";
    oh.textContent = "Outline";
    outline.appendChild(oh);
    const oNote = doc.createElement("div");
    oNote.className = "ga-settings-note";
    oNote.textContent = "Click to jump. In Focus mode only the selected card/widget stays open.";
    outline.appendChild(oNote);

    const oSearch = doc.createElement("input");
    oSearch.type = "text";
    oSearch.placeholder = "Search cards/widgets...";
    oSearch.className = "ga-le-outline-search";
    outline.appendChild(oSearch);

    const oList = doc.createElement("div");
    oList.className = "ga-le-outline-list";
    outline.appendChild(oList);

    const cardsHost = doc.createElement("div");
    cardsHost.className = "ga-le-cards-host";

    cards.forEach((card: any, cardIdx: number) => {
      const cardElId = `ga-le-card-${cardIdx}`;
      const cardTitle = `${card.title || "Card"} (${card.cardId})`;

      const cBtn = doc.createElement("button");
      cBtn.type = "button";
      cBtn.className = "ga-le-outline-item";
      cBtn.classList.toggle("active", focusCardIdx === cardIdx);
      cBtn.textContent = cardTitle;
      (cBtn as any).dataset.searchText = cardTitle.toLowerCase();
      cBtn.addEventListener("click", () => {
        focusMode = true;
        focusCardIdx = cardIdx;
        focusWidgetIdx = 0;
        scrollToId = cardElId;
        render();
      });
      oList.appendChild(cBtn);

      const outlineChildren: any[] = ((card.card as any).children ?? []) as any;
      outlineChildren.forEach((w: any, wIdx: number) => {
        const wElId = `ga-le-widget-${cardIdx}-${wIdx}`;
        const wTitle = `${w.type} - ${w.title || w.widgetId}`;
        const wBtn = doc.createElement("button");
        wBtn.type = "button";
        wBtn.className = "ga-le-outline-item ga-le-outline-item-widget";
        wBtn.classList.toggle("active", focusCardIdx === cardIdx && focusWidgetIdx === wIdx);
        wBtn.textContent = wTitle;
        (wBtn as any).dataset.searchText = `${cardTitle} ${wTitle}`.toLowerCase();
        wBtn.addEventListener("click", () => {
          focusMode = true;
          focusCardIdx = cardIdx;
          focusWidgetIdx = wIdx;
          scrollToId = wElId;
          render();
        });
        oList.appendChild(wBtn);
      });

      const details = doc.createElement("details");
      details.id = cardElId;
      details.open = focusMode ? cardIdx === focusCardIdx : true;
      details.className = "ga-le-details";
      const summary = doc.createElement("summary");
      summary.textContent = cardTitle;
      summary.addEventListener("click", (ev) => {
        focusCardIdx = cardIdx;
        if (focusMode) {
          ev.preventDefault();
          focusWidgetIdx = 0;
          scrollToId = cardElId;
          render();
        }
      });
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
            setStatus("info", "Deleting card…");
            if (!safeConfirm(`Delete card '${card.title || card.cardId}'?`)) return;
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

      const placeNote = doc.createElement("div");
      placeNote.className = "ga-settings-note";
      placeNote.textContent = `Card placement uses the section grid (layout.columns = ${asInt(section.layout?.columns, 12)}): x/y = position, w/h = size (grid units).`;
      cardItem.appendChild(placeNote);

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
            focusCardIdx = cardIdx;
            focusWidgetIdx = Math.max(0, (((c.card as any).children ?? []) as any[]).length - 1);
            scrollToId = `ga-le-widget-${cardIdx}-${focusWidgetIdx}`;
            markDirty();
          },
          "primary"
        )
      );

      children.forEach((w: any, wIdx: number) => {
        const wDetails = doc.createElement("details");
        const wElId = `ga-le-widget-${cardIdx}-${wIdx}`;
        wDetails.id = wElId;
        wDetails.open = focusMode ? cardIdx === focusCardIdx && wIdx === focusWidgetIdx : false;
        wDetails.className = "ga-le-details";
        const wSummary = doc.createElement("summary");
        wSummary.addEventListener("click", (ev) => {
          focusCardIdx = cardIdx;
          focusWidgetIdx = wIdx;
          if (focusMode) {
            ev.preventDefault();
            scrollToId = wElId;
            render();
          }
        });
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
              setStatus("info", "Deleting widget…");
              if (!safeConfirm(`Delete widget '${w.title || w.widgetId}'?`)) return;
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
        const grainNote = doc.createElement("div");
        grainNote.className = "ga-settings-note";
        grainNote.textContent = "grain = the dataset level the widget is calculated on (e.g. round vs. game).";
        wItem.appendChild(grainNote);
        wItem.appendChild(mkSelect(doc, "grain", String(w.grain ?? grainDefault), grainOpts, (v) => patchWidget(cardIdx, wIdx, { ...w, grain: v })));

        const p = (w.placement as any) ?? { x: 0, y: 0, w: 12, h: 3 };
        const widgetPlaceNote = doc.createElement("div");
        widgetPlaceNote.className = "ga-settings-note";
        widgetPlaceNote.textContent = `Widget placement uses a grid inside the card: x/y = position, w/h = size (grid units). Tip: keep w within layout.columns (${asInt(section.layout?.columns, 12)}).`;
        wItem.appendChild(widgetPlaceNote);
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
            renderClickActionEditor(doc, semantic, "actions.click (drilldown)", spec.actions, (nextActions) =>
              patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, actions: nextActions } } as any)
            )
          );
        } else if (w.type === "breakdown") {
          wItem.appendChild(mkSelect(doc, "dimension", String(spec.dimension ?? ""), dims, (v) => patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, dimension: v } } as any)));
          wItem.appendChild(mkSelect(doc, "measure", String(spec.measure ?? ""), meas, (v) => patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, measure: v } } as any)));
          wItem.appendChild(mkNumberInput(doc, "limit", asInt(spec.limit, 12), (n) => patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, limit: n } } as any), { min: 1, max: 500 }));
          wItem.appendChild(
            renderClickActionEditor(doc, semantic, "actions.click (drilldown)", spec.actions, (nextActions) =>
              patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, actions: nextActions } } as any)
            )
          );
        } else if (w.type === "stat_value") {
          wItem.appendChild(mkTextInput(doc, "label", String(spec.label ?? ""), (v) => patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, label: v } } as any)));
          wItem.appendChild(mkSelect(doc, "measure", String(spec.measure ?? ""), meas, (v) => patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, measure: v } } as any)));
          wItem.appendChild(
            renderClickActionEditor(doc, semantic, "actions.click (drilldown)", spec.actions, (nextActions) =>
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
              renderClickActionEditor(doc, semantic, "row.actions.click (drilldown)", r.actions, (nextActions) => {
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
                  if (!safeConfirm("Delete this row?")) return;
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
        } else if (w.type === "record_list") {
          const records: any[] = Array.isArray(spec.records) ? spec.records : [];
          const recBox = doc.createElement("div");
          recBox.className = "ga-le-subbox";
          const rh = doc.createElement("div");
          rh.className = "ga-le-subhead";
          rh.textContent = `Records (${records.length})`;
          recBox.appendChild(rh);

          const addRecord = mkBtn(
            doc,
            "Add record",
            () => {
              const id = `rec_${Math.random().toString(36).slice(2, 7)}`;
              const next = [...records, { id, label: "Record", kind: "group_extreme", extreme: "max" }];
              patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, records: next } } as any);
            },
            "primary"
          );
          recBox.appendChild(addRecord);
          const recNote = doc.createElement("div");
          recNote.className = "ga-settings-note";
          recNote.textContent = "Records are configurable items (not stat rows). Use kind + fields below, or Advanced JSON for full control.";
          recBox.appendChild(recNote);

          const kindOpts = [
            { value: "group_extreme", label: "group_extreme" },
            { value: "streak", label: "streak" },
            { value: "same_value_streak", label: "same_value_streak" }
          ];
          const extremeOpts = [
            { value: "max", label: "max" },
            { value: "min", label: "min" }
          ];
          const displayKeyOpts = [
            { value: "group", label: "group" },
            { value: "first_ts", label: "first_ts" },
            { value: "first_ts_score", label: "first_ts_score" }
          ];

          records.forEach((r, rIdx) => {
            const rDetails = doc.createElement("details");
            rDetails.open = false;
            rDetails.className = "ga-le-details";
            const sum = doc.createElement("summary");
            sum.textContent = `${r.label || "Record"} (${r.id || rIdx})`;
            rDetails.appendChild(sum);

            const item = doc.createElement("div");
            item.className = "ga-le-item";

            const top = doc.createElement("div");
            top.className = "ga-le-toprow";
            top.appendChild(
              mkBtn(
                doc,
                "Delete record",
                () => {
                  if (!safeConfirm("Delete this record?")) return;
                  const next = records.filter((_, i) => i !== rIdx);
                  patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, records: next } } as any);
                },
                "danger"
              )
            );
            item.appendChild(top);

            const patchRecord = (nextRec: any) => {
              const next = records.map((x, i) => (i === rIdx ? nextRec : x));
              patchWidget(cardIdx, wIdx, { ...w, spec: { ...spec, records: next } } as any);
            };

            item.appendChild(mkTextInput(doc, "id", String(r.id ?? ""), (v) => patchRecord({ ...r, id: v })));
            item.appendChild(mkTextInput(doc, "label", String(r.label ?? ""), (v) => patchRecord({ ...r, label: v })));
            item.appendChild(mkSelect(doc, "kind", String(r.kind ?? "group_extreme"), kindOpts, (v) => patchRecord({ ...r, kind: v })));
            item.appendChild(mkSelect(doc, "displayKey", String(r.displayKey ?? "group"), displayKeyOpts, (v) => patchRecord({ ...r, displayKey: v })));

            if ((r.kind ?? "group_extreme") === "group_extreme") {
              item.appendChild(mkSelect(doc, "metric", String(r.metric ?? ""), meas, (v) => patchRecord({ ...r, metric: v })));
              item.appendChild(mkSelect(doc, "groupBy", String(r.groupBy ?? ""), dims, (v) => patchRecord({ ...r, groupBy: v })));
              item.appendChild(mkSelect(doc, "extreme", String(r.extreme ?? "max"), extremeOpts, (v) => patchRecord({ ...r, extreme: v })));
            }
            if ((r.kind ?? "") === "same_value_streak") {
              item.appendChild(mkSelect(doc, "dimension", String(r.dimension ?? ""), dims, (v) => patchRecord({ ...r, dimension: v })));
            }

            item.appendChild(
              renderClickActionEditor(doc, semantic, "actions.click (drilldown)", r.actions, (nextActions) => {
                patchRecord({ ...r, actions: nextActions });
              })
            );
            item.appendChild(renderAdvancedJson(doc, "Advanced JSON (record)", r, (next) => patchRecord(next)));

            rDetails.appendChild(item);
            recBox.appendChild(rDetails);
          });

          wItem.appendChild(recBox);
        } else {
          wItem.appendChild(renderWidgetSpecEditorPlaceholder(doc));
        }

        wItem.appendChild(renderAdvancedJson(doc, "Advanced JSON (spec)", spec, (next) => patchWidget(cardIdx, wIdx, { ...w, spec: next } as any)));

        wDetails.appendChild(wItem);
        wBox.appendChild(wDetails);
      });

      cardItem.appendChild(wBox);
      details.appendChild(cardItem);
      cardsHost.appendChild(details);
    });

    oSearch.addEventListener("input", () => {
      const q = oSearch.value.trim().toLowerCase();
      const items = Array.from(oList.querySelectorAll("button")) as HTMLButtonElement[];
      for (const it of items) {
        const hay = String((it as any).dataset.searchText ?? "").toLowerCase();
        it.style.display = !q || hay.includes(q) ? "" : "none";
      }
    });

    cardsLayout.appendChild(outline);
    cardsLayout.appendChild(cardsHost);
    cardsBox.appendChild(cardsLayout);
    right.appendChild(cardsBox);

    root.appendChild(left);
    root.appendChild(right);

    if (scrollToId) {
      const el = doc.getElementById(scrollToId);
      scrollToId = null;
      if (el) {
        try {
          el.classList.add("ga-le-flash");
          (el as any).scrollIntoView?.({ behavior: "smooth", block: "start" });
          (win as any)?.setTimeout?.(() => el.classList.remove("ga-le-flash"), 900);
        } catch {
          // ignore
        }
      }
    }
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

function defaultWidget(grain: string, type: WidgetDef["type"], columns = 12): WidgetDef {
  const widgetId = `w_${type}_${Math.random().toString(36).slice(2, 7)}`;
  const w = Math.max(1, Math.min(24, asInt(columns, 12)));
  const placement = { x: 0, y: 0, w, h: 3 };
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

function renderClickActionEditor(
  doc: Document,
  semantic: SemanticRegistry,
  title: string,
  actions: any,
  onChange: (nextActions: any) => void
): HTMLElement {
  const box = doc.createElement("div");
  box.className = "ga-le-subbox";
  const head = doc.createElement("div");
  head.className = "ga-le-subhead";
  head.textContent = title;
  box.appendChild(head);

  const current = actions ?? {};
  const click = current?.click ?? null;

  const drilldownPresets: any = (semantic as any)?.drilldownPresets ?? {};
  const targetIds = Object.keys(drilldownPresets);
  const targetOptions =
    targetIds.length > 0
      ? targetIds.map((t) => ({ value: t, label: t }))
      : ["rounds", "games", "sessions", "players"].map((t) => ({ value: t, label: t }));

  const normalizeTarget = (value: unknown) => {
    const s = String(value ?? "");
    return targetOptions.some((o) => o.value === s) ? s : String(targetOptions[0]?.value ?? "rounds");
  };

  const defaultClickForTarget = (target: string) => {
    const preset = drilldownPresets?.[target];
    const keys = Object.keys(preset?.columnsPresets ?? {});
    const columnsPreset = String(preset?.defaultPreset ?? keys[0] ?? "default");
    return { type: "drilldown", target, columnsPreset };
  };

  box.appendChild(
    mkToggle(doc, "enabled", !!click, (enabled) => {
      const next = { ...(current ?? {}) };
      if (!enabled) delete next.click;
      else {
        const target = normalizeTarget((click as any)?.target);
        next.click = defaultClickForTarget(target);
      }
      onChange(next);
    })
  );

  if (!click) return box;

  const storedTarget = String((click as any)?.target ?? "");
  const uiTarget = normalizeTarget(storedTarget || (targetOptions[0]?.value ?? "rounds"));
  box.appendChild(
    mkSelect(
      doc,
      "target",
      uiTarget,
      targetOptions,
      (v) => {
        const preset = drilldownPresets?.[v];
        const keys = Object.keys(preset?.columnsPresets ?? {});
        const currentPreset = String(click.columnsPreset ?? "");
        const nextPreset = keys.includes(currentPreset) ? currentPreset : String(preset?.defaultPreset ?? keys[0] ?? currentPreset ?? "default");
        onChange({ ...(current ?? {}), click: { ...click, target: v, columnsPreset: nextPreset } });
      }
    )
  );

  if (storedTarget && storedTarget !== uiTarget) {
    const warn = doc.createElement("div");
    warn.className = "ga-settings-note";
    warn.textContent = `Unknown target '${storedTarget}'. Select a valid target or click Fix to use '${uiTarget}'.`;
    box.appendChild(warn);
    box.appendChild(mkBtn(doc, "Fix target", () => onChange({ ...(current ?? {}), click: defaultClickForTarget(uiTarget) }), "primary"));
  }

  const currentTarget = uiTarget;
  const targetPreset = drilldownPresets?.[currentTarget];
  const presetKeys = Object.keys(targetPreset?.columnsPresets ?? {});
  if (presetKeys.length > 0) {
    const presetOptions = presetKeys.map((k) => ({
      value: k,
      label: `${k} (${(targetPreset?.columnsPresets?.[k] ?? []).length})`
    }));
    const wanted = String(click.columnsPreset ?? "");
    const safeValue = presetKeys.includes(wanted) ? wanted : String(targetPreset?.defaultPreset ?? presetKeys[0]);
    box.appendChild(mkSelect(doc, "columnsPreset", safeValue, presetOptions, (v) => onChange({ ...(current ?? {}), click: { ...click, columnsPreset: v } })));
    if (wanted && wanted !== safeValue) {
      const warn = doc.createElement("div");
      warn.className = "ga-settings-note";
      warn.textContent = `Unknown columnsPreset '${wanted}' for target '${currentTarget}'. Click Fix to use '${safeValue}'.`;
      box.appendChild(warn);
      box.appendChild(mkBtn(doc, "Fix columnsPreset", () => onChange({ ...(current ?? {}), click: { ...click, columnsPreset: safeValue } }), "primary"));
    }
    const presetNote = doc.createElement("div");
    presetNote.className = "ga-settings-note";
    presetNote.textContent = "columnsPreset selects a predefined set of columns for the drilldown table (per target).";
    box.appendChild(presetNote);
  } else {
    box.appendChild(
      mkTextInput(doc, "columnsPreset", String(click.columnsPreset ?? ""), (v) => onChange({ ...(current ?? {}), click: { ...click, columnsPreset: v } }))
    );
    const presetNote = doc.createElement("div");
    presetNote.className = "ga-settings-note";
    presetNote.textContent = "No presets found for this target. If drilldown fails validation, check semantic.json drilldownPresets.";
    box.appendChild(presetNote);
  }

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
