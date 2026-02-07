import { db, FeedGameRow, GameRow, RoundRow } from "./db";
import { getModeCounts } from "./sync";

function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function formatDay(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function avg(values: number[]): number | undefined {
  return values.length ? sum(values) / values.length : undefined;
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function stdDev(values: number[]): number | undefined {
  if (values.length < 2) return undefined;
  const m = avg(values);
  if (m === undefined) return undefined;
  const vari = avg(values.map((x) => (x - m) ** 2));
  return vari === undefined ? undefined : Math.sqrt(vari);
}

function fmt(n: number | undefined, digits = 2): string {
  if (n === undefined || !Number.isFinite(n)) return "-";
  return n.toFixed(digits);
}

function extractScore(r: RoundRow): number | undefined {
  if (typeof r.p1_score === "number") return r.p1_score;
  if (typeof r.score === "number") return r.score;
  return undefined;
}

function extractDistanceMeters(r: RoundRow): number | undefined {
  if (typeof (r as any).p1_distanceKm === "number") return (r as any).p1_distanceKm * 1e3;
  if (typeof r.p1_distanceMeters === "number") return r.p1_distanceMeters;
  if (typeof r.distanceMeters === "number") return r.distanceMeters;
  return undefined;
}

function extractTimeMs(r: RoundRow): number | undefined {
  if (typeof r.timeMs === "number") return r.timeMs;
  if (typeof r.durationSeconds === "number") return r.durationSeconds * 1e3;
  return undefined;
}

function makeAsciiBar(value: number, maxValue: number, width = 16): string {
  if (maxValue <= 0) return "-".repeat(width);
  const filled = Math.max(0, Math.min(width, Math.round((value / maxValue) * width)));
  return `${"#".repeat(filled)}${"-".repeat(width - filled)}`;
}

function makeDayActivityLines(gameTimestamps: number[], lastDays = 14): string[] {
  const now = Date.now();
  const today = startOfLocalDay(now);
  const perDay = new Map<number, number>();
  for (const ts of gameTimestamps) {
    const day = startOfLocalDay(ts);
    perDay.set(day, (perDay.get(day) || 0) + 1);
  }

  const days: Array<{ day: number; count: number }> = [];
  for (let i = lastDays - 1; i >= 0; i--) {
    const day = today - i * 24 * 60 * 60 * 1000;
    days.push({ day, count: perDay.get(day) || 0 });
  }

  const maxCount = Math.max(1, ...days.map((d) => d.count));
  return days.map((d) => `${formatDay(d.day)}  ${makeAsciiBar(d.count, maxCount)}  ${d.count}`);
}

function inTsRange(ts: number, fromTs?: number, toTs?: number): boolean {
  if (fromTs !== undefined && ts < fromTs) return false;
  if (toTs !== undefined && ts > toTs) return false;
  return true;
}

function getGameMode(game: FeedGameRow): string {
  return game.gameMode || game.mode || "unknown";
}

function normalizeCountryCode(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const x = v.trim().toLowerCase();
  return x ? x : undefined;
}

function playerSlots(round: RoundRow): Array<1 | 2 | 3 | 4> {
  const out: Array<1 | 2 | 3 | 4> = [];
  for (const slot of [1, 2, 3, 4] as const) {
    const id = (round as any)[`p${slot}_playerId`];
    if (typeof id === "string" && id.trim()) out.push(slot);
  }
  return out;
}

function getPlayerStatFromRound(round: RoundRow, playerId: string): { score?: number; distanceKm?: number; teamId?: string } | undefined {
  for (const slot of playerSlots(round)) {
    const pid = (round as any)[`p${slot}_playerId`];
    if (pid !== playerId) continue;
    return {
      score: typeof (round as any)[`p${slot}_score`] === "number" ? (round as any)[`p${slot}_score`] : undefined,
      distanceKm: typeof (round as any)[`p${slot}_distanceKm`] === "number" ? (round as any)[`p${slot}_distanceKm`] : undefined,
      teamId: typeof (round as any)[`p${slot}_teamId`] === "string" ? (round as any)[`p${slot}_teamId`] : undefined
    };
  }
  return undefined;
}

function inferOwnPlayerId(rounds: RoundRow[]): string | undefined {
  const counts = new Map<string, number>();
  for (const r of rounds) {
    if (typeof r.p1_playerId === "string" && r.p1_playerId.trim()) {
      counts.set(r.p1_playerId, (counts.get(r.p1_playerId) || 0) + 1);
    }
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best?.[0];
}

function collectPlayerNames(details: GameRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const d of details) {
    const pairs: Array<[string | undefined, string | undefined]> = [
      [(d as any).playerOneId ?? (d as any).p1_playerId, (d as any).playerOneName ?? (d as any).p1_playerName],
      [(d as any).playerTwoId ?? (d as any).p2_playerId, (d as any).playerTwoName ?? (d as any).p2_playerName],
      [(d as any).teamOnePlayerOneId, (d as any).teamOnePlayerOneName],
      [(d as any).teamOnePlayerTwoId, (d as any).teamOnePlayerTwoName],
      [(d as any).teamTwoPlayerOneId, (d as any).teamTwoPlayerOneName],
      [(d as any).teamTwoPlayerTwoId, (d as any).teamTwoPlayerTwoName]
    ];
    for (const [id, name] of pairs) {
      if (typeof id !== "string" || !id.trim()) continue;
      if (typeof name !== "string" || !name.trim()) continue;
      if (!map.has(id)) map.set(id, name.trim());
    }
  }
  return map;
}

function toChartPointsByDay(values: Array<{ ts: number; value: number }>): Array<{ x: number; y: number; label?: string }> {
  const byDay = new Map<number, number[]>();
  for (const v of values) {
    const day = startOfLocalDay(v.ts);
    const arr = byDay.get(day) || [];
    arr.push(v.value);
    byDay.set(day, arr);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, vals]) => ({ x: day, y: avg(vals) || 0, label: formatDay(day) }));
}

