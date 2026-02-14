import type { SemanticRegistry } from "../../config/semantic.types";
import type { WidgetDef, TeamSectionSpec } from "../../config/dashboard.types";
import type { Grain } from "../../config/semantic.types";
import { getRounds } from "../../engine/queryEngine";
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

function addRow(
  doc: Document,
  box: HTMLElement,
  label: string,
  value: string,
  opts?: { drill?: { title: string; rows: any[] } }
): void {
  const line = doc.createElement("div");
  line.className = "ga-statrow";

  const left = doc.createElement("div");
  left.className = "ga-statrow-label";
  left.textContent = label;

  const right = doc.createElement("div");
  right.className = "ga-statrow-value";
  right.textContent = value;

  const drill = opts?.drill;
  if (drill && Array.isArray(drill.rows) && drill.rows.length > 0) {
    line.style.cursor = "pointer";
    right.style.textDecoration = "underline";
    right.style.textDecorationThickness = "1px";
    right.style.textUnderlineOffset = "2px";
    line.addEventListener("click", () => {
      (opts as any)._overlay?.open?.((opts as any)._semantic, {
        title: drill.title,
        target: "rounds",
        columnsPreset: "roundMode",
        rows: drill.rows
      });
    });
  }

  line.appendChild(left);
  line.appendChild(right);
  box.appendChild(line);
}

