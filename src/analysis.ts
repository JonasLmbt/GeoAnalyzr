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
  const countryDetails = teamDetails.filter((d) => countryGameSet.has(d.gameId));

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
  const details = countryDetails;

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
    group: "Overview",
    appliesFilters: ["date", "mode"],
    lines: [...modeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([m, c]) => `${m}: ${c}`),
    chart: {
      type: "bar",
      yLabel: "Games",
      bars: [...modeCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 16)
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
    group: "Overview",
    appliesFilters: ["date", "mode", "teammate"],
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
        bars: hour.map((v, h) => ({ label: String(h).padStart(2, "0"), value: v }))
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

  sections.push({
    id: "country_stats",
    title: "Country Stats",
    group: "Countries",
    appliesFilters: ["date", "mode", "teammate", "country"],
    lines: [
      "Most played countries:",
      ...topCountries.slice(0, 10).map(([c, v]) => `${countryLabel(c)}: ${v.n} rounds`),
      "Best avg-score countries (min 4 rounds):",
      ...bestCountries.map((x) => `${countryLabel(x.country)}: score ${fmt(x.avgScore, 1)} | hit ${fmt(x.hitRate * 100, 1)}% | n=${x.n}`),
      "Hardest avg-score countries (min 4 rounds):",
      ...worstCountries.map((x) => `${countryLabel(x.country)}: score ${fmt(x.avgScore, 1)} | hit ${fmt(x.hitRate * 100, 1)}% | n=${x.n}`)
    ],
    charts: [
      {
        type: "bar",
        yLabel: "Rounds",
        bars: topCountries.slice(0, 24).map(([c, v]) => ({ label: countryLabel(c), value: v.n }))
      },
      {
        type: "bar",
        yLabel: "Avg score",
        bars: [...scoredCountries]
          .sort((a, b) => b.avgScore - a.avgScore)
          .slice(0, 16)
          .map((x) => ({ label: countryLabel(x.country), value: x.avgScore }))
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
  sections.push({
    id: "country_confusions",
    title: "Most Confused Country Pairs",
    group: "Countries",
    appliesFilters: ["date", "mode", "teammate"],
    lines: [
      selectedCountry
        ? "Country filter is ignored here to reveal global confusion patterns in your selected date/mode/team scope."
        : "Most frequent wrong guess directions (true country -> guessed country).",
      ...confusions.slice(0, 20).map((x) => `${countryLabel(x.truth)} -> ${countryLabel(x.guess)}: ${x.n}`)
    ],
    chart: {
      type: "bar",
      yLabel: "Wrong guesses",
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

  const topOpp = [...opponentCounts.entries()].sort((a, b) => b[1].games - a[1].games).slice(0, 12);
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
      ...topOpp.map(([id, v]) => `${v.name || id.slice(0, 8)}: ${v.games} meetings${v.country ? ` (${v.country})` : ""}`),
      "Opponent countries:",
      ...[...oppCountryCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, n]) => `${c}: ${n}`)
    ].filter((x) => x !== ""),
    chart: {
      type: "bar",
      yLabel: "Meetings",
      bars: topOpp.slice(0, 24).map(([id, v]) => ({ label: (v.name || id.slice(0, 6)).slice(0, 20), value: v.games }))
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

  const teamRatingTimeline = baseDetails
    .filter((d) => getString(asRecord(d), "modeFamily") === "teamduels")
    .map((d) => {
      const ts = basePlayedAtByGameId.get(d.gameId);
      const r = extractOwnTeamRating(d, ownPlayerId);
      return ts && typeof r?.end === "number" ? { x: ts, y: r.end, label: formatDay(ts) } : undefined;
    })
    .filter((x): x is { x: number; y: number; label: string } => !!x)
    .sort((a, b) => a.x - b.x);

  const teammateForRating = selectedTeammate || [...teammateGames.entries()].sort((a, b) => b[1].size - a[1].size)[0]?.[0];
  const teammateRatingTimeline =
    teammateForRating && teammateGames.get(teammateForRating)
      ? baseDetails
          .filter((d) => getString(asRecord(d), "modeFamily") === "teamduels" && (teammateGames.get(teammateForRating)?.has(d.gameId) || false))
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
  const teamDelta =
    teamRatingTimeline.length > 1 ? teamRatingTimeline[teamRatingTimeline.length - 1].y - teamRatingTimeline[0].y : undefined;
  const teammateDelta =
    teammateRatingTimeline.length > 1
      ? teammateRatingTimeline[teammateRatingTimeline.length - 1].y - teammateRatingTimeline[0].y
      : undefined;

  sections.push({
    id: "rating_history",
    title: "Rating History",
    group: "Rating",
    appliesFilters: ["date", "mode", "teammate"],
    lines: [
      `Duels samples: ${duelRatingTimeline.length}${duelDelta !== undefined ? ` | trend: ${duelDelta >= 0 ? "+" : ""}${fmt(duelDelta, 0)}` : ""}`,
      `Team Duels samples: ${teamRatingTimeline.length}${teamDelta !== undefined ? ` | trend: ${teamDelta >= 0 ? "+" : ""}${fmt(teamDelta, 0)}` : ""}`,
      teammateForRating
        ? `Selected teammate scope (${nameMap.get(teammateForRating) || teammateForRating.slice(0, 8)}): ${teammateRatingTimeline.length} samples${
            teammateDelta !== undefined ? ` | trend: ${teammateDelta >= 0 ? "+" : ""}${fmt(teammateDelta, 0)}` : ""
          }`
        : "No teammate-specific rating scope available."
    ],
    charts: [
      { type: "line", yLabel: "Rating", points: duelRatingTimeline },
      { type: "line", yLabel: "Rating", points: teamRatingTimeline },
      { type: "line", yLabel: "Rating", points: teammateRatingTimeline }
    ]
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
    group: "Fun",
    appliesFilters: ["date", "mode", "teammate", "country"],
    lines: [
      `Current streak depth (last 14d activity bars):`,
      ...makeDayActivityLines(gameTimes, 14).slice(-7),
      `Sessions (gap >45m): ${sessions} | longest session: ${longest} games`,
      `Longest break between games: ${fmt(longestBreakMs / (1000 * 60 * 60), 1)} hours`,
      `Most played mode: ${[...modeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "-"}`,
      `Most played country: ${topCountries[0] ? countryLabel(topCountries[0][0]) : "-"}`
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
      group: "Performance",
      appliesFilters: ["date", "mode", "teammate", "country"],
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
          yLabel: "Wrong guesses",
          bars: wrongGuesses.map(([g, n]) => ({ label: countryLabel(g), value: n }))
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
