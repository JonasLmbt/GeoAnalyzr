import type { SemanticRegistry } from "../config/semantic.types";
import type { GlobalFiltersSpec, FilterControlSpec, DateRangeValue, SelectControlSpec } from "../config/dashboard.types";
import type { GlobalFilterState } from "../engine/globalFilters";
import type { SelectOption } from "../engine/selectOptions";

export type DistinctOptionsProvider = (opts: {
  control: SelectControlSpec;
  spec: GlobalFiltersSpec;
  state: GlobalFilterState;
}) => Promise<SelectOption[]>;

function toYmd(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function fromYmdStartOfDay(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(y, mo, d, 0, 0, 0, 0);
  const ts = dt.getTime();
  return Number.isFinite(ts) ? ts : null;
}

function fromYmdEndOfDay(ymd: string): number | null {
  const start = fromYmdStartOfDay(ymd);
  if (start === null) return null;
  return start + 24 * 60 * 60 * 1000 - 1;
}

function getDateRangeValue(state: GlobalFilterState, id: string, fallback: DateRangeValue): DateRangeValue {
  const v = state[id];
  if (!v || typeof v !== "object") return fallback;
  const r = v as Record<string, unknown>;
  return {
    fromTs: r.fromTs === null ? null : Number(r.fromTs),
    toTs: r.toTs === null ? null : Number(r.toTs)
  };
}

function renderControlLabel(doc: Document, label: string): HTMLElement {
  const el = doc.createElement("div");
  el.className = "ga-filter-label";
  el.textContent = label;
  return el;
}

export async function renderGlobalFiltersBar(args: {
  container: HTMLElement;
  semantic: SemanticRegistry;
  spec: GlobalFiltersSpec | undefined;
  state: GlobalFilterState;
  setValue: (id: string, value: unknown) => void;
  setAll: (next: GlobalFilterState) => void;
  reset: () => void;
  getDistinctOptions: DistinctOptionsProvider;
  controlIds?: string[];
  constraints?: Record<string, { required?: boolean }>;
}): Promise<void> {
  const { container, semantic, spec, state, setValue, setAll, reset, getDistinctOptions, controlIds, constraints } = args;
  const doc = container.ownerDocument;
  container.innerHTML = "";

  if (!spec?.enabled) return;

  const allowed = Array.isArray(controlIds) && controlIds.length > 0 ? new Set(controlIds) : null;

  const bar = doc.createElement("div");
  bar.className = "ga-filters";
  container.appendChild(bar);

  const left = doc.createElement("div");
  left.className = "ga-filters-left";
  bar.appendChild(left);

  const right = doc.createElement("div");
  right.className = "ga-filters-right";
  bar.appendChild(right);

  const applyMode = spec.buttons?.apply === true;
  const showReset = spec.buttons?.reset !== false;

  let pending: GlobalFilterState = { ...state };
  const commit = () => setAll(pending);

  const updatePending = (id: string, value: unknown) => {
    pending = { ...pending, [id]: value };
    if (!applyMode) setValue(id, value);
  };

  const renderDateRange = (control: FilterControlSpec) => {
    const c = control as any;
    const id = String(c.id);
    const def = c.default as DateRangeValue;
    const current = getDateRangeValue(applyMode ? pending : state, id, def);

    const wrap = doc.createElement("div");
    wrap.className = "ga-filter";
    wrap.appendChild(renderControlLabel(doc, c.label));

    const row = doc.createElement("div");
    row.className = "ga-filter-row";

    const from = doc.createElement("input");
    from.type = "date";
    from.value = current.fromTs ? toYmd(current.fromTs) : "";
    from.addEventListener("change", () => {
      const ts = from.value ? fromYmdStartOfDay(from.value) : null;
      const next: DateRangeValue = { ...current, fromTs: ts };
      updatePending(id, next);
    });

    const to = doc.createElement("input");
    to.type = "date";
    to.value = current.toTs ? toYmd(current.toTs) : "";
    to.addEventListener("change", () => {
      const ts = to.value ? fromYmdEndOfDay(to.value) : null;
      const next: DateRangeValue = { ...current, toTs: ts };
      updatePending(id, next);
    });

    row.appendChild(from);
    row.appendChild(to);
    wrap.appendChild(row);
    left.appendChild(wrap);
  };

  const renderSelect = async (control: SelectControlSpec) => {
    const id = control.id;
    const isRequired = constraints?.[id]?.required === true;
    const current = String((applyMode ? pending : state)[id] ?? control.default ?? "all");

    const wrap = doc.createElement("div");
    wrap.className = "ga-filter";
    wrap.appendChild(renderControlLabel(doc, control.label));

    const sel = doc.createElement("select");
    sel.className = "ga-filter-select";

    // Options can depend on other active filters; we compute distincts from DB.
    const options = await getDistinctOptions({ control, spec, state: applyMode ? pending : state });
    if (!isRequired) sel.appendChild(new Option("All", "all"));
    for (const opt of options) {
      sel.appendChild(new Option(opt.label, opt.value));
    }

    const hasCurrent = options.some((o) => o.value === current);
    const nextValue = hasCurrent ? current : isRequired ? (options[0]?.value ?? "") : "all";
    if (nextValue) sel.value = nextValue;
    if (isRequired && nextValue && nextValue !== current) {
      updatePending(id, nextValue);
    }
    sel.addEventListener("change", () => {
      updatePending(id, sel.value);
    });

    wrap.appendChild(sel);
    left.appendChild(wrap);
  };

  const controls = spec.controls as FilterControlSpec[];
  for (const c of controls) {
    if (allowed && !allowed.has(c.id)) continue;
    if (c.type === "date_range") {
      renderDateRange(c);
      continue;
    }
    if (c.type === "select") {
      const dim = semantic.dimensions[c.dimension];
      if (dim) {
        const grains = Array.isArray(dim.grain) ? dim.grain : [dim.grain];
        if (!grains.includes("round")) continue;
      }
      await renderSelect(c);
      continue;
    }
  }

  if (applyMode) {
    const applyBtn = doc.createElement("button");
    applyBtn.className = "ga-filter-btn";
    applyBtn.textContent = "Apply";
    applyBtn.addEventListener("click", () => {
      commit();
    });
    right.appendChild(applyBtn);
  }

  if (showReset) {
    const resetBtn = doc.createElement("button");
    resetBtn.className = "ga-filter-btn";
    resetBtn.textContent = "Reset";
    resetBtn.addEventListener("click", () => {
      reset();
    });
    right.appendChild(resetBtn);
  }
}
