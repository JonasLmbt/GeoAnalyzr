import { db, FeedGameRow, RoundRow } from "./db";
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
  const v = avg(values.map((x) => (x - m) ** 2));
  return v === undefined ? undefined : Math.sqrt(v);
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

function extractDistance(r: RoundRow): number | undefined {
  if (typeof (r as any).p1_distanceKm === "number") return (r as any).p1_distanceKm * 1e3;
  if (typeof r.p1_distanceMeters === "number") return r.p1_distanceMeters;
  if (typeof r.distanceMeters === "number") return r.distanceMeters;
  return undefined;
}

function extractTime(r: RoundRow): number | undefined {
  if (typeof r.timeMs === "number") return r.timeMs;
  if (typeof r.durationSeconds === "number") return r.durationSeconds * 1e3;
  return undefined;
}

function extractP1DistanceKm(r: RoundRow): number | undefined {
  const km = (r as any).p1_distanceKm;
  if (typeof km === "number" && Number.isFinite(km)) return km;
  const m = extractDistance(r);
  return typeof m === "number" && Number.isFinite(m) ? m / 1e3 : undefined;
}

function makeAsciiBar(value: number, maxValue: number, width = 16): string {
  if (maxValue <= 0) return "-".repeat(width);
  const filled = Math.max(0, Math.min(width, Math.round(value / maxValue * width)));
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

function filterByGames(
  games: FeedGameRow[],
  rounds: RoundRow[],
  filter: { fromTs?: number; toTs?: number; mode?: string }
): { games: FeedGameRow[]; rounds: RoundRow[] } {
  const byTime = games.filter((g) => {
    if (filter.fromTs !== undefined && g.playedAt < filter.fromTs) return false;
    if (filter.toTs !== undefined && g.playedAt > filter.toTs) return false;
    if (filter.mode && filter.mode !== "all") {
      const m = g.gameMode || g.mode || "";
      if (m !== filter.mode) return false;
    }
    return true;
  });
  const gameSet = new Set(byTime.map((g) => g.gameId));
  return { games: byTime, rounds: rounds.filter((r) => gameSet.has(r.gameId)) };
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

export interface AnalysisSection {
  id: string;
  title: string;
  lines: string[];
  chart?: {
    type: "line";
    yLabel?: string;
    points: Array<{ x: number; y: number; label?: string }>;
  };
}

export interface AnalysisWindowData {
  sections: AnalysisSection[];
  availableModes: string[];
  minPlayedAt?: number;
  maxPlayedAt?: number;
}

export interface AnalysisFilter {
  fromTs?: number;
  toTs?: number;
  mode?: string;
}

export async function getDashboardData(): Promise<DashboardData> {
  const [games, rounds] = await Promise.all([
    db.games.orderBy("playedAt").toArray(),
    db.rounds.toArray()
  ]);
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
  for (const g of allGames) modeSet.add(g.gameMode || g.mode || "unknown");
  const availableModes = ["all", ...[...modeSet].sort((a, b) => a.localeCompare(b))];
  const minPlayedAt = allGames.length ? allGames[0].playedAt : undefined;
  const maxPlayedAt = allGames.length ? allGames[allGames.length - 1].playedAt : undefined;

  const filtered = filterByGames(allGames, allRounds, {
    fromTs: filter?.fromTs,
    toTs: filter?.toTs,
    mode: filter?.mode
  });

  const games = filtered.games;
  const rounds = filtered.rounds;
  const gameIdSet = new Set(games.map((g) => g.gameId));
  const details = allDetails.filter((d) => gameIdSet.has(d.gameId));
  const knownTotals = details
    .map((d) => d.totalRounds)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
  const avgRoundsFromTotals = knownTotals.length ? avg(knownTotals) : undefined;

  if (games.length === 0) {
    return {
      sections: [{ id: "empty", title: "Overview", lines: ["Keine Daten fuer den gewaehlten Filter."] }],
      availableModes,
      minPlayedAt,
      maxPlayedAt
    };
  }

  const sections: AnalysisSection[] = [];
  const gameTimes = games.map((g) => g.playedAt).sort((a, b) => a - b);
  const scores = rounds.map(extractScore).filter((v): v is number => v !== undefined);
  const distances = rounds.map(extractDistance).filter((v): v is number => v !== undefined);
  const timesMs = rounds.map(extractTime).filter((v): v is number => v !== undefined);

  sections.push({
    id: "overview",
    title: "Overview",
    lines: [
      `Range: ${new Date(gameTimes[0]).toLocaleString()} -> ${new Date(gameTimes[gameTimes.length - 1]).toLocaleString()}`,
      `Games: ${games.length}`,
      `Rounds: ${rounds.length}`,
      `Avg rounds/game (from detail totals): ${fmt(avgRoundsFromTotals, 2)} (${knownTotals.length}/${games.length} games with details)`
    ]
  });

  const modeMap = new Map<string, number>();
  for (const g of games) {
    const m = g.gameMode || g.mode || "unknown";
    modeMap.set(m, (modeMap.get(m) || 0) + 1);
  }
  sections.push({
    id: "modes",
    title: "Mode Breakdown",
    lines: [...modeMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([m, c]) => `${m}: ${c}`)
  });

  sections.push({
    id: "performance",
    title: "Performance",
    lines: [
      `Avg score: ${fmt(avg(scores), 1)} | Median: ${fmt(median(scores), 1)} | StdDev: ${fmt(stdDev(scores), 1)} | Samples: ${scores.length}`,
      `Avg distance (km): ${fmt(avg(distances) !== undefined ? avg(distances)! / 1e3 : undefined, 2)} | Median (km): ${fmt(median(distances) !== undefined ? median(distances)! / 1e3 : undefined, 2)} | Samples: ${distances.length}`,
      `Avg time (s): ${fmt(avg(timesMs) !== undefined ? avg(timesMs)! / 1e3 : undefined, 1)} | Median (s): ${fmt(median(timesMs) !== undefined ? median(timesMs)! / 1e3 : undefined, 1)} | Samples: ${timesMs.length}`
    ]
  });

  // Sessions
  const gapMs = 45 * 60 * 1000;
  let sessions = 0;
  let curSession = 0;
  let longest = 0;
  for (let i = 0; i < gameTimes.length; i++) {
    if (i === 0 || gameTimes[i] - gameTimes[i - 1] > gapMs) {
      sessions++;
      curSession = 1;
    } else {
      curSession++;
    }
    if (curSession > longest) longest = curSession;
  }
  sections.push({
    id: "sessions",
    title: "Sessions",
    lines: [
      `Sessions (gap >45m): ${sessions}`,
      `Avg games/session: ${fmt(games.length / Math.max(1, sessions), 2)}`,
      `Longest session: ${longest}`
    ]
  });

  // Time patterns
  const weekday = new Array(7).fill(0);
  const hour = new Array(24).fill(0);
  for (const ts of gameTimes) {
    const d = new Date(ts);
    weekday[d.getDay()]++;
    hour[d.getHours()]++;
  }
  const wdNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  sections.push({
    id: "time",
    title: "Time Patterns",
    lines: [
      "By weekday:",
      ...weekday.map((v, i) => `${wdNames[i]}: ${v}`),
      "Top hours:",
      ...hour
        .map((v, i) => ({ h: i, v }))
        .sort((a, b) => b.v - a.v)
        .slice(0, 6)
        .map((x) => `${String(x.h).padStart(2, "0")}:00 - ${x.v} games`)
    ]
  });

  // Duel-specific method
  const duelRounds = rounds.filter((r) => typeof r.p2_score === "number" && typeof r.p1_score === "number");
  if (duelRounds.length > 0) {
    const margins = duelRounds.map((r) => (r.p1_score || 0) - (r.p2_score || 0));
    const healCount = duelRounds.filter((r) => r.isHealingRound).length;
    const multRounds = duelRounds.filter((r) => (r.damageMultiplier || 1) > 1).length;
    sections.push({
      id: "duels",
      title: "Duel Analysis",
      lines: [
        `Rounds with both scores: ${duelRounds.length}`,
        `Avg score margin (p1-p2): ${fmt(avg(margins), 2)}`,
        `Healing rounds: ${healCount}`,
        `Damage-multiplier rounds: ${multRounds}`
      ]
    });

    const countryComparable = duelRounds.filter((r) => {
      const t = typeof r.trueCountry === "string" ? r.trueCountry.trim().toLowerCase() : "";
      const g = typeof r.p1_guessCountry === "string" ? r.p1_guessCountry.trim().toLowerCase() : "";
      return !!t && !!g;
    });

    const mismatchPairs = new Map<string, number>();
    for (const r of countryComparable) {
      const t = (r.trueCountry as string).trim().toLowerCase();
      const g = (r.p1_guessCountry as string).trim().toLowerCase();
      if (t === g) continue;
      const key = `${t}->${g}`;
      mismatchPairs.set(key, (mismatchPairs.get(key) || 0) + 1);
    }
    const topConfusions = [...mismatchPairs.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([pair, count]) => {
        const [t, g] = pair.split("->");
        return `${t} -> ${g}: ${count} times`;
      });
    sections.push({
      id: "duel_confusions",
      title: "Duel Most Confused Countries (p1)",
      lines: topConfusions.length > 0 ? topConfusions : ["No confusion pairs available."]
    });

    type CountryAgg = { sumScore: number; sumDistKm: number; nScore: number; nDist: number; total: number; correct: number };
    const perCountry = new Map<string, CountryAgg>();
    for (const r of duelRounds) {
      const t = typeof r.trueCountry === "string" ? r.trueCountry.trim().toLowerCase() : "";
      if (!t) continue;
      const guess = typeof r.p1_guessCountry === "string" ? r.p1_guessCountry.trim().toLowerCase() : "";
      const score = typeof r.p1_score === "number" ? r.p1_score : undefined;
      const distKm = extractP1DistanceKm(r);
      const agg = perCountry.get(t) || { sumScore: 0, sumDistKm: 0, nScore: 0, nDist: 0, total: 0, correct: 0 };
      agg.total++;
      if (guess && guess === t) agg.correct++;
      if (typeof score === "number" && Number.isFinite(score)) {
        agg.sumScore += score;
        agg.nScore++;
      }
      if (typeof distKm === "number" && Number.isFinite(distKm)) {
        agg.sumDistKm += distKm;
        agg.nDist++;
      }
      perCountry.set(t, agg);
    }
    const countryRows = [...perCountry.entries()]
      .map(([country, a]) => ({
        country,
        avg_score: a.nScore > 0 ? a.sumScore / a.nScore : undefined,
        avg_distance: a.nDist > 0 ? a.sumDistKm / a.nDist : undefined,
        hit_rate: a.total > 0 ? a.correct / a.total : 0,
        samples: a.total
      }))
      .sort((a, b) => (b.avg_score || -Infinity) - (a.avg_score || -Infinity));
    sections.push({
      id: "duel_country_perf",
      title: "Duel Average Score/Distance/Hit Rate Per Country (p1)",
      lines: countryRows.length > 0
        ? countryRows.slice(0, 20).map((r) =>
            `${r.country}: score=${fmt(r.avg_score, 1)} | dist_km=${fmt(r.avg_distance, 2)} | hit_rate=${fmt(r.hit_rate * 100, 1)}% | n=${r.samples}`
          )
        : ["No country-level duel data available."]
    });
  }

  // Duel rating history (p1 end rating)
  const duelGameSet = new Set(
    games
      .filter((g) => {
        const fam = g.modeFamily;
        if (fam) return fam === "duels";
        const m = String(g.gameMode || g.mode || "").toLowerCase();
        return m.includes("duel") && !m.includes("team");
      })
      .map((g) => g.gameId)
  );
  const gameById = new Map(games.map((g) => [g.gameId, g]));
  const ratingPoints = details
    .map((d) => {
      if (!duelGameSet.has(d.gameId)) return undefined;
      const g = gameById.get(d.gameId);
      if (!g) return undefined;
      const after = (d as any).playerOneEndRating ?? (d as any).p1_ratingAfter;
      const before = (d as any).playerOneStartRating ?? (d as any).p1_ratingBefore;
      if (after === undefined && before === undefined) return undefined;
      return {
        t: g.playedAt,
        before,
        after
      };
    })
    .filter((x): x is { t: number; before?: number; after?: number } => !!x)
    .sort((a, b) => a.t - b.t);

  if (ratingPoints.length > 0) {
    const afterVals = ratingPoints.map((r) => r.after).filter((v): v is number => v !== undefined);
    const first = ratingPoints[0];
    const last = ratingPoints[ratingPoints.length - 1];
    const lastLines = ratingPoints.slice(-20).map((p) => {
      const d = formatDay(p.t);
      const b = p.before !== undefined ? p.before.toFixed(0) : "-";
      const a = p.after !== undefined ? p.after.toFixed(0) : "-";
      const diff = p.before !== undefined && p.after !== undefined ? (p.after - p.before).toFixed(0) : "-";
      return `${d}: ${b} -> ${a} (${diff})`;
    });
    sections.push({
      id: "rating_duels",
      title: "Duels Rating History (p1 end rating)",
      lines: [
        `Samples: ${ratingPoints.length}`,
        `Current rating: ${last.after !== undefined ? last.after.toFixed(0) : "-"}`,
        `First rating: ${first.before !== undefined ? first.before.toFixed(0) : "-"}`,
        `Min/Max (after): ${afterVals.length ? Math.min(...afterVals).toFixed(0) : "-"} / ${afterVals.length ? Math.max(...afterVals).toFixed(0) : "-"}`,
        "Recent points:",
        ...lastLines
      ],
      chart: {
        type: "line",
        yLabel: "Rating",
        points: ratingPoints
          .filter((p) => p.after !== undefined)
          .map((p) => ({ x: p.t, y: p.after as number, label: formatDay(p.t) }))
      }
    });
  }

  sections.push({
    id: "activity14d",
    title: "Activity (14d)",
    lines: makeDayActivityLines(gameTimes, 14)
  });

  return { sections, availableModes, minPlayedAt, maxPlayedAt };
}

export async function getAnalysisReport(): Promise<string[]> {
  const d = await getDashboardData();
  return d.reportLines;
}
