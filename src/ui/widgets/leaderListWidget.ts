import type { SemanticRegistry } from "../../config/semantic.types";
import type { WidgetDef, FilterClause, Actions, LeaderListRowDef } from "../../config/dashboard.types";
import type { Grain } from "../../config/semantic.types";
import { DIMENSION_EXTRACTORS } from "../../engine/dimensions";
import { applyFilters } from "../../engine/filters";
import { getRounds, getGames, getSessions } from "../../engine/queryEngine";
import { DrilldownOverlay } from "../drilldownOverlay";

function formatPct01(v: number): string {
  const clamped = Math.max(0, Math.min(1, v));
  return `${(clamped * 100).toFixed(1)}%`;
}

function getRowsAll(baseRows: any[] | undefined, grain: Grain): Promise<any[]> {
  if (Array.isArray(baseRows)) return Promise.resolve(baseRows);
  if (grain === "game") return getGames({});
  if (grain === "session") return getSessions({});
  return getRounds({});
}

function attachClickIfAny(args: {
  el: HTMLElement;
  actions: Actions | undefined;
  overlay: DrilldownOverlay;
  semantic: SemanticRegistry;
  title: string;
  grain: Grain;
  rows: any[];
}): void {
  const { el, actions, overlay, semantic, title, grain, rows } = args;
  const click = actions?.click;
  if (!click) return;

  el.style.cursor = "pointer";
  el.addEventListener("click", () => {
    if (click.type !== "drilldown") return;
    const filteredRows = applyFilters(rows, click.extraFilters, grain);
    overlay.open(semantic, {
      title,
      target: click.target,
      columnsPreset: click.columnsPreset,
      rows: filteredRows,
      extraFilters: click.extraFilters
    });
  });
}

function computeLeaderText(counts: Map<string, number>, exclude: Set<string>): string {
  const available = Array.from(counts.entries())
    .filter(([k]) => !exclude.has(k))
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));

  // Prefer "You" as the first competitor.
  const youKey = counts.has("You") ? "You" : (available[0]?.[0] ?? "You");
  const mateKey = available.find(([k]) => k !== youKey)?.[0] ?? "Mate";

  const youCount = counts.get(youKey) ?? 0;
  const mateCount = counts.get(mateKey) ?? 0;
  const decisive = youCount + mateCount;

  if (decisive === 0) return "Tie (-)";
  if (youCount === mateCount) return `Tie (${formatPct01(0.5)})`;
  const leader = youCount > mateCount ? youKey : mateKey;
  const share = Math.max(youCount, mateCount) / decisive;
  return `${leader} (${formatPct01(share)})`;
}

export async function renderLeaderListWidget(
  semantic: SemanticRegistry,
  widget: WidgetDef,
  overlay: DrilldownOverlay,
  baseRows?: any[]
): Promise<HTMLElement> {
  const doc = overlay.getDocument();
  const spec = widget.spec as { rows: LeaderListRowDef[] };
  const grain = widget.grain as Grain;

  const wrap = doc.createElement("div");
  wrap.className = "ga-widget ga-leaderlist";

  const title = doc.createElement("div");
  title.className = "ga-widget-title";
  title.textContent = widget.title;

  const box = doc.createElement("div");
  box.className = "ga-statlist-box";

  const rowsAll = await getRowsAll(baseRows, grain);

  for (const row of spec.rows) {
    const dimId = row.dimension;
    const keyFn = DIMENSION_EXTRACTORS[grain]?.[dimId];
    if (!keyFn) continue;

    const exclude = new Set((row.excludeKeys ?? []).map((k) => (typeof k === "string" ? k.trim() : "")).filter(Boolean));
    const scoped = applyFilters(rowsAll, row.filters as FilterClause[] | undefined, grain);

    const counts = new Map<string, number>();
    for (const r of scoped) {
      const k = keyFn(r);
      if (typeof k !== "string" || !k.trim()) continue;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }

    const line = doc.createElement("div");
    line.className = "ga-statrow";

    const left = doc.createElement("div");
    left.textContent = row.label;

    const right = doc.createElement("div");
    right.style.fontVariantNumeric = "tabular-nums";
    right.textContent = computeLeaderText(counts, exclude);

    line.appendChild(left);
    line.appendChild(right);

    attachClickIfAny({
      el: line,
      actions: row.actions,
      overlay,
      semantic,
      title: `${widget.title} - ${row.label}`,
      grain,
      rows: scoped
    });

    box.appendChild(line);
  }

  wrap.appendChild(title);
  wrap.appendChild(box);
  return wrap;
}