export async function renderTeamSectionWidget(
  semantic: SemanticRegistry,
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

  const storageKey = "geoanalyzr:semantic:team:mate";
  const ls = doc.defaultView?.localStorage;

  const globalAll = Array.isArray(baseRows) ? baseRows : [];
  const globalTeamRounds = globalAll.filter((r) => getModeFamilyRaw(r) === "teamduels");

  // Build mate options from the whole DB (ignores current date-range), so a mate is always selectable.
  const roundsAll = await getRounds({});
  const allTeamDuels = (roundsAll as any[]).filter((r) => getModeFamilyRaw(r) === "teamduels");
  const gamesByMate = new Map<string, Set<string>>();
  const roundsByMate = new Map<string, number>();
  for (const r of allTeamDuels) {
    const name = getTeammateName(r);
    if (!name) continue;
    const gid = typeof r?.gameId === "string" ? r.gameId : "";
    if (!gid) continue;
    const set = gamesByMate.get(name) ?? new Set<string>();
    set.add(gid);
    gamesByMate.set(name, set);
    roundsByMate.set(name, (roundsByMate.get(name) ?? 0) + 1);
  }
  const mateOptions = Array.from(gamesByMate.entries())
    .map(([name, games]) => ({ value: name, games: games.size, rounds: roundsByMate.get(name) ?? 0 }))
    .sort((a, b) => (b.games - a.games) || a.value.localeCompare(b.value))
    .map((x) => ({ value: x.value, label: `${x.value} (${x.games} games, ${x.rounds} rounds)` }));

  const title = doc.createElement("div");
  title.className = "ga-widget-title";
  title.textContent = "Team Duels";
  wrap.appendChild(title);

  if (mateOptions.length === 0) {
    const empty = doc.createElement("div");
    empty.className = "ga-statlist-box";
    empty.textContent = "No Team Duel data found.";
    wrap.appendChild(empty);
    return wrap;
  }

  let selectedMate = typeof ls?.getItem(storageKey) === "string" ? String(ls?.getItem(storageKey) ?? "").trim() : "";
  const values = new Set(mateOptions.map((o) => o.value));
  if (!selectedMate || !values.has(selectedMate)) selectedMate = mateOptions[0].value;
  ls?.setItem(storageKey, selectedMate);

  const localFilters = doc.createElement("div");
  localFilters.className = "ga-team-local-filters";

  const mateFilter = doc.createElement("div");
  mateFilter.className = "ga-filter";

  const mateLabel = doc.createElement("div");
  mateLabel.className = "ga-filter-label";
  mateLabel.textContent = "Mate";

  const mateRow = doc.createElement("div");
  mateRow.className = "ga-filter-row";

  const sel = doc.createElement("select");
  sel.className = "ga-filter-select";
  for (const opt of mateOptions) sel.appendChild(new Option(opt.label, opt.value));
  sel.value = selectedMate;
  sel.addEventListener("change", () => {
    const next = sel.value;
    if (!next || next === selectedMate) return;
    selectedMate = next;
    ls?.setItem(storageKey, selectedMate);
    renderForMate();
  });

  mateRow.appendChild(sel);
  mateFilter.appendChild(mateLabel);
  mateFilter.appendChild(mateRow);
  localFilters.appendChild(mateFilter);
  wrap.appendChild(localFilters);

  const host = doc.createElement("div");
  wrap.appendChild(host);

  const openRoundsDrill = (drillTitle: string, rows: any[]) => {
    overlay.open(semantic, { title: drillTitle, target: "rounds", columnsPreset: "roundMode", rows });
  };

  const addRowWithDrill = (box: HTMLElement, label: string, value: string, drillTitle: string, drillRows: any[]) => {
    const line = doc.createElement("div");
    line.className = "ga-statrow";

    const left = doc.createElement("div");
    left.className = "ga-statrow-label";
    left.textContent = label;

    const right = doc.createElement("div");
    right.className = "ga-statrow-value";
    right.textContent = value;

    if (Array.isArray(drillRows) && drillRows.length > 0) {
      line.style.cursor = "pointer";
      right.style.textDecoration = "underline";
      right.style.textDecorationThickness = "1px";
      right.style.textUnderlineOffset = "2px";
      line.addEventListener("click", () => openRoundsDrill(drillTitle, drillRows));
    }

    line.appendChild(left);
    line.appendChild(right);
    box.appendChild(line);
  };

  const renderForMate = () => {
    host.innerHTML = "";

    const compareRounds = globalTeamRounds.filter((r) => getTeammateName(r) === selectedMate);

    const header = doc.createElement("div");
    header.className = "ga-widget-title";
    header.textContent = `Team: You + ${selectedMate}`;
    host.appendChild(header);

    if (compareRounds.length === 0) {
      const empty = doc.createElement("div");
      empty.className = "ga-statlist-box";
      empty.textContent = "No Team Duel rounds for this mate in the current global filters.";
      host.appendChild(empty);
      return;
    }

    let myCloser = 0;
    let mateCloser = 0;
    let myScoreWins = 0;
    let mateScoreWins = 0;
    let myThrows = 0;
    let mateThrows = 0;
    let myFiveKs = 0;
    let mateFiveKs = 0;

    const closerDrill: any[] = [];
    const higherScoreDrill: any[] = [];
    const fewerThrowsDrill: any[] = [];
    const moreFiveKDrill: any[] = [];

    const byGame = new Map<string, any[]>();
    const gameTsById = new Map<string, number>();

    let timedRounds = 0;
    let timePlayedMs = 0;
    const timedRoundsDrill: any[] = [];

    for (const r of compareRounds) {
      const gid = typeof r?.gameId === "string" ? r.gameId : "";
      if (gid) {
        const arr = byGame.get(gid) ?? [];
        arr.push(r);
        byGame.set(gid, arr);
      }

      const ts = asFiniteNumber(r?.playedAt ?? r?.ts);
      if (gid && ts !== null) {
        const cur = gameTsById.get(gid);
        if (cur === undefined || ts < cur) gameTsById.set(gid, ts);
      }

      const selfDist = asFiniteNumber(r?.player_self_distanceKm ?? r?.distanceKm);
      const mateDist = asFiniteNumber(r?.player_mate_distanceKm);
      if (selfDist !== null && mateDist !== null) {
        closerDrill.push(r);
        if (selfDist < mateDist) myCloser++;
        else if (selfDist > mateDist) mateCloser++;
      }

      const selfScore = asFiniteNumber(r?.player_self_score ?? r?.score);
      const mateScore = asFiniteNumber(r?.player_mate_score);
      if (selfScore !== null && mateScore !== null) {
        higherScoreDrill.push(r);
        if (selfScore > mateScore) myScoreWins++;
        else if (selfScore < mateScore) mateScoreWins++;
        if (selfScore < 50) myThrows++;
        if (mateScore < 50) mateThrows++;
        if (selfScore < 50 || mateScore < 50) fewerThrowsDrill.push(r);
        if (selfScore >= 5000) myFiveKs++;
        if (mateScore >= 5000) mateFiveKs++;
        if (selfScore >= 5000 || mateScore >= 5000) moreFiveKDrill.push(r);
      }

      const durSec = asFiniteNumber(r?.durationSeconds ?? r?.guessDurationSec ?? r?.timeSec);
      if (durSec !== null && durSec >= 0) {
        timedRounds++;
        timePlayedMs += durSec * 1000;
        timedRoundsDrill.push(r);
      }
    }

    const decideLeader = (youValue: number, mateValue: number, neutralLabel = "Tie"): string => {
      const decisive = youValue + mateValue;
      if (decisive === 0) return `${neutralLabel} (-)`;
      if (youValue === mateValue) return `${neutralLabel} (50.0%)`;
      const youWin = youValue > mateValue;
      const leader = youWin ? "You" : (selectedMate || "Mate");
      const share = youWin ? youValue / decisive : mateValue / decisive;
      return `${leader} (${formatPct01(share)})`;
    };

    const games = Array.from(byGame.keys());
    const gameTimes = games
      .map((id) => ({ gameId: id, ts: gameTsById.get(id) }))
      .filter((x): x is { gameId: string; ts: number } => typeof x.ts === "number" && Number.isFinite(x.ts))
      .sort((a, b) => a.ts - b.ts);

    const firstGameId = gameTimes[0]?.gameId;
    const lastGameId = gameTimes.length ? gameTimes[gameTimes.length - 1].gameId : undefined;

    const firstTogether = gameTimes[0]?.ts;
    const lastTogether = gameTimes.length ? gameTimes[gameTimes.length - 1].ts : undefined;

    const sessionGapMs = (() => {
      const root = doc.querySelector<HTMLDivElement>(".ga-root");
      const raw = Number(root?.dataset.gaSessionGapMinutes);
      const minutes = Number.isFinite(raw) ? Math.max(1, Math.min(360, Math.round(raw))) : 45;
      return minutes * 60 * 1000;
    })();
    let sessionCount = 0;
    let sessionTotalGames = 0;
    let longestSessionGames = 0;
    let longestSessionStart: number | undefined;
    let longestSessionEnd: number | undefined;
    let longestSessionIds: string[] = [];
    let longestBreakMs: number | undefined;
    let longestBreakPrevGameId: string | undefined;
    let longestBreakNextGameId: string | undefined;

    if (gameTimes.length > 0) {
      sessionCount = 1;
      let curStart = gameTimes[0].ts;
      let curGames = 1;
      let curIds = [gameTimes[0].gameId];
      let prevTs = gameTimes[0].ts;
      let prevGameId = gameTimes[0].gameId;

      for (let i = 1; i < gameTimes.length; i++) {
        const ts = gameTimes[i].ts;
        const gap = ts - prevTs;
        if (Number.isFinite(gap) && gap > 0) {
          if (longestBreakMs === undefined || gap > longestBreakMs) {
            longestBreakMs = gap;
            longestBreakPrevGameId = prevGameId;
            longestBreakNextGameId = gameTimes[i].gameId;
          }
        }

        if (gap > sessionGapMs) {
          sessionTotalGames += curGames;
          if (curGames > longestSessionGames) {
            longestSessionGames = curGames;
            longestSessionStart = curStart;
            longestSessionEnd = prevTs;
            longestSessionIds = [...curIds];
          }
          sessionCount++;
          curStart = ts;
          curGames = 1;
          curIds = [gameTimes[i].gameId];
        } else {
          curGames++;
          curIds.push(gameTimes[i].gameId);
        }
        prevTs = ts;
        prevGameId = gameTimes[i].gameId;
      }

      sessionTotalGames += curGames;
      if (curGames > longestSessionGames) {
        longestSessionGames = curGames;
        longestSessionStart = curStart;
        longestSessionEnd = prevTs;
        longestSessionIds = [...curIds];
      }
    }

    const avgGamesPerSession = sessionCount ? sessionTotalGames / sessionCount : undefined;

    const roundsTogetherDrill = compareRounds;
    const firstGameDrill = firstGameId ? (byGame.get(firstGameId) ?? []) : [];
    const lastGameDrill = lastGameId ? (byGame.get(lastGameId) ?? []) : [];
    const longestSessionDrill = longestSessionIds.flatMap((id) => byGame.get(id) ?? []);
    const longestBreakDrill =
      longestBreakPrevGameId && longestBreakNextGameId
        ? [...(byGame.get(longestBreakPrevGameId) ?? []), ...(byGame.get(longestBreakNextGameId) ?? [])]
        : [];

    const h2h = mkBox(doc, "Head-to-head questions:");
    addRowWithDrill(h2h.box, "Closer guesses", decideLeader(myCloser, mateCloser), "Closer guesses - Rounds", closerDrill);
    addRowWithDrill(h2h.box, "Higher score rounds", decideLeader(myScoreWins, mateScoreWins), "Higher score rounds - Rounds", higherScoreDrill);
    addRowWithDrill(h2h.box, "Fewer throws (<50)", decideLeader(mateThrows, myThrows), "Throws (<50) - Rounds", fewerThrowsDrill);
    addRowWithDrill(h2h.box, "More 5k rounds", decideLeader(myFiveKs, mateFiveKs), "Perfect 5k - Rounds", moreFiveKDrill);

    const facts = mkBox(doc, "Team facts:");
    addRowWithDrill(facts.box, "Games together", String(games.length), "Games together - Rounds", roundsTogetherDrill);
    addRowWithDrill(facts.box, "Rounds together", String(compareRounds.length), "Rounds together - Rounds", roundsTogetherDrill);
    addRowWithDrill(
      facts.box,
      "Time played together",
      timedRounds > 0
        ? `${formatDurationHuman(timePlayedMs)}${
            timedRounds > 0 && timedRounds < compareRounds.length ? ` (from ${timedRounds}/${compareRounds.length} rounds with time data)` : ""
          }`
        : "-",
      "Time played together - Rounds",
      timedRoundsDrill
    );
    addRowWithDrill(
      facts.box,
      "First game together",
      typeof firstTogether === "number" ? formatShortDateTime(firstTogether) : "-",
      "First game together - Rounds",
      firstGameDrill
    );
    addRowWithDrill(
      facts.box,
      "Most recent game together",
      typeof lastTogether === "number" ? formatShortDateTime(lastTogether) : "-",
      "Most recent game together - Rounds",
      lastGameDrill
    );
    addRowWithDrill(
      facts.box,
      "Longest session together",
      longestSessionGames > 0 && longestSessionStart !== undefined && longestSessionEnd !== undefined
        ? `${longestSessionGames} games (${formatShortDateTime(longestSessionStart)} -> ${formatShortDateTime(longestSessionEnd)})`
        : "-",
      "Longest session together - Rounds",
      longestSessionDrill
    );
    addRowWithDrill(
      facts.box,
      "Avg games per session together",
      typeof avgGamesPerSession === "number" ? avgGamesPerSession.toFixed(1) : "-",
      "Avg games per session together - Rounds",
      roundsTogetherDrill
    );
    addRowWithDrill(
      facts.box,
      "Longest break between games together",
      typeof longestBreakMs === "number" ? formatDurationHuman(longestBreakMs) : "-",
      "Longest break between games together - Rounds",
      longestBreakDrill
    );

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
    host.appendChild(grid);
  };

  renderForMate();

  return wrap;
}
