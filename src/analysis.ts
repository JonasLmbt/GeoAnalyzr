import { db, FeedGameRow, GameRow, RoundRow } from "./db";
import { getModeCounts } from "./sync";

type UnknownRecord = Record<string, unknown>;

function asRecord(v: unknown): UnknownRecord {
  return typeof v === "object" && v !== null ? (v as UnknownRecord) : {};
}

function getString(rec: UnknownRecord, key: string): string | undefined {
  const v = rec[key];
  return typeof v === "string" ? v : undefined;
}

function getNumber(rec: UnknownRecord, key: string): number | undefined {
  const v = rec[key];
  return typeof v === "number" ? v : undefined;
}

const regionDisplay =
  typeof Intl !== "undefined" && "DisplayNames" in Intl && typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;

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

function pct(part: number, total: number): number {
  if (!total) return 0;
  return (part / total) * 100;
}

function extractScore(r: RoundRow): number | undefined {
  const rr = asRecord(r);
  const p1Score = getNumber(rr, "p1_score");
  if (typeof p1Score === "number") return p1Score;
  const legacyScore = getNumber(rr, "score");
  if (typeof legacyScore === "number") return legacyScore;
  return undefined;
}

function extractDistanceMeters(r: RoundRow): number | undefined {
  const rr = asRecord(r);
  const p1DistanceKm = getNumber(rr, "p1_distanceKm");
  if (typeof p1DistanceKm === "number") return p1DistanceKm * 1e3;
  const p1DistanceMeters = getNumber(rr, "p1_distanceMeters");
  if (typeof p1DistanceMeters === "number") return p1DistanceMeters;
  const legacyDistanceMeters = getNumber(rr, "distanceMeters");
  if (typeof legacyDistanceMeters === "number") return legacyDistanceMeters;
  return undefined;
}

