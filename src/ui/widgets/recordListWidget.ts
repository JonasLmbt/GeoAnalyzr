import type { SemanticRegistry } from "../../config/semantic.types";
import type { WidgetDef, RecordListSpec, RecordItemDef, Actions } from "../../config/dashboard.types";
import type { Grain } from "../../config/semantic.types";
import { getRounds, getGames, getSessions } from "../../engine/queryEngine";
import { DIMENSION_EXTRACTORS } from "../../engine/dimensions";
import { groupByKey } from "../../engine/aggregate";
import { MEASURES_BY_GRAIN } from "../../engine/measures";
import { applyFilters } from "../../engine/filters";
import { DrilldownOverlay } from "../drilldownOverlay";

type RecordResult = {
  keyText: string;
  valueText: string;
  rows: any[];
  click?: Actions["click"];
};

function formatMetricValue(semantic: SemanticRegistry, measureId: string, value: number): string {
  const m = semantic.measures[measureId];
  const unit = m ? semantic.units[m.unit] : undefined;
  if (!unit) return String(value);
  if (unit.format === "percent") {
    const clamped = Math.max(0, Math.min(1, value));
    return `${(clamped * 100).toFixed(unit.decimals ?? 1)}%`;
  }
  if (unit.format === "duration") {
    const s = Math.max(0, Math.round(value));
    const days = Math.floor(s / 86400);
    const hours = Math.floor((s % 86400) / 3600);
    const mins = Math.floor((s % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    if (mins > 0) return `${mins}m ${s % 60}s`;
    return `${Math.max(0, value).toFixed(1)}s`;
  }
  if (unit.format === "int") {
    const v = Math.round(value);
    return unit.showSign && v > 0 ? `+${v}` : String(v);
  }
  const txt = value.toFixed(unit.decimals ?? 1);
  return unit.showSign && value > 0 ? `+${txt}` : txt;
}

function formatTs(ts: number): string {
  // Keep it stable and readable; drilldown table has user-configurable formats already.
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return String(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${m}/${y} ${hh}:${mm}`;
}

function getRowTs(row: any): number | null {
  const a = row?.playedAt;
  if (typeof a === "number" && Number.isFinite(a)) return a;
  const b = row?.ts;
  if (typeof b === "number" && Number.isFinite(b)) return b;
  return null;
}

function buildGroupExtreme(
  semantic: SemanticRegistry,
  grain: Grain,
  rowsAll: any[],
  rec: RecordItemDef
): RecordResult | null {
  const metricId = typeof rec.metric === "string" ? rec.metric.trim() : "";
  const groupById = typeof rec.groupBy === "string" ? rec.groupBy.trim() : "";
  const extreme = rec.extreme === "min" ? "min" : "max";
  if (!metricId || !groupById) return null;

  const metric = semantic.measures[metricId];
  if (!metric) return null;
  const fn = MEASURES_BY_GRAIN[grain]?.[metric.formulaId];
  if (!fn) return null;
  const keyFn = DIMENSION_EXTRACTORS[grain]?.[groupById];
  if (!keyFn) return null;

  const inputRows = Array.isArray(rec.filters) && rec.filters.length ? applyFilters(rowsAll, rec.filters, grain) : rowsAll;
  const grouped = groupByKey(inputRows, keyFn);
  let bestKey: string | null = null;
  let bestVal: number | null = null;
  let bestRows: any[] = [];

  for (const [k, g] of grouped.entries()) {
    if (!g || g.length === 0) continue;
    const v = fn(g);
    if (!Number.isFinite(v)) continue;
    if (bestVal === null) {
      bestKey = k;
      bestVal = v;
      bestRows = g;
      continue;
    }
    const better = extreme === "max" ? v > bestVal : v < bestVal;
    if (better) {
      bestKey = k;
      bestVal = v;
      bestRows = g;
    }
  }

  if (!bestKey || bestVal === null) return null;

  const n = bestRows.length;
  const metricLabel = semantic.measures[metricId]?.label ?? metricId;
  const metricText = formatMetricValue(semantic, metricId, bestVal);

  const displayKey =
    rec.displayKey === "first_ts_score" ? "first_ts_score" : rec.displayKey === "first_ts" ? "first_ts" : "group";

  const firstTs = (() => {
    const ts = bestRows.map(getRowTs).filter((x): x is number => typeof x === "number");
    return ts.length ? Math.min(...ts) : null;
  })();

  const keyText =
    displayKey === "first_ts" || displayKey === "first_ts_score"
      ? (firstTs !== null ? formatTs(firstTs) : bestKey)
      : bestKey;

  if (grain === "session" && metricId === "session_delta_rating") {
    const row = bestRows[0] as any;
    const start = typeof row?.sessionStartTs === "number" ? row.sessionStartTs : null;
    const end = typeof row?.sessionEndTs === "number" ? row.sessionEndTs : null;
    const rangeText = start !== null && end !== null ? `${formatTs(start)} -> ${formatTs(end)}` : keyText;
    return { keyText, valueText: `${metricText} (${rangeText})`, rows: bestRows, click: rec.actions?.click };
  }

  // Special-case a few legacy-style "Rounds" records so the value reads naturally.
  if (groupById === "game_id" && metricId === "rounds_count") {
    if (extreme === "max") {
      return { keyText, valueText: `${metricText} rounds (${keyText})`, rows: bestRows, click: rec.actions?.click };
    }
    // For "fewest rounds", show how many games share the minimum.
    const tied: any[] = [];
    let tieCount = 0;
    for (const [, g] of grouped.entries()) {
      if (!g || g.length === 0) continue;
      const v = fn(g);
      if (!Number.isFinite(v) || v !== bestVal) continue;
      tieCount++;
      tied.push(...g);
    }
    const rows = tied.length ? tied : bestRows;
    return {
      keyText,
      valueText: `${metricText} rounds (${tieCount} game(s))`,
      rows,
      click: rec.actions?.click
    };
  }

  if (groupById === "game_id" && metricId === "score_spread") {
    return { keyText, valueText: `${metricText} points (${keyText})`, rows: bestRows, click: rec.actions?.click };
  }

  if (displayKey === "first_ts_score") {
    // Try to include score context, matching the legacy-style tempo rows.
    let scoreText = "";
    const scoreMeasure = semantic.measures["avg_score"];
    const scoreFn = scoreMeasure ? MEASURES_BY_GRAIN[grain]?.[scoreMeasure.formulaId] : undefined;
    if (scoreFn) {
      const s = scoreFn(bestRows as any[]);
      if (Number.isFinite(s)) scoreText = ` (score ${Math.round(s)})`;
    }
    return { keyText, valueText: `${metricText} on ${keyText}${scoreText}`, rows: bestRows, click: rec.actions?.click };
  }

  const valueText =
    groupById === "time_day"
      ? // Match the legacy-style record hint for day records.
        `${keyText} (${metricLabel.toLowerCase().startsWith("avg ") ? `avg ${metricText}` : metricText}, n=${n})`
      : `${metricText} (${n} rounds, ${keyText})`;

  return { keyText, valueText, rows: bestRows, click: rec.actions?.click };
}

function buildStreak(
  semantic: SemanticRegistry,
  grain: Grain,
  rowsAll: any[],
  rec: RecordItemDef
): RecordResult | null {
  const clauses = Array.isArray(rec.streakFilters) ? rec.streakFilters : [];
  if (clauses.length === 0) return null;

  const sorted = [...rowsAll].sort((a, b) => (getRowTs(a) ?? 0) - (getRowTs(b) ?? 0));
  let cur = 0;
  let best = 0;
  let bestStart = -1;
  let bestEnd = -1;

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const ok = applyFilters([r], clauses, grain).length === 1;
    if (ok) {
      cur++;
      if (cur > best) {
        best = cur;
        bestStart = i - cur + 1;
        bestEnd = i;
      }
    } else {
      cur = 0;
    }
  }

  const bestRows = best > 0 && bestStart >= 0 && bestEnd >= bestStart ? sorted.slice(bestStart, bestEnd + 1) : [];
  const keyText = bestRows.length ? (() => {
    const ts = getRowTs(bestRows[0]);
    return ts !== null ? formatTs(ts) : "";
  })() : "";
  const valueText = best > 0 ? `${best} rounds in a row${keyText ? ` (${keyText})` : ""}` : "0";

  return { keyText, valueText, rows: bestRows, click: rec.actions?.click };
}

function buildSameValueStreak(
  semantic: SemanticRegistry,
  grain: Grain,
  rowsAll: any[],
  rec: RecordItemDef
): RecordResult | null {
  const dimId = typeof rec.dimension === "string" ? rec.dimension.trim() : "";
  if (!dimId) return null;
  const keyFn = DIMENSION_EXTRACTORS[grain]?.[dimId];
  if (!keyFn) return null;

  const sorted = [...rowsAll].sort((a, b) => (getRowTs(a) ?? 0) - (getRowTs(b) ?? 0));
  let best = 0;
  let bestStart = -1;
  let bestEnd = -1;
  let bestKey: string | null = null;

  let cur = 0;
  let curStart = 0;
  let prevKey: string | null = null;

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const k = keyFn(r);
    if (!k) {
      cur = 0;
      prevKey = null;
      continue;
    }
    if (prevKey !== null && k === prevKey) {
      cur++;
    } else {
      cur = 1;
      curStart = i;
      prevKey = k;
    }
    if (cur > best) {
      best = cur;
      bestStart = curStart;
      bestEnd = i;
      bestKey = k;
    }
  }

  const bestRows = best > 0 && bestStart >= 0 && bestEnd >= bestStart ? sorted.slice(bestStart, bestEnd + 1) : [];
  const ts = bestRows.length ? getRowTs(bestRows[0]) : null;
  const keyText = ts !== null ? formatTs(ts) : "";
  const valueText = best > 0 ? `${best} rounds in ${bestKey ?? ""}${keyText ? ` (${keyText})` : ""}`.trim() : "0";
  return { keyText, valueText, rows: bestRows, click: rec.actions?.click };
}

export async function renderRecordListWidget(
  semantic: SemanticRegistry,
  widget: WidgetDef,
  overlay: DrilldownOverlay,
  baseRows?: any[]
): Promise<HTMLElement> {
  const spec = widget.spec as RecordListSpec;
  const doc = overlay.getDocument();
  const grain = widget.grain as Grain;

  const wrap = doc.createElement("div");
  wrap.className = "ga-widget ga-recordlist";

  const title = doc.createElement("div");
  title.className = "ga-widget-title";
  title.textContent = widget.title;

  const box = doc.createElement("div");
  box.className = "ga-recordlist-box";

  const rowsAll =
    baseRows ?? (grain === "game" ? await getGames({}) : grain === "session" ? await getSessions({}) : await getRounds({}));

  for (const rec of spec.records) {
    const kind =
      rec.kind === "same_value_streak" ? "same_value_streak" : rec.kind === "streak" ? "streak" : "group_extreme";
    const result =
      kind === "streak"
        ? buildStreak(semantic, grain, rowsAll as any[], rec)
        : kind === "same_value_streak"
          ? buildSameValueStreak(semantic, grain, rowsAll as any[], rec)
          : buildGroupExtreme(semantic, grain, rowsAll as any[], rec);

    const line = doc.createElement("div");
    line.className = "ga-statrow";

    const left = doc.createElement("div");
    left.className = "ga-statrow-label";
    left.textContent = rec.label;

    const right = doc.createElement("div");
    right.className = "ga-statrow-value";
    right.textContent = result ? result.valueText : "-";

    line.appendChild(left);
    line.appendChild(right);
    box.appendChild(line);

    const click = result?.click;
    if (click?.type === "drilldown" && result) {
      line.style.cursor = "pointer";
      line.addEventListener("click", () => {
        const rowsFromPoint = click.filterFromPoint ? result.rows : (rowsAll as any[]);
        let sourceRows: any[] = rowsFromPoint as any[];
        let targetGrain: Grain = grain;
        if (grain === "session" && click.target === "rounds") {
          targetGrain = "round";
          const out: any[] = [];
          for (const s of sourceRows as any[]) {
            const rr = (s as any)?.rounds;
            if (Array.isArray(rr)) out.push(...rr);
          }
          sourceRows = out;
        }
        const filteredRows = applyFilters(sourceRows, click.extraFilters, targetGrain);
        overlay.open(semantic, {
          title: `${widget.title} - ${rec.label}`,
          target: click.target,
          columnsPreset: click.columnsPreset,
          rows: filteredRows,
          extraFilters: click.extraFilters
        });
      });
    }
  }

  wrap.appendChild(title);
  wrap.appendChild(box);
  return wrap;
}
