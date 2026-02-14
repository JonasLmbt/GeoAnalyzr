import type { SemanticRegistry } from "../../config/semantic.types";
import type { WidgetDef, TeamSectionSpec } from "../../config/dashboard.types";
import type { Grain } from "../../config/semantic.types";
import { DrilldownOverlay } from "../drilldownOverlay";

function asFiniteNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function formatPct01(value: number): string {
  const clamped = Math.max(0, Math.min(1, value));
  return `${(clamped * 100).toFixed(1)}%`;
}

function formatShortDateTime(ts: number): string {
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const y = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${y} ${hh}:${mi}`;
}

function formatDurationHuman(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(clamped / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${totalSeconds % 60}s`;
  return `${totalSeconds}s`;
}

function getModeFamilyRaw(row: any): string {
  const raw = typeof row?.modeFamily === "string" ? row.modeFamily : typeof row?.mode_family === "string" ? row.mode_family : "";
  return raw.trim().toLowerCase();
}

function getTeammateName(row: any): string {
  const v = typeof row?.teammateName === "string" ? row.teammateName : typeof row?.teammate_name === "string" ? row.teammate_name : "";
  return v.trim();
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

function addRow(doc: Document, box: HTMLElement, label: string, value: string): void {
  const line = doc.createElement("div");
  line.className = "ga-statrow";

  const left = doc.createElement("div");
  left.className = "ga-statrow-label";
  left.textContent = label;

  const right = doc.createElement("div");
  right.className = "ga-statrow-value";
  right.textContent = value;

  line.appendChild(left);
  line.appendChild(right);
  box.appendChild(line);
}

export async function renderTeamSectionWidget(
  _semantic: SemanticRegistry,
  widget: WidgetDef,
  overlay: DrilldownOverlay,
  baseRows?: any[]
): Promise<HTMLElement> {
  const _spec = widget.spec as TeamSectionSpec;
  const doc = overlay.getDocument();

  const wrap = doc.createElement("div");
  wrap.className = "ga-widget ga-team-section";

  const grain = widget.grain as Grain;
  if (grain !== "round") {
    const ph = doc.createElement("div");
    ph.className = "ga-widget ga-placeholder";
    ph.textContent = "Team section requires round grain";
    return ph;
  }

  const all = Array.isArray(baseRows) ? baseRows : [];
  const rows = all.filter((r) => getModeFamilyRaw(r) === "teamduels");

  const mateName = rows.length ? getTeammateName(rows[0]) : "";
  const title = doc.createElement("div");
  title.className = "ga-widget-title";
  title.textContent = mateName ? `Team: You + ${mateName}` : "Team: You + (select a mate)";
  wrap.appendChild(title);

  if (!rows.length) {
    const empty = doc.createElement("div");
    empty.className = "ga-statlist-box";
    empty.textContent = "No Team Duel rounds for the selected teammate (in the current filters).";
    wrap.appendChild(empty);
    return wrap;
  }

  let myCloser = 0;
  let mateCloser = 0;
  let myScoreWins = 0;
  let mateScoreWins = 0;
  let myThrows = 0;
  let mateThrows = 0;
  let myFiveKs = 0;
  let mateFiveKs = 0;

  const gameIdSet = new Set<string>();
  const gameTsById = new Map<string, number>();

  let timedRounds = 0;
  let timePlayedMs = 0;

  for (const r of rows) {
    const gid = typeof r?.gameId === "string" ? r.gameId : "";
    if (gid) gameIdSet.add(gid);

    const ts = asFiniteNumber(r?.playedAt ?? r?.ts);
    if (gid && ts !== null) {
      const cur = gameTsById.get(gid);
      if (cur === undefined || ts < cur) gameTsById.set(gid, ts);
    }

    const selfDist = asFiniteNumber(r?.player_self_distanceKm ?? r?.distanceKm);
    const mateDist = asFiniteNumber(r?.player_mate_distanceKm);
    if (selfDist !== null && mateDist !== null) {
      if (selfDist < mateDist) myCloser++;
      else if (selfDist > mateDist) mateCloser++;
    }

    const selfScore = asFiniteNumber(r?.player_self_score ?? r?.score);
    const mateScore = asFiniteNumber(r?.player_mate_score);
    if (selfScore !== null && mateScore !== null) {
      if (selfScore > mateScore) myScoreWins++;
      else if (selfScore < mateScore) mateScoreWins++;
      if (selfScore < 50) myThrows++;
      if (mateScore < 50) mateThrows++;
      if (selfScore >= 5000) myFiveKs++;
      if (mateScore >= 5000) mateFiveKs++;
    }

    const durSec = asFiniteNumber(r?.durationSeconds ?? r?.guessDurationSec ?? r?.timeSec);
    if (durSec !== null && durSec >= 0) {
      timedRounds++;
      timePlayedMs += durSec * 1000;
    }
  }

  const decideLeader = (youValue: number, mateValue: number, neutralLabel = "Tie"): string => {
    const decisive = youValue + mateValue;
    if (decisive === 0) return `${neutralLabel} (-)`;
    if (youValue === mateValue) return `${neutralLabel} (50.0%)`;
    const youWin = youValue > mateValue;
    const leader = youWin ? "You" : (mateName || "Mate");
    const share = youWin ? youValue / decisive : mateValue / decisive;
    return `${leader} (${formatPct01(share)})`;
  };

  const h2h = mkBox(doc, "Head-to-head questions:");
  addRow(doc, h2h.box, "Closer guesses", decideLeader(myCloser, mateCloser));
  addRow(doc, h2h.box, "Higher score rounds", decideLeader(myScoreWins, mateScoreWins));
  addRow(doc, h2h.box, "Fewer throws (<50)", decideLeader(mateThrows, myThrows));
  addRow(doc, h2h.box, "More 5k rounds", decideLeader(myFiveKs, mateFiveKs));

  const games = Array.from(gameIdSet.values());
  const gameTimes = games
    .map((id) => ({ gameId: id, ts: gameTsById.get(id) }))
    .filter((x): x is { gameId: string; ts: number } => typeof x.ts === "number" && Number.isFinite(x.ts))
    .sort((a, b) => a.ts - b.ts);

  const firstTogether = gameTimes[0]?.ts;
  const lastTogether = gameTimes.length ? gameTimes[gameTimes.length - 1].ts : undefined;

  const sessionGapMs = 45 * 60 * 1000;
  let sessionCount = 0;
  let sessionTotalGames = 0;
  let longestSessionGames = 0;
  let longestSessionStart: number | undefined;
  let longestSessionEnd: number | undefined;
  let longestBreakMs: number | undefined;

  if (gameTimes.length > 0) {
    sessionCount = 1;
    let curStart = gameTimes[0].ts;
    let curGames = 1;
    let prevTs = gameTimes[0].ts;

    for (let i = 1; i < gameTimes.length; i++) {
      const ts = gameTimes[i].ts;
      const gap = ts - prevTs;
      if (Number.isFinite(gap) && gap > 0) {
        if (longestBreakMs === undefined || gap > longestBreakMs) longestBreakMs = gap;
      }

      if (gap > sessionGapMs) {
        sessionTotalGames += curGames;
        if (curGames > longestSessionGames) {
          longestSessionGames = curGames;
          longestSessionStart = curStart;
          longestSessionEnd = prevTs;
        }
        sessionCount++;
        curStart = ts;
        curGames = 1;
      } else {
        curGames++;
      }
      prevTs = ts;
    }

    sessionTotalGames += curGames;
    if (curGames > longestSessionGames) {
      longestSessionGames = curGames;
      longestSessionStart = curStart;
      longestSessionEnd = prevTs;
    }
  }

  const avgGamesPerSession = sessionCount ? sessionTotalGames / sessionCount : undefined;

  const facts = mkBox(doc, "Team facts:");
  addRow(doc, facts.box, "Games together", String(games.length));
  addRow(doc, facts.box, "Rounds together", String(rows.length));
  addRow(
    doc,
    facts.box,
    "Time played together",
    timedRounds > 0
      ? `${formatDurationHuman(timePlayedMs)}${
          timedRounds > 0 && timedRounds < rows.length ? ` (from ${timedRounds}/${rows.length} rounds with time data)` : ""
        }`
      : "-"
  );
  addRow(doc, facts.box, "First game together", typeof firstTogether === "number" ? formatShortDateTime(firstTogether) : "-");
  addRow(doc, facts.box, "Most recent game together", typeof lastTogether === "number" ? formatShortDateTime(lastTogether) : "-");
  addRow(
    doc,
    facts.box,
    "Longest session together",
    longestSessionGames > 0 && longestSessionStart !== undefined && longestSessionEnd !== undefined
      ? `${longestSessionGames} games (${formatShortDateTime(longestSessionStart)} -> ${formatShortDateTime(longestSessionEnd)})`
      : "-"
  );
  addRow(doc, facts.box, "Avg games per session together", typeof avgGamesPerSession === "number" ? avgGamesPerSession.toFixed(1) : "-");
  addRow(doc, facts.box, "Longest break between games together", typeof longestBreakMs === "number" ? formatDurationHuman(longestBreakMs) : "-");

  const grid = doc.createElement("div");
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = "repeat(12, minmax(0, 1fr))";
  grid.style.gap = "10px";

  const left = doc.createElement("div");
  left.style.gridColumn = "1 / span 12";
  left.appendChild(h2h.wrap);

  const right = doc.createElement("div");
  right.style.gridColumn = "1 / span 12";
  right.appendChild(facts.wrap);

  grid.appendChild(left);
  grid.appendChild(right);
  wrap.appendChild(grid);

  return wrap;
}

