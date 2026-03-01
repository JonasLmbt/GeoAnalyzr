import type { SemanticRegistry } from "../../config/semantic.types";
import type { WidgetDef, RecordListSpec, RecordItemDef, Actions } from "../../config/dashboard.types";
import type { Grain } from "../../config/semantic.types";
import { getRounds, getGames, getSessions } from "../../engine/queryEngine";
import { DIMENSION_EXTRACTORS } from "../../engine/dimensions";
import { groupByKey } from "../../engine/aggregate";
import { MEASURES_BY_GRAIN } from "../../engine/measures";
import { applyFilters } from "../../engine/filters";
import { DrilldownOverlay } from "../drilldownOverlay";
import { pickWithAliases } from "../../engine/fieldAccess";

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
  const base = unit.showSign && value > 0 ? `+${txt}` : txt;
  const suffix = (() => {
    const u = String(m?.unit ?? "").trim().toLowerCase();
    if (u === "km") return " km";
    if (u === "seconds") return " s";
    return "";
  })();
  return `${base}${suffix}`;
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

function getScore(row: any, semantic: SemanticRegistry): number | null {
  const v = pickWithAliases(row, "player_self_score", semantic.columnAliases);
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

function getTrustedGuessDurationSeconds(row: any, semantic: SemanticRegistry): number | null {
  const raw = pickWithAliases(row, "durationSeconds", semantic.columnAliases);
  const dur = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;

  const start = row?.startTime ?? row?.roundStartTime ?? null;
  const end = row?.endTime ?? row?.roundEndTime ?? null;
  const startNum = typeof start === "number" && Number.isFinite(start) ? start : null;
  const endNum = typeof end === "number" && Number.isFinite(end) ? end : null;

  const derived = startNum !== null && endNum !== null && endNum > startNum ? (endNum - startNum) / 1000 : null;
  const derivedOk = derived !== null && Number.isFinite(derived) && derived > 0 && derived < 60 * 30 ? derived : null;

  if (derivedOk !== null) {
    if (dur !== null && Math.abs(dur - derivedOk) > 6) return derivedOk;
    return dur ?? derivedOk;
  }

  return dur;
}

function buildOverall(
  semantic: SemanticRegistry,
  grain: Grain,
  rowsAll: any[],
  rec: RecordItemDef
): RecordResult | null {
  const metricId = typeof rec.metric === "string" ? rec.metric.trim() : "";
  if (!metricId) return null;

  const metric = semantic.measures[metricId];
  if (!metric) return null;
  const fn = MEASURES_BY_GRAIN[grain]?.[metric.formulaId];
  if (!fn) return null;

  const inputRows = Array.isArray(rec.filters) && rec.filters.length ? applyFilters(rowsAll, rec.filters, grain) : rowsAll;
  const v = fn(inputRows as any[]);
  if (!Number.isFinite(v)) return null;

  return {
    keyText: "",
    valueText: formatMetricValue(semantic, metricId, v),
    rows: inputRows,
    click: rec.actions?.click
  };
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
    // Data quality guardrails for a few problematic record metrics.
    // Record ranking should not consider groups where the underlying data is missing/obviously broken.
    if (grain === "round" && metricId === "avg_score") {
      const total = g.length;
      let valid = 0;
      for (const r of g) if (getScore(r, semantic) !== null) valid++;
      if (valid === 0) continue;
      if (groupById === "game_id" && valid !== total) continue; // require complete game score coverage
      if (groupById === "time_day" && valid / Math.max(1, total) < 0.5) continue;
    }
    if (grain === "round" && metricId === "avg_guess_duration") {
      const total = g.length;
      let valid = 0;
      for (const r of g) if (getTrustedGuessDurationSeconds(r, semantic) !== null) valid++;
      if (valid === 0) continue;
      if (valid / Math.max(1, total) < 0.5) continue;
    }

    const v = (() => {
      if (grain === "round" && metricId === "avg_score") {
        let sum = 0;
        let n = 0;
        for (const r of g as any[]) {
          const s = getScore(r, semantic);
          if (s === null) continue;
          sum += s;
          n++;
        }
        return n ? sum / n : NaN;
      }
      if (grain === "round" && metricId === "avg_guess_duration") {
        let sum = 0;
        let n = 0;
        for (const r of g as any[]) {
          const s = getTrustedGuessDurationSeconds(r, semantic);
          if (s === null) continue;
          sum += s;
          n++;
        }
        return n ? sum / n : NaN;
      }
      return fn(g);
    })();
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

  const metricText = formatMetricValue(semantic, metricId, bestVal);

  const displayKey =
    rec.displayKey === "none"
      ? "none"
      : rec.displayKey === "first_ts_score"
        ? "first_ts_score"
        : rec.displayKey === "first_ts"
          ? "first_ts"
          : "group";

  const firstTs = (() => {
    const ts = bestRows.map(getRowTs).filter((x): x is number => typeof x === "number");
    return ts.length ? Math.min(...ts) : null;
  })();

  const keyText =
    displayKey === "none"
      ? ""
      : displayKey === "first_ts" || displayKey === "first_ts_score"
      ? (firstTs !== null ? formatTs(firstTs) : bestKey)
      : bestKey;

  let tieCount = 0;
  for (const [, g] of grouped.entries()) {
    if (!g || g.length === 0) continue;
    const v = (() => {
      if (grain === "round" && metricId === "avg_score") {
        let sum = 0;
        let n = 0;
        for (const r of g as any[]) {
          const s = getScore(r, semantic);
          if (s === null) continue;
          sum += s;
          n++;
        }
        return n ? sum / n : NaN;
      }
      if (grain === "round" && metricId === "avg_guess_duration") {
        let sum = 0;
        let n = 0;
        for (const r of g as any[]) {
          const s = getTrustedGuessDurationSeconds(r, semantic);
          if (s === null) continue;
          sum += s;
          n++;
        }
        return n ? sum / n : NaN;
      }
      return fn(g);
    })();
    if (!Number.isFinite(v)) continue;
    if (v === bestVal) tieCount++;
  }
  const tieSuffix = tieCount > 1 ? ` (${tieCount}x)` : "";

  if (grain === "session" && metricId === "session_delta_rating") {
    // Keep it compact; drilldown can show exact dates per game if needed.
    return { keyText: "", valueText: metricText, rows: bestRows, click: rec.actions?.click };
  }

  // Special-case a few legacy-style "Rounds" records so the value reads naturally.
  if (groupById === "game_id" && metricId === "rounds_count") {
    if (extreme === "max") {
      return { keyText, valueText: `${metricText} rounds (${keyText})${tieSuffix}`, rows: bestRows, click: rec.actions?.click };
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
      valueText: `${metricText} rounds${tieCount > 1 ? ` (${tieCount}x)` : ""}`,
      rows,
      click: rec.actions?.click
    };
  }

  if (groupById === "game_id" && metricId === "score_spread") {
    return { keyText, valueText: `${metricText} points (${keyText})${tieSuffix}`, rows: bestRows, click: rec.actions?.click };
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
    return { keyText, valueText: `${metricText} on ${keyText}${scoreText}${tieSuffix}`, rows: bestRows, click: rec.actions?.click };
  }

  const valueText = `${metricText}${tieSuffix}`;

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
      rec.kind === "overall"
        ? "overall"
        : rec.kind === "same_value_streak"
          ? "same_value_streak"
          : rec.kind === "streak"
            ? "streak"
            : "group_extreme";
    const result =
      kind === "overall"
        ? buildOverall(semantic, grain, rowsAll as any[], rec)
        : kind === "streak"
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
      line.addEventListener("click", async () => {
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
        if (grain === "session" && click.target === "games") {
          targetGrain = "game";
          const ids = new Set<string>();
          for (const s of sourceRows as any[]) {
            const gIds = (s as any)?.gameIds;
            if (!Array.isArray(gIds)) continue;
            for (const id of gIds) if (typeof id === "string" && id) ids.add(id);
          }
          const allGames = await getGames({});
          sourceRows = allGames.filter((g: any) => typeof g?.gameId === "string" && ids.has(g.gameId));
        }
        const filteredRows = applyFilters(sourceRows, click.extraFilters, targetGrain);
        overlay.open(semantic, {
          title: `${widget.title} - ${rec.label}${result.keyText ? ` (${result.keyText})` : ""}`,
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
