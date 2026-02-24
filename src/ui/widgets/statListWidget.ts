import type { SemanticRegistry } from "../../config/semantic.types";
import type { WidgetDef, StatListSpec, Actions, FilterClause } from "../../config/dashboard.types";
import type { Grain } from "../../config/semantic.types";
import { getRounds, getGames, getSessions } from "../../engine/queryEngine";
import { MEASURES_BY_GRAIN } from "../../engine/measures";
import { applyFilters } from "../../engine/filters";
import { DrilldownOverlay } from "../drilldownOverlay";
import { DIMENSION_EXTRACTORS } from "../../engine/dimensions";

function readDateFormatMode(doc: Document): "dd/mm/yyyy" | "mm/dd/yyyy" | "yyyy-mm-dd" | "locale" {
  const root = doc.querySelector(".ga-root") as HTMLElement | null;
  const mode = root?.dataset?.gaDateFormat;
  return mode === "mm/dd/yyyy" || mode === "yyyy-mm-dd" || mode === "locale" ? mode : "dd/mm/yyyy";
}

function formatDateTime(doc: Document, ts: number): string {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return String(ts);
  const mode = readDateFormatMode(doc);
  if (mode === "locale") return d.toLocaleString();

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");

  if (mode === "yyyy-mm-dd") return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
  if (mode === "mm/dd/yyyy") return `${m}/${day}/${y} ${hh}:${mm}:${ss}`;
  return `${day}/${m}/${y} ${hh}:${mm}:${ss}`;
}