function extractTimeMs(r: RoundRow): number | undefined {
  const rr = asRecord(r);
  const legacyTimeMs = getNumber(rr, "timeMs");
  if (typeof legacyTimeMs === "number") return legacyTimeMs;
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

function countryLabel(code?: string): string {
  const c = normalizeCountryCode(code);
  if (!c) return "-";
  if (c.length === 2 && regionDisplay) {
    try {
      const name = regionDisplay.of(c.toUpperCase());
      if (typeof name === "string" && name.trim()) return name;
    } catch {
      // fallback below
    }
  }
  return c.toUpperCase();
}

function countryFlagEmoji(code?: string): string {
  const c = normalizeCountryCode(code);
  if (!c || c.length !== 2) return "";
  const base = 127397;
  return c
    .toUpperCase()
    .split("")
    .map((ch) => String.fromCodePoint(base + ch.charCodeAt(0)))
    .join("");
}

function extractOwnDuelRating(detail: GameRow, ownPlayerId?: string): { start?: number; end?: number } | undefined {
  const d = asRecord(detail);
  const p1 = getString(d, "playerOneId") ?? getString(d, "p1_playerId");
  const p2 = getString(d, "playerTwoId") ?? getString(d, "p2_playerId");
  if (ownPlayerId && ownPlayerId === p2) {
    return {
      start: getNumber(d, "playerTwoStartRating") ?? getNumber(d, "p2_ratingBefore"),
      end: getNumber(d, "playerTwoEndRating") ?? getNumber(d, "p2_ratingAfter")
    };
  }
  return {
    start: getNumber(d, "playerOneStartRating") ?? getNumber(d, "p1_ratingBefore"),
    end: getNumber(d, "playerOneEndRating") ?? getNumber(d, "p1_ratingAfter")
  };
}

function extractOwnTeamRating(detail: GameRow, ownPlayerId?: string): { start?: number; end?: number } | undefined {
  const d = asRecord(detail);
  if (ownPlayerId) {
    const teamOneIds = [getString(d, "teamOnePlayerOneId"), getString(d, "teamOnePlayerTwoId")];
    const inTeamOne = teamOneIds.includes(ownPlayerId);
    if (!inTeamOne) {
      return {
        start: getNumber(d, "teamTwoStartRating"),
        end: getNumber(d, "teamTwoEndRating")
      };
    }
  }
  return {
    start: getNumber(d, "teamOneStartRating"),
    end: getNumber(d, "teamOneEndRating")
  };
}

function playerSlots(round: RoundRow): Array<1 | 2 | 3 | 4> {
  const out: Array<1 | 2 | 3 | 4> = [];
  const rr = asRecord(round);
  for (const slot of [1, 2, 3, 4] as const) {
    const id = getString(rr, `p${slot}_playerId`);
    if (typeof id === "string" && id.trim()) out.push(slot);
  }
  return out;
}

function getPlayerStatFromRound(round: RoundRow, playerId: string): { score?: number; distanceKm?: number; teamId?: string } | undefined {
  const rr = asRecord(round);
  for (const slot of playerSlots(round)) {
    const pid = getString(rr, `p${slot}_playerId`);
    if (pid !== playerId) continue;
    return {
      score: getNumber(rr, `p${slot}_score`),
      distanceKm: getNumber(rr, `p${slot}_distanceKm`),
      teamId: getString(rr, `p${slot}_teamId`)
    };
  }
  return undefined;
}

function inferOwnPlayerId(rounds: RoundRow[]): string | undefined {
  const counts = new Map<string, number>();
  for (const r of rounds) {
    const p1PlayerId = getString(asRecord(r), "p1_playerId");
    if (typeof p1PlayerId === "string" && p1PlayerId.trim()) {
      counts.set(p1PlayerId, (counts.get(p1PlayerId) || 0) + 1);
    }
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best?.[0];
}

function collectPlayerNames(details: GameRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const d of details) {
    const dd = asRecord(d);
    const pairs: Array<[string | undefined, string | undefined]> = [
      [getString(dd, "playerOneId") ?? getString(dd, "p1_playerId"), getString(dd, "playerOneName") ?? getString(dd, "p1_playerName")],
      [getString(dd, "playerTwoId") ?? getString(dd, "p2_playerId"), getString(dd, "playerTwoName") ?? getString(dd, "p2_playerName")],
      [getString(dd, "teamOnePlayerOneId"), getString(dd, "teamOnePlayerOneName")],
      [getString(dd, "teamOnePlayerTwoId"), getString(dd, "teamOnePlayerTwoName")],
      [getString(dd, "teamTwoPlayerOneId"), getString(dd, "teamTwoPlayerOneName")],
      [getString(dd, "teamTwoPlayerTwoId"), getString(dd, "teamTwoPlayerTwoName")]
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
  group?: "Overview" | "Performance" | "Countries" | "Opponents" | "Rating" | "Fun";
  appliesFilters?: Array<"date" | "mode" | "teammate" | "country">;
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
    const dd = asRecord(d);
    const m = getString(dd, "modeFamily");
    if (m !== "teamduels") continue;

    const p1 = getString(dd, "teamOnePlayerOneId");
    const p2 = getString(dd, "teamOnePlayerTwoId");
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
        return { id, label: `${name} (${games.size} games, ${rounds} rounds)`, games: games.size };
      })
      .sort((a, b) => b.games - a.games || a.label.localeCompare(b.label))
      .map(({ id, label }) => ({ id, label }))
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
      .map(([code, count]) => ({ code, label: `${countryLabel(code)} (${count} rounds)` }))
  ];

  const selectedTeammate = filter?.teammateId && filter.teammateId !== "all" ? filter.teammateId : undefined;
  const selectedCountry = filter?.country && filter.country !== "all" ? filter.country.toLowerCase() : undefined;

  const teammateGameSet = selectedTeammate ? teammateGames.get(selectedTeammate) || new Set<string>() : undefined;

  const teamGames = selectedTeammate ? baseGames.filter((g) => teammateGameSet?.has(g.gameId)) : baseGames;
  const teamGameSet = new Set(teamGames.map((g) => g.gameId));
  const teamRounds = baseRounds.filter((r) => teamGameSet.has(r.gameId));
  const teamDetails = baseDetails.filter((d) => teamGameSet.has(d.gameId));

  const countryRounds = selectedCountry ? teamRounds.filter((r) => normalizeCountryCode(r.trueCountry) === selectedCountry) : teamRounds;
  const countryGameSet = new Set(countryRounds.map((r) => r.gameId));
  const countryGames = teamGames.filter((g) => countryGameSet.has(g.gameId));

  if (countryGames.length === 0 || countryRounds.length === 0) {
    return {
      sections: [{ id: "empty", title: "Overview", lines: ["Keine Daten fuer den gewaehlten Filter."] }],
      availableModes,
      availableTeammates,
      availableCountries,
      minPlayedAt,
      maxPlayedAt
    };
  }

  const games = countryGames;
  const rounds = countryRounds;

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
  const roundMetrics = rounds
    .map((r) => {
      const ts = playedAtByGameId.get(r.gameId);
      const score = extractScore(r);
      const timeMs = extractTimeMs(r);
      const distMeters = extractDistanceMeters(r);
      if (!ts || typeof score !== "number") return undefined;
      return {
        ts,
        day: startOfLocalDay(ts),
        score,
        timeSec: typeof timeMs === "number" ? timeMs / 1e3 : undefined,
        distKm: typeof distMeters === "number" ? distMeters / 1e3 : undefined
      };
    })
    .filter((x): x is { ts: number; day: number; score: number; timeSec?: number; distKm?: number } => !!x);
  const fiveKCount = roundMetrics.filter((x) => x.score >= 5000).length;
  const throwCount = roundMetrics.filter((x) => x.score < 50).length;

  sections.push({
    id: "overview",
    title: "Overview",
    group: "Overview",
    appliesFilters: ["date", "mode", "teammate", "country"],
    lines: [
      `Range: ${new Date(gameTimes[0]).toLocaleString()} -> ${new Date(gameTimes[gameTimes.length - 1]).toLocaleString()}`,
      `Games: ${games.length} | Rounds: ${rounds.length}`,
      `Filters: mode=${filter?.mode || "all"}, teammate=${selectedTeammate ? (nameMap.get(selectedTeammate) || selectedTeammate) : "all"}, country=${selectedCountry ? countryLabel(selectedCountry) : "all"}`,
      `Avg score: ${fmt(avg(scores), 1)} | Median: ${fmt(median(scores), 1)} | StdDev: ${fmt(stdDev(scores), 1)}`,
      `Avg distance: ${fmt(avg(distancesKm), 2)} km | Median: ${fmt(median(distancesKm), 2)} km`,
      `Avg time: ${fmt(avg(timesSec), 1)} s | Median: ${fmt(median(timesSec), 1)} s`,
      `Perfect 5k rounds: ${fiveKCount} (${fmt(pct(fiveKCount, roundMetrics.length), 1)}%) | Throws (<50): ${throwCount} (${fmt(pct(throwCount, roundMetrics.length), 1)}%)`
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
  const sortedModes = [...modeCounts.entries()].sort((a, b) => b[1] - a[1]);
  const modeBars = sortedModes
    .slice(0, 16)
    .map(([m, c]) => ({ label: m.length > 18 ? `${m.slice(0, 18)}...` : m, value: c }));
  const modeChart = modeBars.length >= 4 ? { type: "bar" as const, yLabel: "Games", bars: modeBars } : undefined;

  sections.push({
    id: "modes",
    title: "Mode Breakdown",
    group: "Overview",
    appliesFilters: ["date", "mode"],
    lines: sortedModes.slice(0, 20).map(([m, c]) => `${m}: ${c}`),
    chart: modeChart
  });

  const weekday = new Array(7).fill(0);
  const hour = new Array(24).fill(0);
  const weekdayScoreSum = new Array(7).fill(0);
  const weekdayScoreCount = new Array(7).fill(0);
  const weekdayTimeSum = new Array(7).fill(0);
  const weekdayTimeCount = new Array(7).fill(0);
  const hourScoreSum = new Array(24).fill(0);
  const hourScoreCount = new Array(24).fill(0);
  const hourTimeSum = new Array(24).fill(0);
  const hourTimeCount = new Array(24).fill(0);
  for (const ts of gameTimes) {
    const d = new Date(ts);
    weekday[d.getDay()]++;
    hour[d.getHours()]++;
  }
  for (const r of rounds) {
    const ts = playedAtByGameId.get(r.gameId);
    if (!ts) continue;
    const d = new Date(ts);
    const wd = d.getDay();
    const hr = d.getHours();
    const sc = extractScore(r);
    const tm = extractTimeMs(r);
    if (typeof sc === "number") {
      weekdayScoreSum[wd] += sc;
      weekdayScoreCount[wd]++;
      hourScoreSum[hr] += sc;
      hourScoreCount[hr]++;
    }
    if (typeof tm === "number") {
      weekdayTimeSum[wd] += tm;
      weekdayTimeCount[wd]++;
      hourTimeSum[hr] += tm;
      hourTimeCount[hr]++;
    }
  }
  const wdNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekdayAvgScore = wdNames.map((name, i) => ({
    name,
    value: weekdayScoreCount[i] ? weekdayScoreSum[i] / weekdayScoreCount[i] : -Infinity
  }));
  const weekdayAvgTime = wdNames.map((name, i) => ({
    name,
    value: weekdayTimeCount[i] ? weekdayTimeSum[i] / weekdayTimeCount[i] / 1e3 : Infinity
  }));
  const hourAvgScore = hour.map((_, h) => ({
    hour: h,
    value: hourScoreCount[h] ? hourScoreSum[h] / hourScoreCount[h] : -Infinity
  }));
  const hourAvgTime = hour.map((_, h) => ({
    hour: h,
    value: hourTimeCount[h] ? hourTimeSum[h] / hourTimeCount[h] / 1e3 : Infinity
  }));
  const bestDayByScore = [...weekdayAvgScore].sort((a, b) => b.value - a.value)[0];
  const worstDayByScore = [...weekdayAvgScore].sort((a, b) => a.value - b.value)[0];
  const bestHourByScore = [...hourAvgScore].sort((a, b) => b.value - a.value)[0];
  const worstHourByScore = [...hourAvgScore].sort((a, b) => a.value - b.value)[0];
  const fastestDay = [...weekdayAvgTime].sort((a, b) => a.value - b.value)[0];
  const slowestDay = [...weekdayAvgTime].sort((a, b) => b.value - a.value)[0];
  const fastestHour = [...hourAvgTime].sort((a, b) => a.value - b.value)[0];
  const slowestHour = [...hourAvgTime].sort((a, b) => b.value - a.value)[0];
  sections.push({
    id: "time_patterns",
    title: "Time Patterns",
    group: "Overview",
    appliesFilters: ["date", "mode", "teammate"],
    lines: [
      `Best day by avg score: ${bestDayByScore?.name || "-"} (${fmt(bestDayByScore?.value, 1)})`,
      `Hardest day by avg score: ${worstDayByScore?.name || "-"} (${fmt(worstDayByScore?.value, 1)})`,
      `Best hour by avg score: ${bestHourByScore ? `${String(bestHourByScore.hour).padStart(2, "0")}:00` : "-"} (${fmt(bestHourByScore?.value, 1)})`,
      `Hardest hour by avg score: ${worstHourByScore ? `${String(worstHourByScore.hour).padStart(2, "0")}:00` : "-"} (${fmt(worstHourByScore?.value, 1)})`,
      `Fastest day (avg guess time): ${fastestDay?.name || "-"} (${fmt(fastestDay?.value, 1)} s)`,
      `Slowest day (avg guess time): ${slowestDay?.name || "-"} (${fmt(slowestDay?.value, 1)} s)`,
      `Fastest hour: ${fastestHour ? `${String(fastestHour.hour).padStart(2, "0")}:00` : "-"} (${fmt(fastestHour?.value, 1)} s)`,
      `Slowest hour: ${slowestHour ? `${String(slowestHour.hour).padStart(2, "0")}:00` : "-"} (${fmt(slowestHour?.value, 1)} s)`
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
        bars: hour.map((v, h) => ({ label: String(h).padStart(2, "0"), value: v }))
      }
    ]
  });

  const sessionGapMs = 45 * 60 * 1000;
  const sortedGameTimes = [...gameTimes].sort((a, b) => a - b);
  const gameSessionIndex = new Map<number, number>();
  let sessionIdx = -1;
  let prevTs: number | undefined;
  for (const ts of sortedGameTimes) {
    if (prevTs === undefined || ts - prevTs > sessionGapMs) sessionIdx++;
    gameSessionIndex.set(ts, sessionIdx);
    prevTs = ts;
  }
  const sessionsAgg = new Map<number, { rounds: number; scores: number[]; fiveK: number; throws: number; avgTimeSrc: number[] }>();
  for (const rm of roundMetrics) {
    const idx = gameSessionIndex.get(rm.ts);
    if (idx === undefined) continue;
    const cur = sessionsAgg.get(idx) || { rounds: 0, scores: [], fiveK: 0, throws: 0, avgTimeSrc: [] };
    cur.rounds++;
    cur.scores.push(rm.score);
    if (rm.score >= 5000) cur.fiveK++;
    if (rm.score < 50) cur.throws++;
    if (typeof rm.timeSec === "number") cur.avgTimeSrc.push(rm.timeSec);
    sessionsAgg.set(idx, cur);
  }
  const sessionRows = [...sessionsAgg.entries()]
    .map(([idx, s]) => ({
      idx,
      rounds: s.rounds,
      avgScore: avg(s.scores) || 0,
      fiveKRate: pct(s.fiveK, s.rounds),
      throwRate: pct(s.throws, s.rounds),
      avgTime: avg(s.avgTimeSrc)
    }))
    .sort((a, b) => b.avgScore - a.avgScore);
  sections.push({
    id: "session_quality",
    title: "Session Quality",
    group: "Performance",
    appliesFilters: ["date", "mode", "teammate", "country"],
    lines: [
      `Sessions detected (gap >45m): ${sessionRows.length}`,
      ...sessionRows.slice(0, 3).map((s, i) => `${i + 1}. Session #${s.idx + 1}: avg score ${fmt(s.avgScore, 1)} | 5k ${fmt(s.fiveKRate, 1)}% | throw ${fmt(s.throwRate, 1)}% | avg time ${fmt(s.avgTime, 1)}s`),
      ...sessionRows.slice(-2).map((s) => `Low session #${s.idx + 1}: avg score ${fmt(s.avgScore, 1)} | 5k ${fmt(s.fiveKRate, 1)}% | throw ${fmt(s.throwRate, 1)}%`)
    ],
    charts: [
      {
        type: "bar",
        yLabel: "Avg score by session",
        bars: sessionRows.slice(0, 20).map((s) => ({ label: `S${s.idx + 1}`, value: s.avgScore }))
      },
      {
        type: "bar",
        yLabel: "Throw rate % by session",
        bars: sessionRows.slice(0, 20).map((s) => ({ label: `S${s.idx + 1}`, value: s.throwRate }))
      }
    ]
  });

  const tempoBuckets = [
    { name: "0-10s", min: 0, max: 10 },
    { name: "10-20s", min: 10, max: 20 },
    { name: "20-30s", min: 20, max: 30 },
    { name: "30-45s", min: 30, max: 45 },
    { name: "45-60s", min: 45, max: 60 },
    { name: "60-90s", min: 60, max: 90 },
    { name: "90s+", min: 90, max: Infinity }
  ];
  const tempoAgg = tempoBuckets.map((b) => ({ ...b, n: 0, scores: [] as number[], dist: [] as number[] }));
  for (const rm of roundMetrics) {
    if (typeof rm.timeSec !== "number") continue;
    const bucket = tempoAgg.find((b) => rm.timeSec >= b.min && rm.timeSec < b.max);
    if (!bucket) continue;
    bucket.n++;
    bucket.scores.push(rm.score);
    if (typeof rm.distKm === "number") bucket.dist.push(rm.distKm);
  }
  sections.push({
    id: "tempo_vs_quality",
    title: "Tempo vs Quality",
    group: "Performance",
    appliesFilters: ["date", "mode", "teammate", "country"],
    lines: [
      ...tempoAgg.map((b) => `${b.name}: n=${b.n} | avg score ${fmt(avg(b.scores), 1)} | avg distance ${fmt(avg(b.dist), 2)} km`)
    ],
    charts: [
      {
        type: "bar",
        yLabel: "Avg score by guess-time bucket",
        bars: tempoAgg.map((b) => ({ label: b.name, value: avg(b.scores) || 0 }))
      },
      {
        type: "bar",
        yLabel: "Avg distance km by guess-time bucket",
        bars: tempoAgg.map((b) => ({ label: b.name, value: avg(b.dist) || 0 }))
      }
    ]
  });

  const nearPerfectCount = roundMetrics.filter((x) => x.score >= 4500).length;
  const lowScoreCount = roundMetrics.filter((x) => x.score < 500).length;
  sections.push({
    id: "score_extremes",
    title: "Score Extremes",
    group: "Performance",
    appliesFilters: ["date", "mode", "teammate", "country"],
    lines: [
      `Perfect 5k: ${fiveKCount} (${fmt(pct(fiveKCount, roundMetrics.length), 1)}%)`,
      `Near-perfect (>=4500): ${nearPerfectCount} (${fmt(pct(nearPerfectCount, roundMetrics.length), 1)}%)`,
      `Low scores (<500): ${lowScoreCount} (${fmt(pct(lowScoreCount, roundMetrics.length), 1)}%)`,
      `Throws (<50): ${throwCount} (${fmt(pct(throwCount, roundMetrics.length), 1)}%)`
    ],
    chart: {
      type: "bar",
      yLabel: "Rounds count",
      bars: [
        { label: "5k", value: fiveKCount },
        { label: ">=4500", value: nearPerfectCount },
        { label: "<500", value: lowScoreCount },
        { label: "Throw <50", value: throwCount }
      ]
    }
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

    const guess = normalizeCountryCode(getString(asRecord(r), "p1_guessCountry"));
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
  const bestHitRate = [...scoredCountries].filter((x) => x.n >= 8).sort((a, b) => b.hitRate - a.hitRate)[0];
  const avgScoreRankPoints = [...scoredCountries]
    .sort((a, b) => b.avgScore - a.avgScore)
    .map((x, idx) => ({ x: idx + 1, y: x.avgScore, label: countryLabel(x.country) }));

  sections.push({
    id: "country_stats",
    title: "Country Stats",
    group: "Countries",
    appliesFilters: ["date", "mode", "teammate", "country"],
    lines: [
      `Best avg-score country: ${bestCountries[0] ? `${countryLabel(bestCountries[0].country)} (${fmt(bestCountries[0].avgScore, 1)})` : "-"}`,
      `Hardest avg-score country: ${worstCountries[0] ? `${countryLabel(worstCountries[0].country)} (${fmt(worstCountries[0].avgScore, 1)})` : "-"}`,
      `Highest hit-rate country (min 8 rounds): ${bestHitRate ? `${countryLabel(bestHitRate.country)} (${fmt(bestHitRate.hitRate * 100, 1)}%)` : "-"}`
    ],
    charts: [
      {
        type: "bar",
        yLabel: "Rounds",
        bars: topCountries.slice(0, 24).map(([c, v]) => ({ label: countryLabel(c), value: v.n }))
      },
      {
        type: "line",
        yLabel: "Avg score by country rank",
        points: avgScoreRankPoints
      }
    ]
  });

  const confusionMap = new Map<string, number>();
  for (const r of teamRounds) {
    const truth = normalizeCountryCode(r.trueCountry);
    const guess = normalizeCountryCode(getString(asRecord(r), "p1_guessCountry"));
    if (!truth || !guess || truth === guess) continue;
    const key = `${truth}|${guess}`;
    confusionMap.set(key, (confusionMap.get(key) || 0) + 1);
  }
  const confusions = [...confusionMap.entries()]
    .map(([k, n]) => {
      const [truth, guess] = k.split("|");
      return { truth, guess, n };
    })
    .sort((a, b) => b.n - a.n);
  const confusionRows = [...new Set(confusions.map((x) => x.truth))].slice(0, 10).map((truth) => {
    const row = confusions.filter((x) => x.truth === truth).slice(0, 3);
    return `${countryLabel(truth)} -> ${row.map((r) => `${countryLabel(r.guess)} (${r.n})`).join(", ")}`;
  });
  sections.push({
    id: "country_confusions",
    title: "Country Confusion Matrix (Top)",
    group: "Countries",
    appliesFilters: ["date", "mode", "teammate"],
    lines: [
      selectedCountry
        ? "Country filter is ignored here to reveal global confusion patterns in your selected date/mode/team scope."
        : "Top confusion rows (true country -> most common wrong guesses):",
      ...confusionRows
    ],
    chart: {
      type: "bar",
      yLabel: "Top confusion pairs",
      bars: confusions.slice(0, 20).map((x) => ({
        label: `${countryLabel(x.truth)} -> ${countryLabel(x.guess)}`,
        value: x.n
      }))
    }
  });

  const opponentCounts = new Map<string, { games: number; name?: string; country?: string }>();
  for (const d of teamDetails) {
    const dd = asRecord(d);
    const ids: Array<{ id?: string; name?: string; country?: string }> = [];
    const modeFamily = getString(dd, "modeFamily");
    if (modeFamily === "duels") {
      ids.push({
        id: getString(dd, "playerTwoId") ?? getString(dd, "p2_playerId"),
        name: getString(dd, "playerTwoName"),
        country: getString(dd, "playerTwoCountry")
      });
    } else if (modeFamily === "teamduels") {
      ids.push({
        id: getString(dd, "teamTwoPlayerOneId"),
        name: getString(dd, "teamTwoPlayerOneName"),
        country: getString(dd, "teamTwoPlayerOneCountry")
      });
      ids.push({
        id: getString(dd, "teamTwoPlayerTwoId"),
        name: getString(dd, "teamTwoPlayerTwoName"),
        country: getString(dd, "teamTwoPlayerTwoCountry")
      });
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

  const topOpp = [...opponentCounts.entries()].sort((a, b) => b[1].games - a[1].games).slice(0, 20);
  const oppCountryCounts = new Map<string, number>();
  for (const [, v] of topOpp) {
    const c = typeof v.country === "string" && v.country.trim() ? v.country.trim() : "Unknown";
    oppCountryCounts.set(c, (oppCountryCounts.get(c) || 0) + v.games);
  }

  sections.push({
    id: "opponents",
    title: "Most Frequent Opponents",
    group: "Opponents",
    appliesFilters: ["date", "mode", "teammate"],
    lines: [
      selectedCountry ? `Country filter is ignored here (showing all countries for selected time/mode/team).` : "",
      "Top 3 opponents:",
      ...topOpp.slice(0, 3).map(([id, v], i) => `${i + 1}. ${v.name || id.slice(0, 8)}: ${v.games} meetings${v.country ? ` (${v.country})` : ""}`),
      `Unique opponents in scope: ${opponentCounts.size}`
    ].filter((x) => x !== ""),
    chart: {
      type: "bar",
      yLabel: "Meetings by opponent country",
      bars: [...oppCountryCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([c, n]) => ({ label: c, value: n }))
    }
  });

  const basePlayedAtByGameId = new Map(baseGames.map((g) => [g.gameId, g.playedAt]));
  const duelRatingTimeline = baseDetails
    .filter((d) => getString(asRecord(d), "modeFamily") === "duels")
    .map((d) => {
      const ts = basePlayedAtByGameId.get(d.gameId);
      const r = extractOwnDuelRating(d, ownPlayerId);
      return ts && typeof r?.end === "number" ? { x: ts, y: r.end, label: formatDay(ts) } : undefined;
    })
    .filter((x): x is { x: number; y: number; label: string } => !!x)
    .sort((a, b) => a.x - b.x);

  const teammateRatingTimeline =
    selectedTeammate && teammateGames.get(selectedTeammate)
      ? baseDetails
          .filter((d) => getString(asRecord(d), "modeFamily") === "teamduels" && (teammateGames.get(selectedTeammate)?.has(d.gameId) || false))
          .map((d) => {
            const ts = basePlayedAtByGameId.get(d.gameId);
            const r = extractOwnTeamRating(d, ownPlayerId);
            return ts && typeof r?.end === "number" ? { x: ts, y: r.end, label: formatDay(ts) } : undefined;
          })
          .filter((x): x is { x: number; y: number; label: string } => !!x)
          .sort((a, b) => a.x - b.x)
      : [];

  const duelDelta =
    duelRatingTimeline.length > 1 ? duelRatingTimeline[duelRatingTimeline.length - 1].y - duelRatingTimeline[0].y : undefined;
  const teammateDelta =
    teammateRatingTimeline.length > 1
      ? teammateRatingTimeline[teammateRatingTimeline.length - 1].y - teammateRatingTimeline[0].y
      : undefined;
  const ratingPoints = selectedTeammate ? teammateRatingTimeline : duelRatingTimeline;
  const ratingDelta = selectedTeammate ? teammateDelta : duelDelta;
  const ratingTitle = selectedTeammate
    ? `Rating History: Team Duels with ${nameMap.get(selectedTeammate) || selectedTeammate.slice(0, 8)}`
    : "Rating History: Duels";
  sections.push({
    id: "rating_history",
    title: ratingTitle,
    group: "Rating",
    appliesFilters: ["date", "mode", "teammate"],
    lines: [
      `Samples: ${ratingPoints.length}`,
      ratingDelta !== undefined ? `Trend: ${ratingDelta >= 0 ? "+" : ""}${fmt(ratingDelta, 0)}` : "Trend: -",
      selectedTeammate
        ? `Scope: teamduels filtered to selected teammate`
        : `Scope: duels only`
    ],
    charts: ratingPoints.length > 1 ? [{ type: "line", yLabel: "Rating", points: ratingPoints }] : undefined
  });

  const sessions = sessionRows.length;
  const longest = sessionRows.length ? Math.max(...sessionRows.map((s) => s.rounds)) : 0;
  const longestBreakMs = sortedGameTimes.slice(1).reduce((mx, ts, i) => Math.max(mx, ts - sortedGameTimes[i]), 0);

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
    let myScoreTotal = 0;
    let mateScoreTotal = 0;
    let myScoreCount = 0;
    let mateScoreCount = 0;
    let myDistTotal = 0;
    let mateDistTotal = 0;
    let myDistCount = 0;
    let mateDistCount = 0;

    for (const r of compareRounds) {
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
      } else if (result < 0) {
        mateWins++;
      } else {
        ties++;
      }

      if (typeof mine.score === "number") {
        myScoreTotal += mine.score;
        myScoreCount++;
      }
      if (typeof mate.score === "number") {
        mateScoreTotal += mate.score;
        mateScoreCount++;
      }
      if (typeof mine.distanceKm === "number") {
        myDistTotal += mine.distanceKm;
        myDistCount++;
      }
      if (typeof mate.distanceKm === "number") {
        mateDistTotal += mate.distanceKm;
        mateDistCount++;
      }
    }

    const mateName = nameMap.get(teammateToUse) || teammateToUse.slice(0, 8);
    sections.push({
      id: "teammate_battle",
      title: `Teammate Battle: You vs ${mateName}`,
      group: "Performance",
      appliesFilters: ["date", "mode", "teammate", "country"],
      lines: [
        `Compared rounds: ${compareRounds.length}`,
        `You better guess: ${myWins} rounds`,
        `${mateName} better guess: ${mateWins} rounds`,
        `Tie rounds: ${ties}`,
        `Edge: ${myWins - mateWins >= 0 ? "+" : ""}${myWins - mateWins}`,
        `Avg score: you ${myScoreCount ? fmt(myScoreTotal / myScoreCount, 1) : "-"} vs ${mateName} ${
          mateScoreCount ? fmt(mateScoreTotal / mateScoreCount, 1) : "-"
        }`,
        `Avg distance: you ${myDistCount ? fmt(myDistTotal / myDistCount, 2) : "-"} km vs ${mateName} ${
          mateDistCount ? fmt(mateDistTotal / mateDistCount, 2) : "-"
        } km`
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
    const countryScores = countryRounds.map(extractScore).filter((x): x is number => typeof x === "number");
    const countryFiveK = countryScores.filter((s) => s >= 5000).length;
    const countryThrows = countryScores.filter((s) => s < 50).length;
    const distributionBuckets = [
      { label: "0-49", min: 0, max: 50 },
      { label: "50-499", min: 50, max: 500 },
      { label: "500-999", min: 500, max: 1000 },
      { label: "1000-1999", min: 1000, max: 2000 },
      { label: "2000-2999", min: 2000, max: 3000 },
      { label: "3000-3999", min: 3000, max: 4000 },
      { label: "4000-4999", min: 4000, max: 5000 },
      { label: "5000", min: 5000, max: Infinity }
    ];
    const distributionBars = distributionBuckets.map((b) => ({
      label: b.label,
      value: countryScores.filter((s) => s >= b.min && s < b.max).length
    }));
    const scoreTimeline: Array<{ x: number; y: number; label: string }> = [];
    for (const r of countryRounds) {
      const playedAt = playedAtByGameId.get(r.gameId);
      const s = extractScore(r);
      if (!playedAt || typeof s !== "number") continue;
      scoreTimeline.push({ x: playedAt, y: s, label: formatDay(playedAt) });
    }
    scoreTimeline.sort((a, b) => a.x - b.x);

    sections.push({
      id: "country_spotlight",
      title: `Country Spotlight: ${countryFlagEmoji(spotlightCountry)} ${countryLabel(spotlightCountry)}`,
      group: "Countries",
      appliesFilters: ["date", "mode", "teammate", "country"],
      lines: [
        `Rounds: ${agg.n}`,
        `Hit rate: ${fmt((agg.n > 0 ? agg.correct / agg.n : 0) * 100, 1)}%`,
        `Avg score: ${fmt(avg(agg.score), 1)} | Median score: ${fmt(median(agg.score), 1)}`,
        `Avg distance: ${fmt(avg(agg.dist), 2)} km`,
        `Perfect 5k in this country: ${countryFiveK} (${fmt(pct(countryFiveK, countryScores.length), 1)}%)`,
        `Throws (<50) in this country: ${countryThrows} (${fmt(pct(countryThrows, countryScores.length), 1)}%)`,
        wrongGuesses.length > 0 ? "Most common wrong guesses:" : "No wrong guess data.",
        ...wrongGuesses.map(([g, n]) => `${countryLabel(g)}: ${n}`)
      ],
      charts: [
        {
          type: "line",
          yLabel: "Score",
          points: scoreTimeline
        },
        {
          type: "bar",
          yLabel: "Score distribution",
          bars: distributionBars
        },
        {
          type: "bar",
          yLabel: "Wrong guesses",
          bars: wrongGuesses.map(([g, n]) => ({ label: countryLabel(g), value: n }))
        }
      ]
    });
  }

  const scoresByDay = new Map<number, number[]>();
  const timesByDay = new Map<number, number[]>();
  for (const rm of roundMetrics) {
    const s = scoresByDay.get(rm.day) || [];
    s.push(rm.score);
    scoresByDay.set(rm.day, s);
    if (typeof rm.timeSec === "number") {
      const t = timesByDay.get(rm.day) || [];
      t.push(rm.timeSec);
      timesByDay.set(rm.day, t);
    }
  }
  const dayRecords = [...scoresByDay.entries()].map(([day, vals]) => ({
    day,
    avgScore: avg(vals) || 0,
    rounds: vals.length,
    avgTime: avg(timesByDay.get(day) || [])
  }));
  const bestDay = [...dayRecords].sort((a, b) => b.avgScore - a.avgScore)[0];
  const worstDay = [...dayRecords].sort((a, b) => a.avgScore - b.avgScore)[0];
  const fastestDayRecord = [...dayRecords].filter((d) => typeof d.avgTime === "number").sort((a, b) => (a.avgTime || 0) - (b.avgTime || 0))[0];
  const slowestDayRecord = [...dayRecords].filter((d) => typeof d.avgTime === "number").sort((a, b) => (b.avgTime || 0) - (a.avgTime || 0))[0];
  let fivekStreak = 0;
  let bestFivekStreak = 0;
  let throwStreak = 0;
  let worstThrowStreak = 0;
  for (const s of roundMetrics.map((x) => x.score)) {
    if (s >= 5000) {
      fivekStreak++;
      bestFivekStreak = Math.max(bestFivekStreak, fivekStreak);
    } else {
      fivekStreak = 0;
    }
    if (s < 50) {
      throwStreak++;
      worstThrowStreak = Math.max(worstThrowStreak, throwStreak);
    } else {
      throwStreak = 0;
    }
  }
  sections.push({
    id: "personal_records",
    title: "Personal Records",
    group: "Performance",
    appliesFilters: ["date", "mode", "teammate", "country"],
    lines: [
      `Best day: ${bestDay ? `${formatDay(bestDay.day)} (avg ${fmt(bestDay.avgScore, 1)}, n=${bestDay.rounds})` : "-"}`,
      `Hardest day: ${worstDay ? `${formatDay(worstDay.day)} (avg ${fmt(worstDay.avgScore, 1)}, n=${worstDay.rounds})` : "-"}`,
      `Fastest day: ${fastestDayRecord ? `${formatDay(fastestDayRecord.day)} (${fmt(fastestDayRecord.avgTime, 1)} s)` : "-"}`,
      `Slowest day: ${slowestDayRecord ? `${formatDay(slowestDayRecord.day)} (${fmt(slowestDayRecord.avgTime, 1)} s)` : "-"}`,
      `Best 5k streak: ${bestFivekStreak} rounds in a row`,
      `Worst throw streak (<50): ${worstThrowStreak} rounds in a row`
    ],
    chart: {
      type: "line",
      yLabel: "Avg daily score",
      points: dayRecords.sort((a, b) => a.day - b.day).map((d) => ({ x: d.day, y: d.avgScore, label: formatDay(d.day) }))
    }
  });

  const bestMode = [...modeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "-";
  const topCountry = topCountries[0]?.[0];
  const avgScoreAll = avg(scores);
  const p90Score =
    scores.length > 0
      ? [...scores].sort((a, b) => a - b)[Math.max(0, Math.min(scores.length - 1, Math.floor(scores.length * 0.9) - 1))]
      : undefined;
  sections.push({
    id: "fun_facts",
    title: "Fun Facts",
    group: "Fun",
    appliesFilters: ["date", "mode", "teammate", "country"],
    lines: [
      `Sessions (gap >45m): ${sessions} | longest session: ${longest} games`,
      `Longest break between games: ${fmt(longestBreakMs / (1000 * 60 * 60), 1)} hours`,
      `Most played mode: ${bestMode}`,
      `Most played country: ${topCountry ? countryLabel(topCountry) : "-"}`,
      `Top 10% score threshold: ${fmt(p90Score, 1)} points`,
      `Avg score per round: ${fmt(avgScoreAll, 1)}`,
      `Perfect 5k rounds: ${fiveKCount} (${fmt(pct(fiveKCount, roundMetrics.length), 1)}%)`,
      `Throws (<50): ${throwCount} (${fmt(pct(throwCount, roundMetrics.length), 1)}%)`,
      `Avg rounds per game: ${fmt(rounds.length / games.length, 2)}`,
      `Last 7-day activity snapshot:`,
      ...makeDayActivityLines(gameTimes, 7)
    ]
  });

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