function toCountsByDay(timestamps: number[]): Array<{ x: number; y: number; label?: string }> {
  const map = new Map<number, number>();
  for (const ts of timestamps) {
    const day = startOfLocalDay(ts);
    map.set(day, (map.get(day) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([day, c]) => ({ x: day, y: c, label: formatDay(day) }));
}

export interface DayPoint {
  day: string;
  count: number;
}

export interface DashboardData {
  reportLines: string[];
  activity: DayPoint[];
  modes: Array<{ mode: string; count: number }>;
}

export type AnalysisChart =
  | {
      type: "line";
      yLabel?: string;
      points: Array<{ x: number; y: number; label?: string }>;
    }
  | {
      type: "bar";
      yLabel?: string;
      bars: Array<{ label: string; value: number }>;
    };

export interface AnalysisSection {
  id: string;
  title: string;
  lines: string[];
  chart?: AnalysisChart;
  charts?: AnalysisChart[];
}

export interface AnalysisWindowData {
  sections: AnalysisSection[];
  availableModes: string[];
  availableTeammates: Array<{ id: string; label: string }>;
  availableCountries: Array<{ code: string; label: string }>;
  minPlayedAt?: number;
  maxPlayedAt?: number;
}

export interface AnalysisFilter {
  fromTs?: number;
  toTs?: number;
  mode?: string;
  teammateId?: string;
  country?: string;
}

export async function getDashboardData(): Promise<DashboardData> {
  const [games, rounds] = await Promise.all([db.games.orderBy("playedAt").toArray(), db.rounds.toArray()]);
  if (games.length === 0) {
    return { reportLines: ["No games yet. Run sync first."], activity: [], modes: [] };
  }

  const gameTimes = games.map((g) => g.playedAt).sort((a, b) => a - b);
  const lines: string[] = [];
  lines.push(`Range: ${new Date(gameTimes[0]).toLocaleString()} -> ${new Date(gameTimes[gameTimes.length - 1]).toLocaleString()}`);
  lines.push(`Games: ${games.length} | Rounds: ${rounds.length}`);
  lines.push("");
  lines.push("Activity (last 14 days):");
  lines.push(...makeDayActivityLines(gameTimes, 14));

  const modes = await getModeCounts();
  const now = Date.now();
  const today = startOfLocalDay(now);
  const perDay = new Map<number, number>();
  for (const ts of gameTimes) {
    const day = startOfLocalDay(ts);
    perDay.set(day, (perDay.get(day) || 0) + 1);
  }
  const activity: DayPoint[] = [];
  for (let i = 13; i >= 0; i--) {
    const day = today - i * 24 * 60 * 60 * 1000;
    activity.push({ day: formatDay(day), count: perDay.get(day) || 0 });
  }

  return { reportLines: lines, activity, modes: modes.slice(0, 10) };
}

export async function getAnalysisWindowData(filter?: AnalysisFilter): Promise<AnalysisWindowData> {
  const [allGames, allRounds, allDetails] = await Promise.all([
    db.games.orderBy("playedAt").toArray(),
    db.rounds.toArray(),
    db.details.toArray()
  ]);

  const modeSet = new Set<string>();
  for (const g of allGames) modeSet.add(getGameMode(g));
  const availableModes = ["all", ...[...modeSet].sort((a, b) => a.localeCompare(b))];
  const minPlayedAt = allGames.length ? allGames[0].playedAt : undefined;
  const maxPlayedAt = allGames.length ? allGames[allGames.length - 1].playedAt : undefined;

  const baseGames = allGames.filter((g) => {
    if (!inTsRange(g.playedAt, filter?.fromTs, filter?.toTs)) return false;
    if (filter?.mode && filter.mode !== "all" && getGameMode(g) !== filter.mode) return false;
    return true;
  });
  const baseGameSet = new Set(baseGames.map((g) => g.gameId));
  const baseRounds = allRounds.filter((r) => baseGameSet.has(r.gameId));
  const baseDetails = allDetails.filter((d) => baseGameSet.has(d.gameId));

  const ownPlayerId = inferOwnPlayerId(baseRounds);
  const nameMap = collectPlayerNames(baseDetails);

  const teammateGames = new Map<string, Set<string>>();
  const teammateRoundSamples = new Map<string, number>();

  for (const d of baseDetails) {
    const m = (d as any).modeFamily as string | undefined;
    if (m !== "teamduels") continue;

    const p1 = (d as any).teamOnePlayerOneId as string | undefined;
    const p2 = (d as any).teamOnePlayerTwoId as string | undefined;
    const own = ownPlayerId && [p1, p2].includes(ownPlayerId) ? ownPlayerId : p1;
    const mate = [p1, p2].find((x) => !!x && x !== own);
    if (!mate) continue;

    if (!teammateGames.has(mate)) teammateGames.set(mate, new Set<string>());
    teammateGames.get(mate)?.add(d.gameId);
  }

  for (const r of baseRounds) {
    for (const [tid] of teammateGames) {
      if (!teammateGames.get(tid)?.has(r.gameId)) continue;
      const st = getPlayerStatFromRound(r, tid);
      if (!st) continue;
      if (typeof st.score === "number" || typeof st.distanceKm === "number") {
        teammateRoundSamples.set(tid, (teammateRoundSamples.get(tid) || 0) + 1);
      }
    }
  }

  const availableTeammates = [
    { id: "all", label: "All teammates" },
    ...[...teammateGames.entries()]
      .map(([id, games]) => {
        const name = nameMap.get(id) || id.slice(0, 8);
        const rounds = teammateRoundSamples.get(id) || 0;
        return { id, label: `${name} (${games.size} games, ${rounds} rounds)` };
      })
      .sort((a, b) => a.label.localeCompare(b.label))
  ];

  const countryCountsBase = new Map<string, number>();
  for (const r of baseRounds) {
    const c = normalizeCountryCode(r.trueCountry);
    if (!c) continue;
    countryCountsBase.set(c, (countryCountsBase.get(c) || 0) + 1);
  }
  const availableCountries = [
    { code: "all", label: "All countries" },
    ...[...countryCountsBase.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 100)
      .map(([code, count]) => ({ code, label: `${code.toUpperCase()} (${count} rounds)` }))
  ];

  let games = baseGames;
  let rounds = baseRounds;
  let details = baseDetails;

  if (filter?.teammateId && filter.teammateId !== "all") {
    const allowedGameIds = teammateGames.get(filter.teammateId) || new Set<string>();
    games = games.filter((g) => allowedGameIds.has(g.gameId));
    const gameSet = new Set(games.map((g) => g.gameId));
    rounds = rounds.filter((r) => gameSet.has(r.gameId));
    details = details.filter((d) => gameSet.has(d.gameId));
  }

  if (filter?.country && filter.country !== "all") {
    const c = filter.country.toLowerCase();
    rounds = rounds.filter((r) => normalizeCountryCode(r.trueCountry) === c);
    const gameSet = new Set(rounds.map((r) => r.gameId));
    games = games.filter((g) => gameSet.has(g.gameId));
    details = details.filter((d) => gameSet.has(d.gameId));
  }

  if (games.length === 0 || rounds.length === 0) {
    return {
      sections: [{ id: "empty", title: "Overview", lines: ["Keine Daten fuer den gewaehlten Filter."] }],
      availableModes,
      availableTeammates,
      availableCountries,
      minPlayedAt,
      maxPlayedAt
    };
  }

  const sections: AnalysisSection[] = [];
  const gameTimes = games.map((g) => g.playedAt).sort((a, b) => a - b);
  const playedAtByGameId = new Map(games.map((g) => [g.gameId, g.playedAt]));
  const scores = rounds.map(extractScore).filter((v): v is number => v !== undefined);
  const distancesKm = rounds
    .map((r) => extractDistanceMeters(r))
    .filter((v): v is number => v !== undefined)
    .map((m) => m / 1e3);
  const timesSec = rounds
    .map(extractTimeMs)
    .filter((v): v is number => v !== undefined)
    .map((ms) => ms / 1e3);

  const selectedTeammate = filter?.teammateId && filter.teammateId !== "all" ? filter.teammateId : undefined;
  const selectedCountry = filter?.country && filter.country !== "all" ? filter.country.toLowerCase() : undefined;

  sections.push({
    id: "overview",
    title: "Overview",
    lines: [
      `Range: ${new Date(gameTimes[0]).toLocaleString()} -> ${new Date(gameTimes[gameTimes.length - 1]).toLocaleString()}`,
      `Games: ${games.length} | Rounds: ${rounds.length}`,
      `Filters: mode=${filter?.mode || "all"}, teammate=${selectedTeammate ? (nameMap.get(selectedTeammate) || selectedTeammate) : "all"}, country=${selectedCountry ? selectedCountry.toUpperCase() : "all"}`,
      `Avg score: ${fmt(avg(scores), 1)} | Median: ${fmt(median(scores), 1)} | StdDev: ${fmt(stdDev(scores), 1)}`,
      `Avg distance: ${fmt(avg(distancesKm), 2)} km | Median: ${fmt(median(distancesKm), 2)} km`,
      `Avg time: ${fmt(avg(timesSec), 1)} s | Median: ${fmt(median(timesSec), 1)} s`
    ],
    charts: [
      {
        type: "line",
        yLabel: "Games/day",
        points: toCountsByDay(games.map((g) => g.playedAt))
      },
      {
        type: "line",
        yLabel: "Avg score/day",
        points: toChartPointsByDay(
          rounds
            .map((r) => ({ ts: playedAtByGameId.get(r.gameId) || 0, value: extractScore(r) }))
            .filter((x): x is { ts: number; value: number } => x.ts > 0 && typeof x.value === "number")
        )
      }
    ]
  });

  const modeCounts = new Map<string, number>();
  for (const g of games) modeCounts.set(getGameMode(g), (modeCounts.get(getGameMode(g)) || 0) + 1);
  sections.push({
    id: "modes",
    title: "Mode Breakdown",
    lines: [...modeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([m, c]) => `${m}: ${c}`),
    chart: {
      type: "bar",
      yLabel: "Games",
      bars: [...modeCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([m, c]) => ({ label: m.length > 18 ? `${m.slice(0, 18)}...` : m, value: c }))
    }
  });

  const weekday = new Array(7).fill(0);
  const hour = new Array(24).fill(0);
  for (const ts of gameTimes) {
    const d = new Date(ts);
    weekday[d.getDay()]++;
    hour[d.getHours()]++;
  }
  const wdNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  sections.push({
    id: "time_patterns",
    title: "Time Patterns",
    lines: [
      "Weekdays:",
      ...weekday.map((v, i) => `${wdNames[i]}: ${v}`),
      "Top hours:",
      ...hour
        .map((v, h) => ({ h, v }))
        .sort((a, b) => b.v - a.v)
        .slice(0, 6)
        .map((x) => `${String(x.h).padStart(2, "0")}:00 -> ${x.v} games`)
    ],
    charts: [
      {
        type: "bar",
        yLabel: "Games",
        bars: weekday.map((v, i) => ({ label: wdNames[i], value: v }))
      },
      {
        type: "bar",
        yLabel: "Games",
        bars: hour.map((v, h) => ({ label: String(h), value: v }))
      }
    ]
  });

  const countryAgg = new Map<string, { n: number; score: number[]; dist: number[]; correct: number; guessed: Map<string, number> }>();
  for (const r of rounds) {
    const t = normalizeCountryCode(r.trueCountry);
    if (!t) continue;
    const entry = countryAgg.get(t) || { n: 0, score: [], dist: [], correct: 0, guessed: new Map<string, number>() };
    entry.n++;

    const sc = extractScore(r);
    if (typeof sc === "number") entry.score.push(sc);

    const dm = extractDistanceMeters(r);
    if (typeof dm === "number") entry.dist.push(dm / 1e3);

    const guess = normalizeCountryCode((r as any).p1_guessCountry);
    if (guess) {
      entry.guessed.set(guess, (entry.guessed.get(guess) || 0) + 1);
      if (guess === t) entry.correct++;
    }

    countryAgg.set(t, entry);
  }

  const topCountries = [...countryAgg.entries()].sort((a, b) => b[1].n - a[1].n);
  const scoredCountries = topCountries
    .filter(([, v]) => v.score.length >= 4)
    .map(([c, v]) => ({
      country: c,
      n: v.n,
      avgScore: avg(v.score) || 0,
      avgDist: avg(v.dist),
      hitRate: v.n > 0 ? v.correct / v.n : 0
    }));

  const bestCountries = [...scoredCountries].sort((a, b) => b.avgScore - a.avgScore).slice(0, 5);
  const worstCountries = [...scoredCountries].sort((a, b) => a.avgScore - b.avgScore).slice(0, 5);

  sections.push({
    id: "country_stats",
    title: "Country Stats",
    lines: [
      "Most played countries:",
      ...topCountries.slice(0, 10).map(([c, v]) => `${c.toUpperCase()}: ${v.n} rounds`),
      "Best avg-score countries (min 4 rounds):",
      ...bestCountries.map((x) => `${x.country.toUpperCase()}: score ${fmt(x.avgScore, 1)} | hit ${fmt(x.hitRate * 100, 1)}% | n=${x.n}`),
      "Hardest avg-score countries (min 4 rounds):",
      ...worstCountries.map((x) => `${x.country.toUpperCase()}: score ${fmt(x.avgScore, 1)} | hit ${fmt(x.hitRate * 100, 1)}% | n=${x.n}`)
    ],
    chart: {
      type: "bar",
      yLabel: "Rounds",
      bars: topCountries.slice(0, 12).map(([c, v]) => ({ label: c.toUpperCase(), value: v.n }))
    }
  });

  const opponentCounts = new Map<string, { games: number; name?: string; country?: string }>();
  for (const d of details) {
    const ids: Array<{ id?: string; name?: string; country?: string }> = [];
    const modeFamily = (d as any).modeFamily as string | undefined;
    if (modeFamily === "duels") {
      ids.push({ id: (d as any).playerTwoId ?? (d as any).p2_playerId, name: (d as any).playerTwoName, country: (d as any).playerTwoCountry });
    } else if (modeFamily === "teamduels") {
      ids.push({ id: (d as any).teamTwoPlayerOneId, name: (d as any).teamTwoPlayerOneName, country: (d as any).teamTwoPlayerOneCountry });
      ids.push({ id: (d as any).teamTwoPlayerTwoId, name: (d as any).teamTwoPlayerTwoName, country: (d as any).teamTwoPlayerTwoCountry });
    }
    for (const x of ids) {
      if (!x.id) continue;
      const cur = opponentCounts.get(x.id) || { games: 0 };
      cur.games += 1;
      if (x.name) cur.name = x.name;
      if (x.country) cur.country = x.country;
      opponentCounts.set(x.id, cur);
    }
  }

  const topOpp = [...opponentCounts.entries()].sort((a, b) => b[1].games - a[1].games).slice(0, 12);
  const oppCountryCounts = new Map<string, number>();
  for (const [, v] of topOpp) {
    const c = typeof v.country === "string" && v.country.trim() ? v.country.trim() : "Unknown";
    oppCountryCounts.set(c, (oppCountryCounts.get(c) || 0) + v.games);
  }

  sections.push({
    id: "opponents",
    title: "Most Frequent Opponents",
    lines: [
      ...topOpp.map(([id, v]) => `${v.name || id.slice(0, 8)}: ${v.games} meetings${v.country ? ` (${v.country})` : ""}`),
      "Opponent countries:",
      ...[...oppCountryCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, n]) => `${c}: ${n}`)
    ],
    chart: {
      type: "bar",
      yLabel: "Meetings",
      bars: topOpp.map(([id, v]) => ({ label: (v.name || id.slice(0, 6)).slice(0, 12), value: v.games }))
    }
  });

  const sessionsGap = 45 * 60 * 1000;
  let sessions = 0;
  let longest = 0;
  let cur = 0;
  for (let i = 0; i < gameTimes.length; i++) {
    if (i === 0 || gameTimes[i] - gameTimes[i - 1] > sessionsGap) {
      sessions++;
      cur = 1;
    } else {
      cur++;
    }
    if (cur > longest) longest = cur;
  }

  const longestBreakMs = gameTimes.slice(1).reduce((mx, ts, i) => Math.max(mx, ts - gameTimes[i]), 0);

  sections.push({
    id: "fun_facts",
    title: "Fun Facts",
    lines: [
      `Current streak depth (last 14d activity bars):`,
      ...makeDayActivityLines(gameTimes, 14).slice(-7),
      `Sessions (gap >45m): ${sessions} | longest session: ${longest} games`,
      `Longest break between games: ${fmt(longestBreakMs / (1000 * 60 * 60), 1)} hours`,
      `Most played mode: ${[...modeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "-"}`,
      `Most played country: ${topCountries[0] ? topCountries[0][0].toUpperCase() : "-"}`
    ]
  });

  const teammateToUse = selectedTeammate || [...teammateGames.entries()].sort((a, b) => b[1].size - a[1].size)[0]?.[0];
  if (teammateToUse && ownPlayerId) {
    const compareRounds = rounds.filter((r) => {
      const mine = getPlayerStatFromRound(r, ownPlayerId);
      const mate = getPlayerStatFromRound(r, teammateToUse);
      return !!mine && !!mate;
    });

    let myWins = 0;
    let mateWins = 0;
    let ties = 0;
    const cumulative: Array<{ x: number; y: number; label?: string }> = [];
    let net = 0;

    for (const r of compareRounds) {
      const playedAt = playedAtByGameId.get(r.gameId);
      const mine = getPlayerStatFromRound(r, ownPlayerId)!;
      const mate = getPlayerStatFromRound(r, teammateToUse)!;

      let result = 0;
      if (typeof mine.score === "number" && typeof mate.score === "number") {
        result = mine.score > mate.score ? 1 : mine.score < mate.score ? -1 : 0;
      } else if (typeof mine.distanceKm === "number" && typeof mate.distanceKm === "number") {
        result = mine.distanceKm < mate.distanceKm ? 1 : mine.distanceKm > mate.distanceKm ? -1 : 0;
      }

      if (result > 0) {
        myWins++;
        net++;
      } else if (result < 0) {
        mateWins++;
        net--;
      } else {
        ties++;
      }

      if (playedAt) cumulative.push({ x: playedAt, y: net, label: formatDay(playedAt) });
    }

    const mateName = nameMap.get(teammateToUse) || teammateToUse.slice(0, 8);
    sections.push({
      id: "teammate_battle",
      title: `Teammate Battle: You vs ${mateName}`,
      lines: [
        `Compared rounds: ${compareRounds.length}`,
        `You better guess: ${myWins} rounds`,
        `${mateName} better guess: ${mateWins} rounds`,
        `Tie rounds: ${ties}`,
        `Edge: ${myWins - mateWins >= 0 ? "+" : ""}${myWins - mateWins}`
      ],
      charts: [
        {
          type: "bar",
          yLabel: "Rounds",
          bars: [
            { label: "You", value: myWins },
            { label: mateName.slice(0, 12), value: mateWins },
            { label: "Tie", value: ties }
          ]
        },
        {
          type: "line",
          yLabel: "Net lead",
          points: cumulative
        }
      ]
    });
  }

  const spotlightCountry = selectedCountry || topCountries[0]?.[0];
  if (spotlightCountry && countryAgg.has(spotlightCountry)) {
    const agg = countryAgg.get(spotlightCountry)!;
    const wrongGuesses = [...agg.guessed.entries()]
      .filter(([guess]) => guess !== spotlightCountry)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    const countryRounds = rounds.filter((r) => normalizeCountryCode(r.trueCountry) === spotlightCountry);
    const scoreTimeline = countryRounds
      .map((r) => {
        const playedAt = playedAtByGameId.get(r.gameId);
        const s = extractScore(r);
        if (!playedAt || typeof s !== "number") return undefined;
        return { x: playedAt, y: s, label: formatDay(playedAt) };
      })
      .filter((x): x is { x: number; y: number; label?: string } => !!x)
      .sort((a, b) => a.x - b.x);

    sections.push({
      id: "country_spotlight",
      title: `Country Spotlight: ${spotlightCountry.toUpperCase()}`,
      lines: [
        `Rounds: ${agg.n}`,
        `Hit rate: ${fmt((agg.n > 0 ? agg.correct / agg.n : 0) * 100, 1)}%`,
        `Avg score: ${fmt(avg(agg.score), 1)} | Median score: ${fmt(median(agg.score), 1)}`,
        `Avg distance: ${fmt(avg(agg.dist), 2)} km`,
        wrongGuesses.length > 0 ? "Most common wrong guesses:" : "No wrong guess data.",
        ...wrongGuesses.map(([g, n]) => `${g.toUpperCase()}: ${n}`)
      ],
      charts: [
        {
          type: "line",
          yLabel: "Score",
          points: scoreTimeline
        },
        {
          type: "bar",
          yLabel: "Wrong guesses",
          bars: wrongGuesses.map(([g, n]) => ({ label: g.toUpperCase(), value: n }))
        }
      ]
    });
  }

  return {
    sections,
    availableModes,
    availableTeammates,
    availableCountries,
    minPlayedAt,
    maxPlayedAt
  };
}

export async function getAnalysisReport(): Promise<string[]> {
  const d = await getDashboardData();
  return d.reportLines;
}
