import type { DashboardDoc, FilterClause } from "../config/dashboard.types";
import type { SemanticRegistry } from "../config/semantic.types";
import { validateDashboardAgainstSemantic } from "../engine/validate";
import {
  DEFAULT_SETTINGS,
  normalizeColor,
  normalizeDateFormat,
  normalizeTheme,
  type SemanticDashboardSettings
} from "./settingsStore";

type SettingsModalOptions = {
  doc: Document;
  targetWindow: Window;
  root: HTMLDivElement;
  openButton: HTMLButtonElement;
  semantic: SemanticRegistry;
  getDashboard: () => DashboardDoc;
  applyDashboard: (next: DashboardDoc) => Promise<void>;
  getSettings: () => SemanticDashboardSettings;
  applySettings: (next: SemanticDashboardSettings) => Promise<void> | void;
};

export function attachSettingsModal(opts: SettingsModalOptions): void {
  const {
    doc,
    targetWindow,
    root,
    openButton,
    semantic,
    getDashboard,
    applyDashboard,
    getSettings,
    applySettings
  } = opts;

  const cloneDashboard = (value: DashboardDoc): DashboardDoc => {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value)) as DashboardDoc;
  };

  const normalizeClauses = (raw: unknown): FilterClause[] => {
    if (!Array.isArray(raw)) return [];
    const out: FilterClause[] = [];
    for (const item of raw) {
      if (typeof item !== "object" || !item) continue;
      const r = item as Record<string, unknown>;
      const dimension = typeof r.dimension === "string" ? r.dimension.trim() : "";
      const op = r.op;
      if (!dimension) continue;
      if (op !== "eq" && op !== "neq" && op !== "in" && op !== "nin") continue;
      const dim = semantic.dimensions[dimension];
      // If this references a semantic dimension, enforce round-grain to match current global filter application.
      if (dim && dim.grain !== "round") continue;

      const clause: FilterClause = { dimension, op };
      if ("value" in r) clause.value = r.value;
      if ("values" in r && Array.isArray(r.values)) clause.values = r.values;
      out.push(clause);
    }
    return out;
  };

  const settingsModal = doc.createElement("div");
  settingsModal.className = "ga-settings-modal";
  settingsModal.style.display = "none";
  root.appendChild(settingsModal);

  const openSettings = async () => {
    settingsModal.innerHTML = "";
    settingsModal.style.display = "block";

    const bg = doc.createElement("div");
    bg.className = "ga-settings-bg";
    bg.addEventListener("click", () => {
      settingsModal.style.display = "none";
    });

    const panel = doc.createElement("div");
    panel.className = "ga-settings-panel";

    const header = doc.createElement("div");
    header.className = "ga-settings-header";
    const headerTitle = doc.createElement("div");
    headerTitle.textContent = "Dashboard Settings";
    const headerClose = doc.createElement("button");
    headerClose.className = "ga-close";
    headerClose.textContent = "Close";
    headerClose.addEventListener("click", () => {
      settingsModal.style.display = "none";
    });
    header.appendChild(headerTitle);
    header.appendChild(headerClose);

    const bodyEl = doc.createElement("div");
    bodyEl.className = "ga-settings-body";

    const tabs = doc.createElement("div");
    tabs.className = "ga-settings-tabs";
    const panes = doc.createElement("div");

    const appearanceTab = doc.createElement("button");
    appearanceTab.className = "ga-settings-tab active";
    appearanceTab.textContent = "Appearance";
    const standardsTab = doc.createElement("button");
    standardsTab.className = "ga-settings-tab";
    standardsTab.textContent = "Standards";
    const templateTab = doc.createElement("button");
    templateTab.className = "ga-settings-tab";
    templateTab.textContent = "Template";
    const filtersTab = doc.createElement("button");
    filtersTab.className = "ga-settings-tab";
    filtersTab.textContent = "Filters";

    tabs.appendChild(appearanceTab);
    tabs.appendChild(standardsTab);
    tabs.appendChild(templateTab);
    tabs.appendChild(filtersTab);

    const settings = getSettings();
    const dashboard = getDashboard();

    const appearancePane = doc.createElement("div");
    appearancePane.className = "ga-settings-pane active";
    const appearanceGrid = doc.createElement("div");
    appearanceGrid.className = "ga-settings-grid";

    const themeField = doc.createElement("div");
    themeField.className = "ga-settings-field";
    const themeLabel = doc.createElement("label");
    themeLabel.textContent = "Theme";
    const themeSelect = doc.createElement("select");
    themeSelect.innerHTML = `<option value="dark">Dark</option><option value="light">Light</option>`;
    themeSelect.value = settings.appearance.theme;
    themeField.appendChild(themeLabel);
    themeField.appendChild(themeSelect);

    const colorField = doc.createElement("div");
    colorField.className = "ga-settings-field";
    const colorLabel = doc.createElement("label");
    colorLabel.textContent = "Graph color";
    const colorInput = doc.createElement("input");
    colorInput.type = "color";
    colorInput.value = normalizeColor(settings.appearance.graphColor, DEFAULT_SETTINGS.appearance.graphColor);
    colorField.appendChild(colorLabel);
    colorField.appendChild(colorInput);

    const animField = doc.createElement("div");
    animField.className = "ga-settings-field";
    const animLabel = doc.createElement("label");
    animLabel.textContent = "Chart animations";
    const animSelect = doc.createElement("select");
    animSelect.innerHTML = `<option value="on">On</option><option value="off">Off</option>`;
    animSelect.value = settings.appearance.chartAnimations ? "on" : "off";
    animField.appendChild(animLabel);
    animField.appendChild(animSelect);

    appearanceGrid.appendChild(themeField);
    appearanceGrid.appendChild(colorField);
    appearanceGrid.appendChild(animField);
    appearancePane.appendChild(appearanceGrid);

    const standardsPane = doc.createElement("div");
    standardsPane.className = "ga-settings-pane";
    const standardsGrid = doc.createElement("div");
    standardsGrid.className = "ga-settings-grid";

    const dateField = doc.createElement("div");
    dateField.className = "ga-settings-field";
    const dateLabel = doc.createElement("label");
    dateLabel.textContent = "Date format";
    const dateSelect = doc.createElement("select");
    dateSelect.innerHTML = `
      <option value="dd/mm/yyyy">DD/MM/YYYY</option>
      <option value="mm/dd/yyyy">MM/DD/YYYY</option>
      <option value="yyyy-mm-dd">YYYY-MM-DD</option>
      <option value="locale">Locale</option>
    `;
    dateSelect.value = settings.standards.dateFormat;
    dateField.appendChild(dateLabel);
    dateField.appendChild(dateSelect);

    const sessionField = doc.createElement("div");
    sessionField.className = "ga-settings-field";
    const sessionLabel = doc.createElement("label");
    sessionLabel.textContent = "New session gap (minutes)";
    const sessionInput = doc.createElement("input");
    sessionInput.type = "number";
    sessionInput.min = "1";
    sessionInput.max = "360";
    sessionInput.step = "1";
    sessionInput.value = String(settings.standards.sessionGapMinutes);
    sessionField.appendChild(sessionLabel);
    sessionField.appendChild(sessionInput);

    standardsGrid.appendChild(dateField);
    standardsGrid.appendChild(sessionField);
    standardsPane.appendChild(standardsGrid);

    const standardsNote = doc.createElement("div");
    standardsNote.className = "ga-settings-note";
    standardsNote.textContent = "Date format is applied in drilldowns. Session gap is stored as a standard value for session-based views.";
    standardsPane.appendChild(standardsNote);

    const templatePane = doc.createElement("div");
    templatePane.className = "ga-settings-pane";
    const templateField = doc.createElement("div");
    templateField.className = "ga-settings-field";
    const templateLabel = doc.createElement("label");
    templateLabel.textContent = "Live dashboard JSON template";
    const templateEditor = doc.createElement("textarea");
    templateEditor.value = JSON.stringify(dashboard, null, 2);
    const templateStatus = doc.createElement("div");
    templateStatus.className = "ga-settings-status";

    templateField.appendChild(templateLabel);
    templateField.appendChild(templateEditor);
    templatePane.appendChild(templateField);
    templatePane.appendChild(templateStatus);

    const filtersPane = doc.createElement("div");
    filtersPane.className = "ga-settings-pane";
    const filtersField = doc.createElement("div");
    filtersField.className = "ga-settings-field";
    const filtersLabel = doc.createElement("label");
    filtersLabel.textContent = "Global filters (FilterClause[] JSON)";
    const filtersEditor = doc.createElement("textarea");
    filtersEditor.value = JSON.stringify(getDashboard().dashboard.globalFilters ?? [], null, 2);
    const filtersStatus = doc.createElement("div");
    filtersStatus.className = "ga-settings-status";

    const dimsHint = doc.createElement("div");
    dimsHint.className = "ga-settings-note";
    const dims = Object.entries(semantic.dimensions)
      .filter(([, d]) => d.grain === "round")
      .map(([id, d]) => `${id} (${d.label})`)
      .sort((a, b) => a.localeCompare(b));
    dimsHint.textContent =
      dims.length > 0
        ? `Available round dimensions: ${dims.join(", ")}`
        : "No round dimensions found in semantic registry.";

    filtersField.appendChild(filtersLabel);
    filtersField.appendChild(filtersEditor);
    filtersPane.appendChild(filtersField);
    filtersPane.appendChild(filtersStatus);
    filtersPane.appendChild(dimsHint);

    panes.appendChild(appearancePane);
    panes.appendChild(standardsPane);
    panes.appendChild(templatePane);
    panes.appendChild(filtersPane);

    const setActiveTab = (idx: 0 | 1 | 2 | 3) => {
      const tabButtons = [appearanceTab, standardsTab, templateTab, filtersTab];
      const tabPanes = [appearancePane, standardsPane, templatePane, filtersPane];
      tabButtons.forEach((t, i) => t.classList.toggle("active", i === idx));
      tabPanes.forEach((p, i) => p.classList.toggle("active", i === idx));
    };

    appearanceTab.addEventListener("click", () => setActiveTab(0));
    standardsTab.addEventListener("click", () => setActiveTab(1));
    templateTab.addEventListener("click", () => setActiveTab(2));
    filtersTab.addEventListener("click", () => setActiveTab(3));

    const persistSettings = async () => {
      const next: SemanticDashboardSettings = {
        appearance: {
          theme: normalizeTheme(themeSelect.value),
          graphColor: normalizeColor(colorInput.value, DEFAULT_SETTINGS.appearance.graphColor),
          chartAnimations: animSelect.value !== "off"
        },
        standards: {
          dateFormat: normalizeDateFormat(dateSelect.value),
          sessionGapMinutes: (() => {
            const raw = Number(sessionInput.value);
            return Number.isFinite(raw) ? Math.max(1, Math.min(360, Math.round(raw))) : DEFAULT_SETTINGS.standards.sessionGapMinutes;
          })()
        }
      };
      await applySettings(next);
    };

    themeSelect.addEventListener("change", () => {
      void persistSettings();
    });
    colorInput.addEventListener("input", () => {
      void persistSettings();
    });
    animSelect.addEventListener("change", () => {
      void persistSettings();
    });
    dateSelect.addEventListener("change", () => {
      void persistSettings();
    });
    sessionInput.addEventListener("change", () => {
      void persistSettings();
    });

    let templateDebounce: number | null = null;
    const tryApplyTemplate = async () => {
      templateStatus.textContent = "";
      templateStatus.className = "ga-settings-status";
      try {
        const parsed = JSON.parse(templateEditor.value) as DashboardDoc;
        validateDashboardAgainstSemantic(semantic, parsed);
        await applyDashboard(parsed);
        templateStatus.textContent = "Template applied.";
        templateStatus.classList.add("ok");
      } catch (error) {
        templateStatus.textContent = error instanceof Error ? error.message : String(error);
        templateStatus.classList.add("error");
      }
    };
    templateEditor.addEventListener("input", () => {
      if (templateDebounce !== null) {
        targetWindow.clearTimeout(templateDebounce);
      }
      templateDebounce = targetWindow.setTimeout(() => {
        void tryApplyTemplate();
      }, 280);
    });

    let filtersDebounce: number | null = null;
    const tryApplyFilters = async () => {
      filtersStatus.textContent = "";
      filtersStatus.className = "ga-settings-status";
      try {
        const parsed = JSON.parse(filtersEditor.value) as unknown;
        const clauses = normalizeClauses(parsed);
        const next = cloneDashboard(getDashboard());
        if (!next.dashboard.globalFilters || next.dashboard.globalFilters.length !== clauses.length) {
          next.dashboard.globalFilters = clauses;
        } else {
          next.dashboard.globalFilters = clauses;
        }
        validateDashboardAgainstSemantic(semantic, next);
        await applyDashboard(next);
        filtersStatus.textContent = "Filters applied.";
        filtersStatus.classList.add("ok");
      } catch (error) {
        filtersStatus.textContent = error instanceof Error ? error.message : String(error);
        filtersStatus.classList.add("error");
      }
    };
    filtersEditor.addEventListener("input", () => {
      if (filtersDebounce !== null) {
        targetWindow.clearTimeout(filtersDebounce);
      }
      filtersDebounce = targetWindow.setTimeout(() => {
        void tryApplyFilters();
      }, 280);
    });

    bodyEl.appendChild(tabs);
    bodyEl.appendChild(panes);
    panel.appendChild(header);
    panel.appendChild(bodyEl);
    settingsModal.appendChild(bg);
    settingsModal.appendChild(panel);
  };

  openButton.addEventListener("click", () => {
    void openSettings();
  });
}