function formatValue(doc: Document, semantic: SemanticRegistry, measureId: string, value: number): string {
  const m = semantic.measures[measureId];
  const unit = semantic.units[m.unit];

  if (!unit) return String(value);

  if (unit.format === "datetime") return formatDateTime(doc, value);
  if (unit.format === "percent") {
    const decimals = unit.decimals ?? 1;
    const clamped = Math.max(0, Math.min(1, value));
    return `${(clamped * 100).toFixed(decimals)}%`;
  }
  if (unit.format === "duration") {
    const s = Math.max(0, Math.round(value));
    const days = Math.floor(s / 86400);
    const hours = Math.floor((s % 86400) / 3600);
    const mins = Math.floor((s % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    if (mins > 0) return `${mins}m ${s % 60}s`;
    return `${(Math.max(0, value)).toFixed(1)}s`;
  }
  if (unit.format === "int") {
    const v = Math.round(value);
    return unit.showSign && v > 0 ? `+${v}` : String(v);
  }
  const decimals = unit.decimals ?? 1;
  const txt = value.toFixed(decimals);
  const base = unit.showSign && value > 0 ? `+${txt}` : txt;
  const suffix = (() => {
    const u = String(m.unit ?? "").trim().toLowerCase();
    if (u === "km") return " km";
    if (u === "seconds") return " s";
    return "";
  })();
  return `${base}${suffix}`;
}

async function computeMeasure(
  semantic: SemanticRegistry,
  measureId: string,
  baseRows: any[] | undefined,
  grain: Grain,
  filters?: FilterClause[]
): Promise<number> {
  const m = semantic.measures[measureId];
  if (!m) return 0;

  const rowsAll =
    baseRows ?? (grain === "game" ? await getGames({}) : grain === "session" ? await getSessions({}) : await getRounds({}));
  const rows = applyFilters(rowsAll, filters, grain);
  const fn = MEASURES_BY_GRAIN[grain]?.[m.formulaId];
  if (!fn) throw new Error(`Missing measure implementation for formulaId=${m.formulaId}`);
  return fn(rows);
}

function attachClickIfAny(
  el: HTMLElement,
  actions: Actions | undefined,
  overlay: DrilldownOverlay,
  semantic: SemanticRegistry,
  title: string,
  baseRows: any[] | undefined,
  grain: Grain,
  filters?: FilterClause[],
  measureId?: string
): void {
  const clickBase = actions?.click;
  const click = clickBase && clickBase.type === "drilldown"
    ? ({
        ...clickBase,
        filterFromPoint: clickBase.filterFromPoint ?? semantic.measures[measureId ?? ""]?.drilldown?.filterFromPoint,
        extraFilters: [
          ...(semantic.measures[measureId ?? ""]?.drilldown?.extraFilters ?? []),
          ...(clickBase.extraFilters ?? [])
        ]
      } as any)
    : clickBase;
  if (!click) return;

  el.style.cursor = "pointer";
  el.addEventListener("click", async () => {
    if (click.type === "drilldown") {
      const rowsAll =
        baseRows ?? (grain === "game" ? await getGames({}) : grain === "session" ? await getSessions({}) : await getRounds({}));
      const mergedFilters = [...(filters ?? []), ...(click.extraFilters ?? [])];
      let rows = applyFilters(rowsAll, mergedFilters, grain);

      // Special handling for certain measures so drilldowns match user intent.
      const meas = measureId ? semantic.measures[measureId] : undefined;
      const formulaId = meas?.formulaId ?? "";
      if (grain === "game" && formulaId === "max_player_self_end_rating") {
        // Mirror `ratingModeForRows()` + getters from `src/engine/measures.ts`.
        const mode: "duel" | "team" = (() => {
          for (const g of rows as any[]) {
            if (String((g as any)?.modeFamily ?? "").trim().toLowerCase() === "duels") return "duel";
          }
          return "team";
        })();
        const getNum = (v: any): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
        const endRatingOf = (g: any): number | null => {
          if (mode === "duel") {
            return (
              getNum((g as any).player_self_endRating) ??
              getNum((g as any).playerOneEndRating) ??
              getNum((g as any).player_self_end_rating) ??
              null
            );
          }
          return (
            getNum((g as any).teamOneEndRating) ??
            getNum((g as any).player_self_endRating) ??
            getNum((g as any).player_self_end_rating) ??
            null
          );
        };
        let best = -Infinity;
        for (const g of rows) {
          const v = endRatingOf(g);
          if (typeof v === "number") best = Math.max(best, v);
        }
        if (Number.isFinite(best)) {
          const candidates = rows.filter((g) => endRatingOf(g) === best);
          // If multiple games share the same max, pick the most recent one.
          const tsOf = (g: any): number => (typeof (g as any).ts === "number" ? (g as any).ts : typeof (g as any).playedAt === "number" ? (g as any).playedAt : 0);
          const bestOne = candidates.sort((a, b) => tsOf(b) - tsOf(a))[0];
          rows = bestOne ? [bestOne] : candidates;
        }
      }
      if (grain === "game" && (formulaId === "max_win_streak" || formulaId === "max_loss_streak")) {
        const want = formulaId === "max_win_streak" ? "Win" : "Loss";
        const outcomeKey = DIMENSION_EXTRACTORS.game?.result;
        const tsOf = (g: any): number => (typeof (g as any).ts === "number" ? (g as any).ts : typeof (g as any).playedAt === "number" ? (g as any).playedAt : 0);
        // Streaks must be computed on the full timeline (not a pre-filtered Win/Loss subset).
        const mergedFiltersForStreak = mergedFilters.filter((c) => c?.dimension !== "result");
        const rowsForStreak = applyFilters(rowsAll, mergedFiltersForStreak, grain);
        const sorted = [...rowsForStreak].sort((a, b) => tsOf(a) - tsOf(b));
        let bestLen = 0;
        let bestEnd = -1;
        let cur = 0;
        for (let i = 0; i < sorted.length; i++) {
          const o = outcomeKey ? outcomeKey(sorted[i]) : (sorted[i] as any)?.result;
          if (!o) continue;
          if (o === want) {
            cur++;
            if (cur > bestLen) {
              bestLen = cur;
              bestEnd = i;
            }
          } else {
            cur = 0;
          }
        }
        if (bestLen > 0 && bestEnd >= 0) {
          rows = sorted.slice(bestEnd - bestLen + 1, bestEnd + 1);
        }
      }
      if (grain === "game" && (formulaId === "max_opponent_start_rating" || formulaId === "max_defeated_opponent_start_rating")) {
        const filtered = formulaId === "max_defeated_opponent_start_rating" ? rows.filter((g) => (DIMENSION_EXTRACTORS.game?.result?.(g) ?? (g as any).result) === "Win") : rows;
        const opponentStartOf = (g: any): number | null => {
          const mode = String(g?.modeFamily ?? "").trim().toLowerCase();
          const nums: number[] = [];
          const pushNum = (v: any) => {
            if (typeof v === "number" && Number.isFinite(v)) nums.push(v);
          };
          if (mode === "teamduels") {
            pushNum(g.player_opponent_startRating);
            pushNum(g.player_opponent_mate_startRating);
          } else {
            pushNum(g.player_opponent_startRating);
            pushNum(g.playerTwoStartRating);
          }
          if (!nums.length) return null;
          return Math.max(...nums);
        };
        let best = -Infinity;
        for (const g of filtered) {
          const v = opponentStartOf(g);
          if (typeof v === "number") best = Math.max(best, v);
        }
        if (Number.isFinite(best)) {
          const candidates = filtered.filter((g) => opponentStartOf(g) === best);
          const tsOf = (g: any): number => (typeof (g as any).ts === "number" ? (g as any).ts : typeof (g as any).playedAt === "number" ? (g as any).playedAt : 0);
          const bestOne = candidates.sort((a, b) => tsOf(b) - tsOf(a))[0];
          rows = bestOne ? [bestOne] : candidates;
        } else {
          rows = [];
        }
      }

      if (grain === "game" && (formulaId === "max_player_self_rating_delta" || formulaId === "min_player_self_rating_delta")) {
        const getNum = (v: any): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
        const isTeam = (g: any): boolean => {
          const mf = String(g?.modeFamily ?? g?.mode_family ?? "").trim().toLowerCase();
          return g?.isTeamDuels === true || mf === "teamduels" || (mf.includes("team") && mf.includes("duel"));
        };
        const startRatingOf = (g: any): number | null => {
          if (isTeam(g)) return getNum(g.teamOneStartRating) ?? getNum(g.player_self_startRating) ?? getNum(g.playerOneStartRating) ?? null;
          return getNum(g.player_self_startRating) ?? getNum(g.playerOneStartRating) ?? null;
        };
        const endRatingOf = (g: any): number | null => {
          if (isTeam(g)) return getNum(g.teamOneEndRating) ?? getNum(g.player_self_endRating) ?? getNum(g.playerOneEndRating) ?? null;
          return getNum(g.player_self_endRating) ?? getNum(g.playerOneEndRating) ?? null;
        };
        const deltaOf = (g: any): number | null => {
          const end = endRatingOf(g);
          const start = startRatingOf(g) ?? end;
          if (end === null || start === null) return null;
          if (end === 0 || start === 0) return null;
          return end - start;
        };

        let best = formulaId === "min_player_self_rating_delta" ? Infinity : -Infinity;
        for (const g of rows as any[]) {
          const d = deltaOf(g);
          if (typeof d !== "number" || !Number.isFinite(d)) continue;
          best = formulaId === "min_player_self_rating_delta" ? Math.min(best, d) : Math.max(best, d);
        }
        if (Number.isFinite(best)) {
          const candidates = rows.filter((g) => deltaOf(g) === best);
          const tsOf = (g: any): number => (typeof (g as any).ts === "number" ? (g as any).ts : typeof (g as any).playedAt === "number" ? (g as any).playedAt : 0);
          const bestOne = candidates.sort((a, b) => tsOf(b) - tsOf(a))[0];
          rows = bestOne ? [bestOne] : candidates;
        } else {
          rows = [];
        }
      }
      overlay.open(semantic, {
        title,
        target: click.target,
        columnsPreset: click.columnsPreset,
        rows,
        extraFilters: click.extraFilters,
        initialSort: (click as any).initialSort
      });
    }
  });
}

export async function renderStatListWidget(
  semantic: SemanticRegistry,
  widget: WidgetDef,
  overlay: DrilldownOverlay,
  datasets: Partial<Record<Grain, any[]>> | undefined,
  baseRows?: any[]
): Promise<HTMLElement> {
  const spec = widget.spec as StatListSpec;
  const doc = overlay.getDocument();
  const widgetGrain = widget.grain as Grain;

  const wrap = doc.createElement("div");
  wrap.className = "ga-widget ga-statlist";

  const title = doc.createElement("div");
  title.className = "ga-widget-title";
  title.textContent = widget.title;

  const box = doc.createElement("div");
  box.className = "ga-statlist-box";

  for (const row of spec.rows) {
    const rowGrain = (row as any).grain ? ((row as any).grain as Grain) : widgetGrain;
    // `baseRows` is pre-filtered for the widget grain.
    // If a row overrides grain, try to use the pre-filtered dataset for that grain,
    // otherwise fall back to fetching unfiltered rows inside `computeMeasure()`.
    const rowBaseRows = rowGrain === widgetGrain ? baseRows : datasets?.[rowGrain];
    const line = doc.createElement("div");
    line.className = "ga-statrow";

    const left = doc.createElement("div");
    left.className = "ga-statrow-label";
    left.textContent = row.label;

    const right = doc.createElement("div");
    right.className = "ga-statrow-value";
    right.textContent = "...";

    const val = await computeMeasure(semantic, row.measure, rowBaseRows, rowGrain, row.filters);
    const primaryText = formatValue(doc, semantic, row.measure, val);

    const secondaryId = typeof (row as any).secondaryMeasure === "string" ? ((row as any).secondaryMeasure as string).trim() : "";
    if (secondaryId) {
      const secVal = await computeMeasure(semantic, secondaryId, rowBaseRows, rowGrain, row.filters);
      const secondaryText = formatValue(doc, semantic, secondaryId, secVal);
      right.textContent = `${primaryText} (${secondaryText})`;
    } else {
      right.textContent = primaryText;
    }

    attachClickIfAny(line, row.actions, overlay, semantic, `${row.label} - Drilldown`, rowBaseRows, rowGrain, row.filters, row.measure);

    line.appendChild(left);
    line.appendChild(right);
    box.appendChild(line);
  }

  wrap.appendChild(title);
  wrap.appendChild(box);
  return wrap;
}
