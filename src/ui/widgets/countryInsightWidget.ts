import type { SemanticRegistry } from "../../config/semantic.types";
import type { CountryInsightSpec, WidgetDef } from "../../config/dashboard.types";
import type { Grain } from "../../config/semantic.types";
import { MEASURES_BY_GRAIN } from "../../engine/measures";
import { renderChartWidget } from "./chartWidget";
import { DrilldownOverlay } from "../drilldownOverlay";

function asTrimmedString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function normalizeCountryCode(v: unknown): string {
  return asTrimmedString(v).toLowerCase();
}

function pickGuessCountry(row: any): string {
  return asTrimmedString(row?.player_self_guessCountry ?? row?.p1_guessCountry ?? row?.guessCountry ?? row?.player_self_country);
}

function pickScore(row: any): number | null {
  const v = row?.player_self_score ?? row?.p1_score ?? row?.score;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function isHit(row: any): boolean {
  const truth = normalizeCountryCode(row?.trueCountry ?? row?.true_country);
  const guess = normalizeCountryCode(pickGuessCountry(row));
  return !!truth && !!guess && truth === guess;
}

function isThrow(row: any): boolean {
  const s = pickScore(row);
  return typeof s === "number" && s < 50;
}

function isFiveK(row: any): boolean {
  const s = pickScore(row);
  return typeof s === "number" && s >= 5000;
}

function formatPct01(v: number): string {
  const clamped = Math.max(0, Math.min(1, v));
  return `${(clamped * 100).toFixed(1)}%`;
}

function formatNumber(v: number, decimals = 1): string {
  if (!Number.isFinite(v)) return "-";
  return v.toFixed(decimals);
}

function countryDisplayName(code: string): string {
  const trimmed = code.trim();
  const iso2 = /^[a-z]{2}$/i.test(trimmed) ? trimmed.toUpperCase() : "";
  if (!iso2) return trimmed || "-";
  const dn = typeof Intl !== "undefined" && typeof (Intl as any).DisplayNames === "function"
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;
  const name = dn ? dn.of(iso2) : null;
  return name ? String(name) : iso2;
}

function mkBox(doc: Document, titleText: string): { wrap: HTMLDivElement; box: HTMLDivElement } {
  const wrap = doc.createElement("div");
  wrap.className = "ga-widget ga-statlist";

  const title = doc.createElement("div");
  title.className = "ga-widget-title";
  title.textContent = titleText;
  wrap.appendChild(title);

  const box = doc.createElement("div");
  box.className = "ga-statlist-box";
  wrap.appendChild(box);
  return { wrap, box };
}

function addRowWithDrill(args: {
  doc: Document;
  box: HTMLElement;
  label: string;
  value: string;
  drill?: { title: string; rows: any[] };
  open: (title: string, rows: any[]) => void;
}): void {
  const { doc, box, label, value, drill, open } = args;

  const line = doc.createElement("div");
  line.className = "ga-statrow";

  const left = doc.createElement("div");
  left.className = "ga-statrow-label";
  left.textContent = label;

  const right = doc.createElement("div");
  right.className = "ga-statrow-value";
  right.textContent = value;

  if (drill && Array.isArray(drill.rows) && drill.rows.length > 0) {
    line.style.cursor = "pointer";
    right.style.textDecoration = "underline";
    right.style.textUnderlineOffset = "2px";
    right.style.textDecorationThickness = "1px";
    line.addEventListener("click", () => open(drill.title, drill.rows));
  }

  line.appendChild(left);
  line.appendChild(right);
  box.appendChild(line);
}

function computeMeasure(semantic: SemanticRegistry, measureId: string, rows: any[]): number {
  const m = semantic.measures[measureId];
  if (!m) return 0;
  const grain = m.grain as Grain;
  const fn = MEASURES_BY_GRAIN[grain]?.[m.formulaId];
  if (!fn) return 0;
  return fn(rows);
}

function fmtMeasure(semantic: SemanticRegistry, measureId: string, value: number): string {
  const m = semantic.measures[measureId];
  if (!m) return String(value);
  const unit = semantic.units[m.unit];
  if (!unit) return String(value);

  if (unit.format === "percent") return formatPct01(value);
  if (unit.format === "int") return String(Math.round(value));
  if (unit.format === "duration") {
    const s = Math.max(0, Math.round(value));
    const days = Math.floor(s / 86400);
    const hours = Math.floor((s % 86400) / 3600);
    const mins = Math.floor((s % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    if (mins > 0) return `${mins}m ${s % 60}s`;
    return `${s}s`;
  }
  const decimals = unit.decimals ?? 1;
  return formatNumber(value, decimals);
}

export async function renderCountryInsightWidget(
  semantic: SemanticRegistry,
  widget: WidgetDef,
  overlay: DrilldownOverlay,
  baseRows?: any[]
): Promise<HTMLElement> {
  const _spec = widget.spec as CountryInsightSpec;
  const doc = overlay.getDocument();
  const wrap = doc.createElement("div");
  wrap.className = "ga-widget ga-country-insight";

  const grain = widget.grain as Grain;
  if (grain !== "round") {
    const ph = doc.createElement("div");
    ph.className = "ga-widget ga-placeholder";
    ph.textContent = "Country insight requires round grain";
    return ph;
  }

  const all = Array.isArray(baseRows) ? baseRows : [];
  const available = new Map<string, number>();
  for (const r of all) {
    const code = normalizeCountryCode(r?.trueCountry ?? r?.true_country);
    if (!code) continue;
    available.set(code, (available.get(code) ?? 0) + 1);
  }

  const options = Array.from(available.entries())
    .map(([code, n]) => ({ code, n }))
    .sort((a, b) => (b.n - a.n) || a.code.localeCompare(b.code))
    .map(({ code, n }) => ({
      value: code,
      label: `${countryDisplayName(code)} (${n} rounds)`
    }));

  const title = doc.createElement("div");
  title.className = "ga-widget-title";
  title.textContent = "Country Insight";
  wrap.appendChild(title);

  if (options.length === 0) {
    const empty = doc.createElement("div");
    empty.className = "ga-statlist-box";
    empty.textContent = "No country data available for the current global filters.";
    wrap.appendChild(empty);
    return wrap;
  }

  const storageKey = "geoanalyzr:semantic:country:spotlight";
  const ls = doc.defaultView?.localStorage;
  let selected = typeof ls?.getItem(storageKey) === "string" ? String(ls?.getItem(storageKey) ?? "").trim().toLowerCase() : "";
  const valueSet = new Set(options.map((o) => o.value));
  if (!selected || !valueSet.has(selected)) selected = options[0].value;
  ls?.setItem(storageKey, selected);

  const localFilters = doc.createElement("div");
  localFilters.className = "ga-country-local-filters";

  const filterBox = doc.createElement("div");
  filterBox.className = "ga-filter";
  const filterLabel = doc.createElement("div");
  filterLabel.className = "ga-filter-label";
  filterLabel.textContent = "Country (local)";
  const filterRow = doc.createElement("div");
  filterRow.className = "ga-filter-row";
  const sel = doc.createElement("select");
  sel.className = "ga-filter-select";
  for (const opt of options) sel.appendChild(new Option(opt.label, opt.value));
  sel.value = selected;
  filterRow.appendChild(sel);
  filterBox.appendChild(filterLabel);
  filterBox.appendChild(filterRow);
  localFilters.appendChild(filterBox);

  const note = doc.createElement("div");
  note.className = "ga-settings-note";
  note.textContent = "Note: Global 'Country' filter is ignored here. Use this local selector instead.";
  localFilters.appendChild(note);

  wrap.appendChild(localFilters);

  const host = doc.createElement("div");
  wrap.appendChild(host);

  const openRounds = (drillTitle: string, rows: any[]) => {
    overlay.open(semantic, { title: drillTitle, target: "rounds", columnsPreset: "roundMode", rows });
  };

  const renderFor = async (countryCode: string) => {
    host.innerHTML = "";
    const rows = all.filter((r) => normalizeCountryCode(r?.trueCountry ?? r?.true_country) === countryCode);
    const display = countryDisplayName(countryCode);

    const header = doc.createElement("div");
    header.className = "ga-widget-title";
    header.textContent = `Country Spotlight: ${display}`;
    host.appendChild(header);

    if (!rows.length) {
      const empty = doc.createElement("div");
      empty.className = "ga-statlist-box";
      empty.textContent = "No rounds for this country in the current global filters.";
      host.appendChild(empty);
      return;
    }

    const roundsCount = rows.length;
    const hitRows = rows.filter(isHit);
    const throwRows = rows.filter(isThrow);
    const fiveKRows = rows.filter(isFiveK);

    const avgScore = computeMeasure(semantic, "avg_score", rows);
    const medianScore = computeMeasure(semantic, "score_median", rows);
    const avgDist = computeMeasure(semantic, "avg_distance_km", rows);

    const hitRate = roundsCount ? hitRows.length / roundsCount : 0;
    const throwRate = roundsCount ? throwRows.length / roundsCount : 0;
    const fiveKRate = roundsCount ? fiveKRows.length / roundsCount : 0;

    // Confusions: guess != truth for this spotlight country.
    const confusionCounts = new Map<string, { n: number; rows: any[] }>();
    for (const r of rows) {
      const truth = normalizeCountryCode(r?.trueCountry ?? r?.true_country);
      const guessRaw = pickGuessCountry(r);
      const guess = normalizeCountryCode(guessRaw);
      if (!truth || !guess || truth === guess) continue;
      const cur = confusionCounts.get(guess) ?? { n: 0, rows: [] };
      cur.n += 1;
      cur.rows.push(r);
      confusionCounts.set(guess, cur);
    }
    const topConfusions = Array.from(confusionCounts.entries())
      .map(([guess, data]) => ({ guess, n: data.n, rows: data.rows }))
      .sort((a, b) => (b.n - a.n) || a.guess.localeCompare(b.guess))
      .slice(0, 3);

    const stats = mkBox(doc, "Country insight:");
    addRowWithDrill({ doc, box: stats.box, label: "Rounds", value: String(roundsCount), drill: { title: `${display} - Rounds`, rows }, open: openRounds });
    addRowWithDrill({
      doc,
      box: stats.box,
      label: "Hit rate",
      value: formatPct01(hitRate),
      drill: { title: `${display} - Hits`, rows: hitRows },
      open: openRounds
    });
    addRowWithDrill({
      doc,
      box: stats.box,
      label: "Avg score",
      value: `${fmtMeasure(semantic, "avg_score", avgScore)} | Median score: ${fmtMeasure(semantic, "score_median", medianScore)}`,
      drill: { title: `${display} - Rounds`, rows },
      open: openRounds
    });
    addRowWithDrill({
      doc,
      box: stats.box,
      label: "Avg distance",
      value: `${fmtMeasure(semantic, "avg_distance_km", avgDist)} km`,
      drill: { title: `${display} - Rounds`, rows },
      open: openRounds
    });
    addRowWithDrill({
      doc,
      box: stats.box,
      label: "Perfect 5k in this country",
      value: `${fiveKRows.length} (${formatPct01(fiveKRate)})`,
      drill: { title: `${display} - Perfect 5k`, rows: fiveKRows },
      open: openRounds
    });
    addRowWithDrill({
      doc,
      box: stats.box,
      label: "Throws (<50) in this country",
      value: `${throwRows.length} (${formatPct01(throwRate)})`,
      drill: { title: `${display} - Throws (<50)`, rows: throwRows },
      open: openRounds
    });

    const confBox = mkBox(doc, "Top confusions (guess country):");
    if (topConfusions.length === 0) {
      const line = doc.createElement("div");
      line.className = "ga-statrow";
      const left = doc.createElement("div");
      left.className = "ga-statrow-label";
      left.textContent = "No confusions found";
      const right = doc.createElement("div");
      right.className = "ga-statrow-value";
      right.textContent = "-";
      line.appendChild(left);
      line.appendChild(right);
      confBox.box.appendChild(line);
    } else {
      for (const c of topConfusions) {
        const name = countryDisplayName(c.guess);
        addRowWithDrill({
          doc,
          box: confBox.box,
          label: name,
          value: String(c.n),
          drill: { title: `${display} confused with ${name}`, rows: c.rows },
          open: openRounds
        });
      }
    }

    const distWidget: WidgetDef = {
      widgetId: "w_country_spotlight_distribution",
      type: "chart",
      title: `Country Spotlight: ${display} - Score distribution`,
      grain: "round",
      spec: {
        type: "bar",
        limit: 200,
        x: { dimension: "score_bucket" },
        y: { measure: "rounds_count" },
        sort: { mode: "chronological" },
        actions: {
          hover: true,
          click: { type: "drilldown", target: "rounds", columnsPreset: "roundMode", filterFromPoint: true }
        }
      } as any
    };

    const chartEl = await renderChartWidget(semantic, distWidget, overlay, { round: rows }, undefined);

    const grid = doc.createElement("div");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "repeat(12, minmax(0, 1fr))";
    grid.style.gap = "10px";

    const a = doc.createElement("div");
    a.style.gridColumn = "1 / span 12";
    a.appendChild(stats.wrap);
    a.appendChild(confBox.wrap);

    const b = doc.createElement("div");
    b.style.gridColumn = "1 / span 12";
    b.appendChild(chartEl);

    grid.appendChild(a);
    grid.appendChild(b);
    host.appendChild(grid);
  };

  sel.addEventListener("change", () => {
    const next = sel.value;
    if (!next) return;
    selected = next;
    ls?.setItem(storageKey, next);
    void renderFor(next);
  });

  await renderFor(selected);
  return wrap;
}

