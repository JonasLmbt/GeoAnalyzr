import type { DashboardDoc } from "../config/dashboard.types";
import type { SemanticRegistry } from "../config/semantic.types";
import { validateDashboardAgainstSemantic } from "../engine/validate";
import { mergeSemanticWithDashboard } from "../engine/semanticMerge";
import { renderLayoutEditor } from "./layoutEditor";
import { analysisConsole, formatConsoleEntry } from "./consoleStore";
import {
  DEFAULT_SETTINGS,
  normalizeColor,
  normalizeCountryFormat,
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
  getDefaultDashboard: () => DashboardDoc;
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
      getDefaultDashboard,
      applyDashboard,
      getSettings,
      applySettings
    } = opts;

  const cloneDashboard = (value: DashboardDoc): DashboardDoc => {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value)) as DashboardDoc;
  };

  const downloadJson = (filename: string, value: unknown): void => {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = doc.createElement("a");
    a.href = url;
    a.download = filename;
    (doc.body ?? doc.documentElement).appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const readJsonFromFileInput = async (input: HTMLInputElement): Promise<any> => {
    const file = input.files?.[0] ?? null;
    if (!file) return null;
    const text = await file.text();
    return JSON.parse(text);
  };

  const settingsModal = doc.createElement("div");
  settingsModal.className = "ga-settings-modal";
  settingsModal.style.display = "none";
  root.appendChild(settingsModal);

  const openSettings = async () => {
    settingsModal.innerHTML = "";
    settingsModal.style.display = "block";

    let consoleUnsubscribe: (() => void) | null = null;
    const cleanup = () => {
      if (consoleUnsubscribe) {
        try {
          consoleUnsubscribe();
        } catch {
          // ignore
        }
        consoleUnsubscribe = null;
      }
    };

    const bg = doc.createElement("div");
    bg.className = "ga-settings-bg";
    bg.addEventListener("click", () => {
      cleanup();
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
      cleanup();
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
    const sectionLayoutTab = doc.createElement("button");
    sectionLayoutTab.className = "ga-settings-tab";
    sectionLayoutTab.textContent = "Section Layout";
    const globalFiltersTab = doc.createElement("button");
    globalFiltersTab.className = "ga-settings-tab";
    globalFiltersTab.textContent = "Global Filters";
    const drilldownsTab = doc.createElement("button");
    drilldownsTab.className = "ga-settings-tab";
    drilldownsTab.textContent = "Drilldowns";
    const consoleTab = doc.createElement("button");
    consoleTab.className = "ga-settings-tab";
    consoleTab.textContent = "Console";
    tabs.appendChild(appearanceTab);
    tabs.appendChild(standardsTab);
    tabs.appendChild(sectionLayoutTab);
    tabs.appendChild(globalFiltersTab);
    tabs.appendChild(drilldownsTab);
    tabs.appendChild(consoleTab);
    tabs.appendChild(templateTab);

    const settings = getSettings();
    let dashboard = getDashboard();

    const appearancePane = doc.createElement("div");
    appearancePane.className = "ga-settings-pane active";
    const appearanceGrid = doc.createElement("div");
    appearanceGrid.className = "ga-settings-grid";

    const themeField = doc.createElement("div");
    themeField.className = "ga-settings-field";
    const themeLabel = doc.createElement("label");
    themeLabel.textContent = "Theme";
    const themeSelect = doc.createElement("select");
    themeSelect.innerHTML = `
      <option value="geoguessr">GeoGuessr</option>
      <option value="dark">Dark</option>
      <option value="light">Light</option>
    `;
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

    const syncAppearanceUi = () => {
      const isGeoGuessr = themeSelect.value === "geoguessr";
      colorInput.disabled = isGeoGuessr;
      colorInput.title = isGeoGuessr ? "GeoGuessr theme uses a tuned graph color." : "";
    };
    syncAppearanceUi();

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

    const countryField = doc.createElement("div");
    countryField.className = "ga-settings-field";
    const countryLabel = doc.createElement("label");
    countryLabel.textContent = "Country format";
    const countrySelect = doc.createElement("select");
    countrySelect.innerHTML = `
      <option value="iso2">ISO2 (e.g. US)</option>
      <option value="english">English (e.g. United States)</option>
    `;
    countrySelect.value = settings.standards.countryFormat;
    countryField.appendChild(countryLabel);
    countryField.appendChild(countrySelect);

    standardsGrid.appendChild(dateField);
    standardsGrid.appendChild(sessionField);
    standardsGrid.appendChild(countryField);
    standardsPane.appendChild(standardsGrid);

    const standardsNote = doc.createElement("div");
    standardsNote.className = "ga-settings-note";
    standardsNote.textContent =
      "Date format is applied in drilldowns. Session gap is stored as a standard value for session-based views. Country format affects country labels (confusion matrix stays ISO2).";
    standardsPane.appendChild(standardsNote);

    const templatePane = doc.createElement("div");
    templatePane.className = "ga-settings-pane";

    const templateWarn = doc.createElement("div");
    templateWarn.className = "ga-settings-note";
    templateWarn.textContent =
      "Warning: Editing the template JSON can easily break the dashboard. Prefer Section Layout / Global Filters / Drilldowns unless you know what you're doing.";
    templatePane.appendChild(templateWarn);

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

    const templateActions = doc.createElement("div");
    templateActions.className = "ga-settings-actions";

    const templateDownload = doc.createElement("button");
    templateDownload.type = "button";
    templateDownload.className = "ga-filter-btn";
    templateDownload.textContent = "Download template";
    templateDownload.title = "Download the current dashboard template as JSON";

    const templateUpload = doc.createElement("button");
    templateUpload.type = "button";
    templateUpload.className = "ga-filter-btn";
    templateUpload.textContent = "Upload template";
    templateUpload.title = "Upload a dashboard template JSON file";

    const templateUploadInput = doc.createElement("input");
    templateUploadInput.type = "file";
    templateUploadInput.accept = "application/json,.json";
    templateUploadInput.style.display = "none";

    const templateReset = doc.createElement("button");
    templateReset.type = "button";
    templateReset.className = "ga-filter-btn";
    templateReset.textContent = "Reset to latest";
    templateReset.title = "Reset template to the latest bundled dashboard.json";

    templateActions.appendChild(templateDownload);
    templateActions.appendChild(templateUpload);
    templateActions.appendChild(templateUploadInput);
    templateActions.appendChild(templateReset);
    templatePane.appendChild(templateActions);
    templatePane.appendChild(templateStatus);

    const sectionLayoutPane = doc.createElement("div");
    sectionLayoutPane.className = "ga-settings-pane";
    const sectionLayoutStatus = doc.createElement("div");
    sectionLayoutStatus.className = "ga-settings-status";
    const sectionLayoutHost = doc.createElement("div");

    const sectionLayoutActions = doc.createElement("div");
    sectionLayoutActions.className = "ga-settings-actions";
    const sectionLayoutDownload = doc.createElement("button");
    sectionLayoutDownload.type = "button";
    sectionLayoutDownload.className = "ga-filter-btn";
    sectionLayoutDownload.textContent = "Download sections";
    sectionLayoutDownload.title = "Download only dashboard sections as JSON";
    const sectionLayoutUpload = doc.createElement("button");
    sectionLayoutUpload.type = "button";
    sectionLayoutUpload.className = "ga-filter-btn";
    sectionLayoutUpload.textContent = "Upload sections";
    sectionLayoutUpload.title = "Upload JSON to replace dashboard sections";
    const sectionLayoutUploadInput = doc.createElement("input");
    sectionLayoutUploadInput.type = "file";
    sectionLayoutUploadInput.accept = "application/json,.json";
    sectionLayoutUploadInput.style.display = "none";
    sectionLayoutActions.appendChild(sectionLayoutDownload);
    sectionLayoutActions.appendChild(sectionLayoutUpload);
    sectionLayoutActions.appendChild(sectionLayoutUploadInput);
    sectionLayoutPane.appendChild(sectionLayoutActions);

    sectionLayoutPane.appendChild(sectionLayoutHost);
    sectionLayoutPane.appendChild(sectionLayoutStatus);

    const globalFiltersPane = doc.createElement("div");
    globalFiltersPane.className = "ga-settings-pane";
    const globalFiltersStatus = doc.createElement("div");
    globalFiltersStatus.className = "ga-settings-status";
    const globalFiltersHost = doc.createElement("div");

    const globalFiltersActions = doc.createElement("div");
    globalFiltersActions.className = "ga-settings-actions";
    const globalFiltersDownload = doc.createElement("button");
    globalFiltersDownload.type = "button";
    globalFiltersDownload.className = "ga-filter-btn";
    globalFiltersDownload.textContent = "Download filters";
    globalFiltersDownload.title = "Download only globalFilters as JSON";
    const globalFiltersUpload = doc.createElement("button");
    globalFiltersUpload.type = "button";
    globalFiltersUpload.className = "ga-filter-btn";
    globalFiltersUpload.textContent = "Upload filters";
    globalFiltersUpload.title = "Upload JSON to replace globalFilters";
    const globalFiltersUploadInput = doc.createElement("input");
    globalFiltersUploadInput.type = "file";
    globalFiltersUploadInput.accept = "application/json,.json";
    globalFiltersUploadInput.style.display = "none";
    globalFiltersActions.appendChild(globalFiltersDownload);
    globalFiltersActions.appendChild(globalFiltersUpload);
    globalFiltersActions.appendChild(globalFiltersUploadInput);
    globalFiltersPane.appendChild(globalFiltersActions);

    globalFiltersPane.appendChild(globalFiltersHost);
    globalFiltersPane.appendChild(globalFiltersStatus);

    const drilldownsPane = doc.createElement("div");
    drilldownsPane.className = "ga-settings-pane";
    const drilldownsStatus = doc.createElement("div");
    drilldownsStatus.className = "ga-settings-status";
    const drilldownsHost = doc.createElement("div");

    const drilldownsActions = doc.createElement("div");
    drilldownsActions.className = "ga-settings-actions";
    const drilldownsDownload = doc.createElement("button");
    drilldownsDownload.type = "button";
    drilldownsDownload.className = "ga-filter-btn";
    drilldownsDownload.textContent = "Download drilldowns";
    drilldownsDownload.title = "Download only drilldownPresets as JSON";
    const drilldownsUpload = doc.createElement("button");
    drilldownsUpload.type = "button";
    drilldownsUpload.className = "ga-filter-btn";
    drilldownsUpload.textContent = "Upload drilldowns";
    drilldownsUpload.title = "Upload JSON to replace drilldownPresets";
    const drilldownsUploadInput = doc.createElement("input");
    drilldownsUploadInput.type = "file";
    drilldownsUploadInput.accept = "application/json,.json";
    drilldownsUploadInput.style.display = "none";
    drilldownsActions.appendChild(drilldownsDownload);
    drilldownsActions.appendChild(drilldownsUpload);
    drilldownsActions.appendChild(drilldownsUploadInput);
    drilldownsPane.appendChild(drilldownsActions);

    drilldownsPane.appendChild(drilldownsHost);
    drilldownsPane.appendChild(drilldownsStatus);

    const consolePane = doc.createElement("div");
    consolePane.className = "ga-settings-pane";

    const consoleNote = doc.createElement("div");
    consoleNote.className = "ga-settings-note";
    consoleNote.textContent = "Hints and error messages from the analysis window. Useful for debugging when something looks off.";
    consolePane.appendChild(consoleNote);

    const consoleActions = doc.createElement("div");
    consoleActions.className = "ga-settings-actions";

    const consoleCopy = doc.createElement("button");
    consoleCopy.type = "button";
    consoleCopy.className = "ga-filter-btn";
    consoleCopy.textContent = "Copy";
    consoleCopy.title = "Copy console text to clipboard";

    const consoleClear = doc.createElement("button");
    consoleClear.type = "button";
    consoleClear.className = "ga-filter-btn";
    consoleClear.textContent = "Clear";
    consoleClear.title = "Clear console";

    const onlyErrorsWrap = doc.createElement("label");
    onlyErrorsWrap.style.display = "inline-flex";
    onlyErrorsWrap.style.alignItems = "center";
    onlyErrorsWrap.style.gap = "6px";
    const onlyErrors = doc.createElement("input");
    onlyErrors.type = "checkbox";
    const onlyErrorsText = doc.createElement("span");
    onlyErrorsText.textContent = "Only errors";
    onlyErrorsWrap.appendChild(onlyErrors);
    onlyErrorsWrap.appendChild(onlyErrorsText);

    consoleActions.appendChild(consoleCopy);
    consoleActions.appendChild(consoleClear);
    consoleActions.appendChild(onlyErrorsWrap);
    consolePane.appendChild(consoleActions);

    const consoleBox = doc.createElement("pre");
    consoleBox.className = "ga-console-box";
    consoleBox.style.marginTop = "10px";
    consoleBox.style.whiteSpace = "pre-wrap";
    consoleBox.style.maxHeight = "50vh";
    consoleBox.style.overflow = "auto";
    consoleBox.style.padding = "10px 12px";
    consoleBox.style.borderRadius = "10px";
    consoleBox.style.border = "1px solid var(--ga-control-border)";
    consoleBox.style.background = "rgba(0,0,0,0.25)";
    consoleBox.style.font =
      "12px/1.35 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace";
    consolePane.appendChild(consoleBox);

    const renderConsole = () => {
      const list = analysisConsole.entries;
      const filtered = onlyErrors.checked ? list.filter((e) => e.level === "error") : list;
      consoleBox.textContent = filtered.map(formatConsoleEntry).join("\n");
      // auto-scroll to bottom
      consoleBox.scrollTop = consoleBox.scrollHeight;
    };
    consoleUnsubscribe = analysisConsole.subscribe(renderConsole);
    renderConsole();

    onlyErrors.addEventListener("change", renderConsole);
    consoleClear.addEventListener("click", () => analysisConsole.clear());
    consoleCopy.addEventListener("click", async () => {
      const text = consoleBox.textContent ?? "";
      try {
        await (doc.defaultView as any)?.navigator?.clipboard?.writeText?.(text);
      } catch {
        try {
          const range = doc.createRange();
          range.selectNodeContents(consoleBox);
          const sel = doc.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
          doc.execCommand("copy");
          sel?.removeAllRanges();
        } catch {
          // ignore
        }
      }
    });

    panes.appendChild(appearancePane);
    panes.appendChild(standardsPane);
    panes.appendChild(sectionLayoutPane);
    panes.appendChild(globalFiltersPane);
    panes.appendChild(drilldownsPane);
    panes.appendChild(consolePane);
    panes.appendChild(templatePane);

    const renderLayout = (mode: "section_layout" | "global_filters" | "drilldowns", host: HTMLDivElement, status: HTMLDivElement) => {
      host.innerHTML = "";
      const latest = getDashboard();
      dashboard = latest;
      templateEditor.value = JSON.stringify(latest, null, 2);
      host.appendChild(
        renderLayoutEditor({
          doc,
          semantic,
          dashboard: latest,
          mode,
          statusEl: status,
          onChange: (next) => {
            void (async () => {
              try {
                await applyDashboard(next);
                dashboard = next;
                templateEditor.value = JSON.stringify(next, null, 2);
              } catch (e) {
                status.textContent = e instanceof Error ? e.message : String(e);
                status.className = "ga-settings-status error";
              }
            })();
          }
        })
      );
    };

    sectionLayoutDownload.addEventListener("click", () => {
      const cur = getDashboard();
      downloadJson("geoanalyzr.sections.json", (cur as any)?.dashboard?.sections ?? []);
    });
    sectionLayoutUpload.addEventListener("click", () => sectionLayoutUploadInput.click());
    sectionLayoutUploadInput.addEventListener("change", () => {
      void (async () => {
        try {
          const parsed = await readJsonFromFileInput(sectionLayoutUploadInput);
          const sections = Array.isArray(parsed) ? parsed : (parsed as any)?.dashboard?.sections ?? (parsed as any)?.sections;
          if (!Array.isArray(sections)) throw new Error("Invalid sections JSON (expected an array or { sections: [...] }).");
          const next = cloneDashboard(getDashboard()) as any;
          next.dashboard.sections = sections;
          await applyDashboard(next);
          dashboard = next;
          templateEditor.value = JSON.stringify(next, null, 2);
          renderLayout("section_layout", sectionLayoutHost, sectionLayoutStatus);
          sectionLayoutStatus.textContent = "Sections imported.";
          sectionLayoutStatus.className = "ga-settings-status ok";
        } catch (e) {
          sectionLayoutStatus.textContent = e instanceof Error ? e.message : String(e);
          sectionLayoutStatus.className = "ga-settings-status error";
        } finally {
          sectionLayoutUploadInput.value = "";
        }
      })();
    });

    globalFiltersDownload.addEventListener("click", () => {
      const cur = getDashboard();
      downloadJson("geoanalyzr.globalFilters.json", (cur as any)?.dashboard?.globalFilters ?? {});
    });
    globalFiltersUpload.addEventListener("click", () => globalFiltersUploadInput.click());
    globalFiltersUploadInput.addEventListener("change", () => {
      void (async () => {
        try {
          const parsed = await readJsonFromFileInput(globalFiltersUploadInput);
          const gf = (parsed as any)?.dashboard?.globalFilters ?? (parsed as any)?.globalFilters ?? parsed;
          if (!gf || typeof gf !== "object") throw new Error("Invalid globalFilters JSON.");
          const next = cloneDashboard(getDashboard()) as any;
          next.dashboard.globalFilters = gf;
          await applyDashboard(next);
          dashboard = next;
          templateEditor.value = JSON.stringify(next, null, 2);
          renderLayout("global_filters", globalFiltersHost, globalFiltersStatus);
          globalFiltersStatus.textContent = "Global filters imported.";
          globalFiltersStatus.className = "ga-settings-status ok";
        } catch (e) {
          globalFiltersStatus.textContent = e instanceof Error ? e.message : String(e);
          globalFiltersStatus.className = "ga-settings-status error";
        } finally {
          globalFiltersUploadInput.value = "";
        }
      })();
    });

    drilldownsDownload.addEventListener("click", () => {
      const cur = getDashboard();
      downloadJson("geoanalyzr.drilldownPresets.json", (cur as any)?.dashboard?.drilldownPresets ?? {});
    });
    drilldownsUpload.addEventListener("click", () => drilldownsUploadInput.click());
    drilldownsUploadInput.addEventListener("change", () => {
      void (async () => {
        try {
          const parsed = await readJsonFromFileInput(drilldownsUploadInput);
          const dd = (parsed as any)?.dashboard?.drilldownPresets ?? (parsed as any)?.drilldownPresets ?? parsed;
          if (!dd || typeof dd !== "object") throw new Error("Invalid drilldownPresets JSON.");
          const next = cloneDashboard(getDashboard()) as any;
          next.dashboard.drilldownPresets = dd;
          await applyDashboard(next);
          dashboard = next;
          templateEditor.value = JSON.stringify(next, null, 2);
          renderLayout("drilldowns", drilldownsHost, drilldownsStatus);
          drilldownsStatus.textContent = "Drilldowns imported.";
          drilldownsStatus.className = "ga-settings-status ok";
        } catch (e) {
          drilldownsStatus.textContent = e instanceof Error ? e.message : String(e);
          drilldownsStatus.className = "ga-settings-status error";
        } finally {
          drilldownsUploadInput.value = "";
        }
      })();
    });

    let renderedSectionLayout = false;
    let renderedGlobalFilters = false;
    let renderedDrilldowns = false;

    const setActiveTab = (idx: 0 | 1 | 2 | 3 | 4 | 5 | 6) => {
      const tabButtons = [appearanceTab, standardsTab, sectionLayoutTab, globalFiltersTab, drilldownsTab, consoleTab, templateTab];
      const tabPanes = [appearancePane, standardsPane, sectionLayoutPane, globalFiltersPane, drilldownsPane, consolePane, templatePane];
      tabButtons.forEach((t, i) => t.classList.toggle("active", i === idx));
      tabPanes.forEach((p, i) => p.classList.toggle("active", i === idx));
      if (idx === 2 && !renderedSectionLayout) {
        renderedSectionLayout = true;
        renderLayout("section_layout", sectionLayoutHost, sectionLayoutStatus);
      }
      if (idx === 3 && !renderedGlobalFilters) {
        renderedGlobalFilters = true;
        renderLayout("global_filters", globalFiltersHost, globalFiltersStatus);
      }
      if (idx === 4 && !renderedDrilldowns) {
        renderedDrilldowns = true;
        renderLayout("drilldowns", drilldownsHost, drilldownsStatus);
      }
    };

    appearanceTab.addEventListener("click", () => setActiveTab(0));
    standardsTab.addEventListener("click", () => setActiveTab(1));
    sectionLayoutTab.addEventListener("click", () => setActiveTab(2));
    globalFiltersTab.addEventListener("click", () => setActiveTab(3));
    drilldownsTab.addEventListener("click", () => setActiveTab(4));
    consoleTab.addEventListener("click", () => setActiveTab(5));
    templateTab.addEventListener("click", () => setActiveTab(6));

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
          })(),
          countryFormat: normalizeCountryFormat(countrySelect.value)
        }
      };
      await applySettings(next);
    };

    themeSelect.addEventListener("change", () => {
      syncAppearanceUi();
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
    countrySelect.addEventListener("change", () => {
      void persistSettings();
    });

    let templateDebounce: number | null = null;
    const tryApplyTemplate = async () => {
      templateStatus.textContent = "";
      templateStatus.className = "ga-settings-status";
      try {
        const parsed = JSON.parse(templateEditor.value) as DashboardDoc;
        validateDashboardAgainstSemantic(mergeSemanticWithDashboard(semantic, parsed), parsed);
        await applyDashboard(parsed);
        dashboard = parsed;
        templateStatus.textContent = "Template applied.";
        templateStatus.classList.add("ok");
      } catch (error) {
        templateStatus.textContent = error instanceof Error ? error.message : String(error);
        templateStatus.classList.add("error");
      }
    };

    const downloadTextFile = (filename: string, text: string) => {
      const blob = new Blob([text], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = doc.createElement("a");
      a.href = url;
      a.download = filename;
      (doc.body ?? doc.documentElement).appendChild(a);
      a.click();
      a.remove();
      targetWindow.setTimeout(() => URL.revokeObjectURL(url), 0);
    };

    templateDownload.addEventListener("click", () => {
      try {
        const parsed = JSON.parse(templateEditor.value) as DashboardDoc;
        validateDashboardAgainstSemantic(mergeSemanticWithDashboard(semantic, parsed), parsed);
        const stamp = new Date().toISOString().slice(0, 10);
        downloadTextFile(`geoanalyzr-dashboard-template-${stamp}.json`, JSON.stringify(parsed, null, 2));
        templateStatus.textContent = "Template downloaded.";
        templateStatus.className = "ga-settings-status ok";
      } catch (error) {
        templateStatus.textContent = error instanceof Error ? error.message : String(error);
        templateStatus.className = "ga-settings-status error";
      }
    });

    templateUpload.addEventListener("click", () => {
      templateUploadInput.value = "";
      templateUploadInput.click();
    });

    templateUploadInput.addEventListener("change", () => {
      const f = templateUploadInput.files?.[0] ?? null;
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === "string" ? reader.result : "";
        templateEditor.value = text;
        void tryApplyTemplate();
      };
      reader.onerror = () => {
        templateStatus.textContent = "Failed to read file.";
        templateStatus.className = "ga-settings-status error";
      };
      reader.readAsText(f);
    });
    templateReset.addEventListener("click", () => {
      void (async () => {
        templateStatus.textContent = "";
        templateStatus.className = "ga-settings-status";
        try {
          const next = cloneDashboard(getDefaultDashboard());
          validateDashboardAgainstSemantic(mergeSemanticWithDashboard(semantic, next), next);
          await applyDashboard(next);
          dashboard = next;
          templateEditor.value = JSON.stringify(next, null, 2);
          templateStatus.textContent = "Template reset to latest version.";
          templateStatus.classList.add("ok");
        } catch (error) {
          templateStatus.textContent = error instanceof Error ? error.message : String(error);
          templateStatus.classList.add("error");
        }
      })();
    });
    templateEditor.addEventListener("input", () => {
      if (templateDebounce !== null) {
        targetWindow.clearTimeout(templateDebounce);
      }
      templateDebounce = targetWindow.setTimeout(() => {
        void tryApplyTemplate();
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
