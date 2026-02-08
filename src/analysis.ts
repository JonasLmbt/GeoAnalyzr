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

function getBoolean(rec: UnknownRecord, key: string): boolean | undefined {
  const v = rec[key];
  return typeof v === "boolean" ? v : undefined;
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
  return `${day}/${m}/${y}`;
}

function formatShortDateTime(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${m}/${y} ${hh}:${mm}`;
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

function formatDurationHuman(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "-";
  const totalMinutes = Math.round(ms / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function buildSmoothedScoreDistribution(scores: number[], bucketSize = 100): Array<{ label: string; value: number }> {
  if (scores.length === 0) return [];
  const maxScore = 5000;
  const bucketCount = Math.ceil((maxScore + 1) / bucketSize);
  const buckets = new Array(bucketCount).fill(0);
  for (const sRaw of scores) {
    const s = Math.max(0, Math.min(maxScore, sRaw));
    const idx = Math.min(bucketCount - 1, Math.floor(s / bucketSize));
    buckets[idx]++;
  }
  const weights = [1, 2, 3, 2, 1];
  const radius = Math.floor(weights.length / 2);
  const smoothed = buckets.map((_, i) => {
    let weighted = 0;
    let weightSum = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j < 0 || j >= buckets.length) continue;
      const w = weights[k + radius];
      weighted += buckets[j] * w;
      weightSum += w;
    }
    return weightSum ? weighted / weightSum : 0;
  });
  return smoothed.map((v, i) => {
    const start = i * bucketSize;
    const end = Math.min(maxScore, start + bucketSize - 1);
    return { label: `${start}-${end}`, value: v };
  });
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

type GameModeKey = "duels" | "teamduels" | "other";

function normalizeGameModeKey(raw: string | undefined): GameModeKey {
  const s = (raw || "").trim().toLowerCase();
  if (s === "duels" || s === "duel") return "duels";
  if (s === "teamduels" || s === "team_duels" || s === "team duel" || s === "teamduel") return "teamduels";
  return "other";
}

function gameModeLabel(mode: string): string {
  const key = normalizeGameModeKey(mode);
  if (key === "duels") return "Duel";
  if (key === "teamduels") return "Team Duel";
  return mode;
}

type MovementTypeKey = "moving" | "no_move" | "nmpz" | "unknown";

function normalizeMovementType(raw: unknown): MovementTypeKey {
  if (typeof raw !== "string") return "unknown";
  const s = raw.trim().toLowerCase();
  if (!s) return "unknown";
  if (s.includes("nmpz")) return "nmpz";
  if (s.includes("no move") || s.includes("no_move") || s.includes("nomove") || s.includes("no moving")) return "no_move";
  if (s.includes("moving")) return "moving";
  return "unknown";
}

function movementTypeLabel(kind: MovementTypeKey): string {
  if (kind === "moving") return "Moving";
  if (kind === "no_move") return "No Move";
  if (kind === "nmpz") return "NMPZ";
  return "Unknown";
}

function getMovementType(game: FeedGameRow, detail?: GameRow): MovementTypeKey {
  const d = asRecord(detail);
  const fromDetail = getString(d, "gameModeSimple");
  if (typeof fromDetail === "string" && fromDetail.trim()) return normalizeMovementType(fromDetail);
  return normalizeMovementType(game.gameMode);
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

type GameResult = "W" | "L" | "T";

function getRoundDamageDiff(round: RoundRow, ownPlayerId: string): number | undefined {
  const rr = asRecord(round);
  const modeFamily = getString(rr, "modeFamily");

  if (modeFamily === "duels") {
    const p1 = getString(rr, "p1_playerId");
    const p2 = getString(rr, "p2_playerId");
    const p1Score = getNumber(rr, "p1_score");
    const p2Score = getNumber(rr, "p2_score");
    if (typeof p1Score !== "number" || typeof p2Score !== "number") return undefined;
    if (ownPlayerId === p2) return p2Score - p1Score;
    if (ownPlayerId === p1 || !p1 || !p2) return p1Score - p2Score;
    return undefined;
  }

  if (modeFamily === "teamduels") {
    const own = getPlayerStatFromRound(round, ownPlayerId);
    if (!own?.teamId) return undefined;
    let ownTeamScore = 0;
    let ownTeamN = 0;
    let oppTeamScore = 0;
    let oppTeamN = 0;
    for (const slot of playerSlots(round)) {
      const pid = getString(rr, `p${slot}_playerId`);
      if (!pid) continue;
      const teamId = getString(rr, `p${slot}_teamId`);
      const score = getNumber(rr, `p${slot}_score`);
      if (typeof score !== "number" || !teamId) continue;
      if (teamId === own.teamId) {
        ownTeamScore += score;
        ownTeamN++;
      } else {
        oppTeamScore += score;
        oppTeamN++;
      }
    }
    if (!ownTeamN || !oppTeamN) return undefined;
    return ownTeamScore / ownTeamN - oppTeamScore / oppTeamN;
  }

  return undefined;
}

function getGameResult(detail: GameRow, ownPlayerId?: string): GameResult | undefined {
  const d = asRecord(detail);
  const modeFamily = getString(d, "modeFamily");

  if (modeFamily === "duels") {
    const p1 = getString(d, "playerOneId") ?? getString(d, "p1_playerId");
    const p2 = getString(d, "playerTwoId") ?? getString(d, "p2_playerId");
    const ownIsP2 = ownPlayerId && ownPlayerId === p2;
    const ownWin = ownIsP2 ? getBoolean(d, "playerTwoVictory") : getBoolean(d, "playerOneVictory");
    const oppWin = ownIsP2 ? getBoolean(d, "playerOneVictory") : getBoolean(d, "playerTwoVictory");
    if (typeof ownWin === "boolean") return ownWin ? "W" : "L";
    if (typeof oppWin === "boolean") return oppWin ? "L" : "W";

    const p1Hp = getNumber(d, "playerOneFinalHealth");
    const p2Hp = getNumber(d, "playerTwoFinalHealth");
    if (typeof p1Hp === "number" && typeof p2Hp === "number") {
      const ownHp = ownIsP2 ? p2Hp : p1Hp;
      const oppHp = ownIsP2 ? p1Hp : p2Hp;
      if (ownHp > oppHp) return "W";
      if (ownHp < oppHp) return "L";
      return "T";
    }
    if (!ownPlayerId && (p1 || p2)) return "T";
    return undefined;
  }

  if (modeFamily === "teamduels") {
    const t1p1 = getString(d, "teamOnePlayerOneId");
    const t1p2 = getString(d, "teamOnePlayerTwoId");
    const ownInTeamOne = ownPlayerId ? [t1p1, t1p2].includes(ownPlayerId) : true;

    const ownWin = ownInTeamOne ? getBoolean(d, "teamOneVictory") : getBoolean(d, "teamTwoVictory");
    const oppWin = ownInTeamOne ? getBoolean(d, "teamTwoVictory") : getBoolean(d, "teamOneVictory");
    if (typeof ownWin === "boolean") return ownWin ? "W" : "L";
    if (typeof oppWin === "boolean") return oppWin ? "L" : "W";

    const t1Hp = getNumber(d, "teamOneFinalHealth");
    const t2Hp = getNumber(d, "teamTwoFinalHealth");
    if (typeof t1Hp === "number" && typeof t2Hp === "number") {
      const ownHp = ownInTeamOne ? t1Hp : t2Hp;
      const oppHp = ownInTeamOne ? t2Hp : t1Hp;
      if (ownHp > oppHp) return "W";
      if (ownHp < oppHp) return "L";
      return "T";
    }
    return undefined;
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

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_GAP_MS = 45 * 60 * 1000;

function pickOverviewBucketMs(spanMs: number): number | undefined {
  const spanDays = spanMs / DAY_MS;
  if (spanDays > 900) return 30 * DAY_MS;
  if (spanDays > 540) return 14 * DAY_MS;
  if (spanDays > 180) return 7 * DAY_MS;
  return undefined;
}

function buildOverviewGamesSeries(timestamps: number[], fromTs: number, toTs: number, bucketMs?: number): Array<{ x: number; y: number; label?: string }> {
  if (!bucketMs) return toCountsByDay(timestamps);

  const dayCounts = new Map<number, number>();
  for (const ts of timestamps) {
    const day = startOfLocalDay(ts);
    dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
  }

  const startDay = startOfLocalDay(fromTs);
  const endDay = startOfLocalDay(toTs);
  const buckets = new Map<number, { sum: number; days: number; endDay: number }>();
  for (let day = startDay; day <= endDay; day += DAY_MS) {
    const key = Math.floor(day / bucketMs) * bucketMs;
    const cur = buckets.get(key) || { sum: 0, days: 0, endDay: day };
    cur.sum += dayCounts.get(day) || 0;
    cur.days += 1;
    cur.endDay = day;
    buckets.set(key, cur);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => ({ x: v.endDay, y: v.sum / Math.max(1, v.days), label: formatDay(v.endDay) }));
}

function buildOverviewAvgScoreSeries(
  values: Array<{ ts: number; value: number }>,
  bucketMs?: number
): Array<{ x: number; y: number; label?: string }> {
  const byDay = new Map<number, { sum: number; n: number }>();
  for (const v of values) {
    const day = startOfLocalDay(v.ts);
    const cur = byDay.get(day) || { sum: 0, n: 0 };
    cur.sum += v.value;
    cur.n += 1;
    byDay.set(day, cur);
  }

  if (!bucketMs) {
    return [...byDay.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([day, v]) => ({ x: day, y: v.sum / Math.max(1, v.n), label: formatDay(day) }));
  }

  const buckets = new Map<number, { sum: number; n: number; endDay: number }>();
  for (const [day, v] of byDay.entries()) {
    const key = Math.floor(day / bucketMs) * bucketMs;
    const cur = buckets.get(key) || { sum: 0, n: 0, endDay: day };
    cur.sum += v.sum;
    cur.n += v.n;
    cur.endDay = day;
    buckets.set(key, cur);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => ({ x: v.endDay, y: v.sum / Math.max(1, v.n), label: formatDay(v.endDay) }));
}

function smoothDailyScoreRecords(
  records: Array<{ day: number; avgScore: number; rounds: number }>
): { points: Array<{ x: number; y: number; label?: string }>; bucketDays?: number } {
  if (records.length === 0) return { points: [] };
  const sorted = records.slice().sort((a, b) => a.day - b.day);
  const spanMs = Math.max(0, sorted[sorted.length - 1].day - sorted[0].day);
  const bucketMs = pickOverviewBucketMs(spanMs);
  if (!bucketMs) {
    return {
      points: sorted.map((d) => ({ x: d.day, y: d.avgScore, label: formatDay(d.day) }))
    };
  }
  const buckets = new Map<number, { weighted: number; weight: number; endDay: number }>();
  for (const d of sorted) {
    const key = Math.floor(d.day / bucketMs) * bucketMs;
    const cur = buckets.get(key) || { weighted: 0, weight: 0, endDay: d.day };
    const w = Math.max(1, d.rounds);
    cur.weighted += d.avgScore * w;
    cur.weight += w;
    cur.endDay = d.day;
    buckets.set(key, cur);
  }
  return {
    bucketDays: Math.round(bucketMs / DAY_MS),
    points: [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => ({ x: v.endDay, y: v.weighted / Math.max(1, v.weight), label: formatDay(v.endDay) }))
  };
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
      initialBars?: number;
      orientation?: "vertical" | "horizontal";
      minHeight?: number;
      bars: Array<{ label: string; value: number }>;
    }
  | {
      type: "selectableBar";
      yLabel?: string;
      initialBars?: number;
      orientation?: "vertical" | "horizontal";
      minHeight?: number;
      defaultMetricKey?: string;
      defaultSort?: "chronological" | "desc" | "asc";
      options: Array<{
        key: string;
        label: string;
        bars: Array<{ label: string; value: number }>;
      }>;
    };

export interface AnalysisSection {
  id: string;
  title: string;
  group?: "Overview" | "Performance" | "Countries" | "Opponents" | "Rating";
  appliesFilters?: Array<"date" | "mode" | "gameMode" | "movement" | "teammate" | "country">;
  lines: string[];
  chart?: AnalysisChart;
  charts?: AnalysisChart[];
}

export interface AnalysisWindowData {
  sections: AnalysisSection[];
  availableGameModes: string[];
  availableMovementTypes: Array<{ key: MovementTypeKey | "all"; label: string }>;
  availableTeammates: Array<{ id: string; label: string }>;
  availableCountries: Array<{ code: string; label: string }>;
  playerName?: string;
  minPlayedAt?: number;
  maxPlayedAt?: number;
}

export interface AnalysisFilter {
  fromTs?: number;
  toTs?: number;
  gameMode?: string;
  movementType?: MovementTypeKey | "all";
  mode?: string; // legacy alias for gameMode
  teammateId?: string;
  country?: string;
}

type RoundMetric = {
  ts: number;
  day: number;
  score: number;
  timeSec: number | undefined;
  distKm: number | undefined;
};

export async function getDashboardData(): Promise<DashboardData> {
  const [games, rounds] = await Promise.all([db.games.orderBy("playedAt").toArray(), db.rounds.toArray()]);
  if (games.length === 0) {
    return { reportLines: ["No games yet. Run sync first."], activity: [], modes: [] };
  }

  const gameTimes = games.map((g) => g.playedAt).sort((a, b) => a - b);
  const lines: string[] = [];
  lines.push(`Range: ${formatShortDateTime(gameTimes[0])} -> ${formatShortDateTime(gameTimes[gameTimes.length - 1])}`);
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

  const gameModeFilter = filter?.gameMode ?? filter?.mode;
  const minPlayedAt = allGames.length ? allGames[0].playedAt : undefined;
  const maxPlayedAt = allGames.length ? allGames[allGames.length - 1].playedAt : undefined;

  const dateGames = allGames.filter((g) => {
    if (!inTsRange(g.playedAt, filter?.fromTs, filter?.toTs)) return false;
    return true;
  });
  const availableGameModes = ["all", "duels", "teamduels"].filter((mode) => {
    if (mode === "all") return true;
    return dateGames.some((g) => normalizeGameModeKey(getGameMode(g)) === mode);
  });

  const modeGames = dateGames.filter((g) => {
    if (gameModeFilter && gameModeFilter !== "all") {
      if (normalizeGameModeKey(getGameMode(g)) !== gameModeFilter) return false;
    }
    return true;
  });
  const detailByGameId = new Map(allDetails.map((d) => [d.gameId, d]));
  const movementByGameId = new Map(modeGames.map((g) => [g.gameId, getMovementType(g, detailByGameId.get(g.gameId))]));
  const movementOrder: MovementTypeKey[] = ["moving", "no_move", "nmpz", "unknown"];
  const movementSet = new Set<MovementTypeKey>();
  for (const kind of movementByGameId.values()) movementSet.add(kind);
  const availableMovementTypes: Array<{ key: MovementTypeKey | "all"; label: string }> = [
    { key: "all", label: "All movement types" },
    ...movementOrder
      .filter((k) => k !== "unknown" && movementSet.has(k))
      .map((k) => ({ key: k, label: movementTypeLabel(k) }))
  ];
  const movementFilter = filter?.movementType;
  const baseGames = modeGames.filter((g) => {
    if (movementFilter && movementFilter !== "all") {
      const kind = movementByGameId.get(g.gameId) || "unknown";
      if (kind !== movementFilter) return false;
    }
    return true;
  });
  const baseGameSet = new Set(baseGames.map((g) => g.gameId));
  const baseRounds = allRounds.filter((r) => baseGameSet.has(r.gameId));
  const baseDetails = allDetails.filter((d) => baseGameSet.has(d.gameId));

  const ownPlayerId = inferOwnPlayerId(baseRounds);
  const nameMap = collectPlayerNames(baseDetails);
  const playerName = ownPlayerId ? nameMap.get(ownPlayerId) || ownPlayerId : undefined;

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
  const teamPlayedAtByGameId = new Map(teamGames.map((g) => [g.gameId, g.playedAt]));

  const countryRounds = selectedCountry ? teamRounds.filter((r) => normalizeCountryCode(r.trueCountry) === selectedCountry) : teamRounds;
  const countryGameSet = new Set(countryRounds.map((r) => r.gameId));
  const countryGames = teamGames.filter((g) => countryGameSet.has(g.gameId));

  if (countryGames.length === 0 || countryRounds.length === 0) {
    return {
      sections: [{ id: "empty", title: "Overview", lines: ["Keine Daten fuer den gewaehlten Filter."] }],
      availableGameModes,
      availableMovementTypes,
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
      if (ts === undefined || typeof score !== "number") return undefined;
      const item: RoundMetric = {
        ts,
        day: startOfLocalDay(ts),
        score,
        timeSec: typeof timeMs === "number" ? timeMs / 1e3 : undefined,
        distKm: typeof distMeters === "number" ? distMeters / 1e3 : undefined
      };
      return item;
    })
    .filter((x): x is RoundMetric => x !== undefined);
  const fiveKCount = roundMetrics.filter((x) => x.score >= 5000).length;
  const throwCount = roundMetrics.filter((x) => x.score < 50).length;
  const overviewBucketMs = pickOverviewBucketMs(Math.max(0, gameTimes[gameTimes.length - 1] - gameTimes[0]));
  const overviewBucketDays = overviewBucketMs ? Math.round(overviewBucketMs / DAY_MS) : 0;
  const gamesPerDayPoints = buildOverviewGamesSeries(games.map((g) => g.playedAt), gameTimes[0], gameTimes[gameTimes.length - 1], overviewBucketMs);
  const avgScorePerDayPoints = buildOverviewAvgScoreSeries(
    rounds
      .map((r) => ({ ts: playedAtByGameId.get(r.gameId) || 0, value: extractScore(r) }))
      .filter((x): x is { ts: number; value: number } => x.ts > 0 && typeof x.value === "number"),
    overviewBucketMs
  );

  const overviewLines: string[] = [
    `Range: ${formatShortDateTime(gameTimes[0])} -> ${formatShortDateTime(gameTimes[gameTimes.length - 1])}`,
    `Games: ${games.length} | Rounds: ${rounds.length}`,
    `Filters: game mode=${gameModeFilter && gameModeFilter !== "all" ? gameModeLabel(gameModeFilter) : "all"}, movement=${
      movementFilter && movementFilter !== "all" ? movementTypeLabel(movementFilter) : "all"
    }, teammate=${selectedTeammate ? (nameMap.get(selectedTeammate) || selectedTeammate) : "all"}, country=${
      selectedCountry ? countryLabel(selectedCountry) : "all"
    }`,
    `Avg score: ${fmt(avg(scores), 1)} | Median: ${fmt(median(scores), 1)} | StdDev: ${fmt(stdDev(scores), 1)}`,
    `Avg distance: ${fmt(avg(distancesKm), 2)} km | Median: ${fmt(median(distancesKm), 2)} km`,
    `Avg time: ${fmt(avg(timesSec), 1)} s | Median: ${fmt(median(timesSec), 1)} s`,
    `Perfect 5k rounds: ${fiveKCount} (${fmt(pct(fiveKCount, roundMetrics.length), 1)}%) | Throws (<50): ${throwCount} (${fmt(pct(throwCount, roundMetrics.length), 1)}%)`
  ];
  const overviewCharts: AnalysisChart[] = [
    {
      type: "line",
      yLabel: overviewBucketMs ? `Games/day (${overviewBucketDays}d aggregated)` : "Games/day",
      points: gamesPerDayPoints
    },
    {
      type: "line",
      yLabel: overviewBucketMs ? `Avg score/day (${overviewBucketDays}d aggregated)` : "Avg score/day",
      points: avgScorePerDayPoints
    }
  ];

  const outcomeTimeline = ownPlayerId
    ? teamDetails
        .map((d) => {
          const ts = teamPlayedAtByGameId.get(d.gameId);
          const result = getGameResult(d, ownPlayerId);
          return ts && result ? { ts, result } : undefined;
        })
        .filter((x): x is { ts: number; result: GameResult } => !!x)
        .sort((a, b) => a.ts - b.ts)
    : [];
  const winCount = outcomeTimeline.filter((x) => x.result === "W").length;
  const lossCount = outcomeTimeline.filter((x) => x.result === "L").length;
  const tieCount = outcomeTimeline.filter((x) => x.result === "T").length;
  const decisiveGames = winCount + lossCount;
  const totalResultGames = decisiveGames + tieCount;
  let currentWinStreak = 0;
  let currentLossStreak = 0;
  let bestWinStreak = 0;
  let worstLossStreak = 0;
  for (const g of outcomeTimeline) {
    if (g.result === "W") {
      currentWinStreak++;
      currentLossStreak = 0;
      bestWinStreak = Math.max(bestWinStreak, currentWinStreak);
      continue;
    }
    if (g.result === "L") {
      currentLossStreak++;
      currentWinStreak = 0;
      worstLossStreak = Math.max(worstLossStreak, currentLossStreak);
      continue;
    }
    currentWinStreak = 0;
    currentLossStreak = 0;
  }
  const resultLines = ownPlayerId
    ? [
        selectedCountry ? "Country filter is ignored here (game-level results)." : "",
        `Games with result data: ${totalResultGames}`,
        `Wins: ${winCount} | Losses: ${lossCount} | Ties: ${tieCount}`,
        `Win rate (decisive): ${fmt(pct(winCount, decisiveGames), 1)}%`,
        `Win rate (all): ${fmt(pct(winCount, totalResultGames), 1)}%`,
        `Longest win streak: ${bestWinStreak}`,
        `Longest loss streak: ${worstLossStreak}`
      ].filter((x) => x !== "")
    : ["No own player id inferred, so game-level win/loss is unavailable."];

  const modeCounts = new Map<string, number>();
  const movementCounts = new Map<MovementTypeKey, number>();
  const movementByFilteredGameId = new Map(games.map((g) => [g.gameId, movementByGameId.get(g.gameId) || "unknown"]));
  for (const g of games) {
    const modeKey = normalizeGameModeKey(getGameMode(g));
    if (modeKey === "duels" || modeKey === "teamduels") modeCounts.set(modeKey, (modeCounts.get(modeKey) || 0) + 1);
    const m = movementByFilteredGameId.get(g.gameId) || "unknown";
    movementCounts.set(m, (movementCounts.get(m) || 0) + 1);
  }
  const sortedModes = [...modeCounts.entries()].sort((a, b) => b[1] - a[1]);
  const movementOrderForBreakdown: MovementTypeKey[] = ["moving", "no_move", "nmpz", "unknown"];
  const movementBars = movementOrderForBreakdown
    .filter((m) => (movementCounts.get(m) || 0) > 0)
    .map((m) => ({ label: movementTypeLabel(m), value: movementCounts.get(m) || 0 }));
  const breakdownLines = [
    "Mode Breakdown:",
    ...sortedModes.map(([m, c]) => `${gameModeLabel(m)}: ${c}`),
    "Movement Breakdown:",
    ...movementBars.map((b) => `${b.label}: ${b.value}`)
  ];

  overviewLines.push("Results, Win Rate & Streaks:");
  overviewLines.push(...resultLines);
  overviewLines.push("Mode & Movement Breakdown:");
  overviewLines.push(...breakdownLines);

  sections.push({
    id: "overview",
    title: "Overview",
    group: "Overview",
    appliesFilters: ["date", "mode", "movement", "teammate", "country"],
    lines: overviewLines,
    charts: overviewCharts
  });

  const weekday = new Array(7).fill(0);
  const hour = new Array(24).fill(0);
  const weekdayScoreSum = new Array(7).fill(0);
  const weekdayScoreCount = new Array(7).fill(0);
  const weekdayTimeSum = new Array(7).fill(0);
  const weekdayTimeCount = new Array(7).fill(0);
  const weekdayRounds = new Array(7).fill(0);
  const weekdayThrows = new Array(7).fill(0);
  const weekdayFiveKs = new Array(7).fill(0);
  const hourScoreSum = new Array(24).fill(0);
  const hourScoreCount = new Array(24).fill(0);
  const hourTimeSum = new Array(24).fill(0);
  const hourTimeCount = new Array(24).fill(0);
  const hourRounds = new Array(24).fill(0);
  const hourThrows = new Array(24).fill(0);
  const hourFiveKs = new Array(24).fill(0);
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
    weekdayRounds[wd]++;
    hourRounds[hr]++;
    if (typeof sc === "number") {
      weekdayScoreSum[wd] += sc;
      weekdayScoreCount[wd]++;
      hourScoreSum[hr] += sc;
      hourScoreCount[hr]++;
      if (sc < 50) {
        weekdayThrows[wd]++;
        hourThrows[hr]++;
      }
      if (sc >= 5000) {
        weekdayFiveKs[wd]++;
        hourFiveKs[hr]++;
      }
    }
    if (typeof tm === "number") {
      weekdayTimeSum[wd] += tm;
      weekdayTimeCount[wd]++;
      hourTimeSum[hr] += tm;
      hourTimeCount[hr]++;
    }
  }
  const wdNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekdayMetricOptions = [
    { key: "games", label: "Games", bars: weekday.map((v, i) => ({ label: wdNames[i], value: v })) },
    {
      key: "avg_score",
      label: "Avg score",
      bars: wdNames.map((name, i) => ({ label: name, value: weekdayScoreCount[i] ? weekdayScoreSum[i] / weekdayScoreCount[i] : 0 }))
    },
    {
      key: "avg_time",
      label: "Avg guess time (s)",
      bars: wdNames.map((name, i) => ({ label: name, value: weekdayTimeCount[i] ? weekdayTimeSum[i] / weekdayTimeCount[i] / 1e3 : 0 }))
    },
    {
      key: "throw_rate",
      label: "Throw rate (%)",
      bars: wdNames.map((name, i) => ({ label: name, value: weekdayRounds[i] ? pct(weekdayThrows[i], weekdayRounds[i]) : 0 }))
    },
    {
      key: "fivek_rate",
      label: "5k rate (%)",
      bars: wdNames.map((name, i) => ({ label: name, value: weekdayRounds[i] ? pct(weekdayFiveKs[i], weekdayRounds[i]) : 0 }))
    }
  ];
  const hourMetricOptions = [
    { key: "games", label: "Games", bars: hour.map((v, h) => ({ label: String(h).padStart(2, "0"), value: v })) },
    {
      key: "avg_score",
      label: "Avg score",
      bars: hour.map((_, h) => ({ label: String(h).padStart(2, "0"), value: hourScoreCount[h] ? hourScoreSum[h] / hourScoreCount[h] : 0 }))
    },
    {
      key: "avg_time",
      label: "Avg guess time (s)",
      bars: hour.map((_, h) => ({ label: String(h).padStart(2, "0"), value: hourTimeCount[h] ? hourTimeSum[h] / hourTimeCount[h] / 1e3 : 0 }))
    },
    {
      key: "throw_rate",
      label: "Throw rate (%)",
      bars: hour.map((_, h) => ({ label: String(h).padStart(2, "0"), value: hourRounds[h] ? pct(hourThrows[h], hourRounds[h]) : 0 }))
    },
    {
      key: "fivek_rate",
      label: "5k rate (%)",
      bars: hour.map((_, h) => ({ label: String(h).padStart(2, "0"), value: hourRounds[h] ? pct(hourFiveKs[h], hourRounds[h]) : 0 }))
    }
  ];
  sections.push({
    id: "time_patterns",
    title: "Time Patterns",
    group: "Overview",
    appliesFilters: ["date", "mode", "teammate"],
    lines: [],
    charts: [
      {
        type: "selectableBar",
        yLabel: "Weekday patterns",
        orientation: "horizontal",
        initialBars: 7,
        minHeight: 190,
        defaultMetricKey: "games",
        defaultSort: "chronological",
        options: weekdayMetricOptions
      },
      {
        type: "selectableBar",
        yLabel: "Hour-of-day patterns",
        orientation: "horizontal",
        initialBars: 24,
        defaultMetricKey: "games",
        defaultSort: "chronological",
        options: hourMetricOptions
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
  const sessionBounds = new Map<number, { start: number; end: number; games: number }>();
  for (const ts of sortedGameTimes) {
    const idx = gameSessionIndex.get(ts);
    if (idx === undefined) continue;
    const cur = sessionBounds.get(idx);
    if (!cur) {
      sessionBounds.set(idx, { start: ts, end: ts, games: 1 });
    } else {
      cur.start = Math.min(cur.start, ts);
      cur.end = Math.max(cur.end, ts);
      cur.games += 1;
      sessionBounds.set(idx, cur);
    }
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
      start: sessionBounds.get(idx)?.start || 0,
      end: sessionBounds.get(idx)?.end || 0,
      games: sessionBounds.get(idx)?.games || 0,
      rounds: s.rounds,
      avgScore: avg(s.scores) || 0,
      fiveKRate: pct(s.fiveK, s.rounds),
      throwRate: pct(s.throws, s.rounds),
      avgTime: avg(s.avgTimeSrc),
      label: sessionBounds.get(idx)
        ? `${formatShortDateTime(sessionBounds.get(idx)!.start)} -> ${formatShortDateTime(sessionBounds.get(idx)!.end)}`
        : `Session ${idx + 1}`
    }))
    .sort((a, b) => a.start - b.start);
  const sessionResultAgg = new Map<number, { wins: number; losses: number; ties: number }>();
  if (ownPlayerId) {
    for (const d of teamDetails) {
      const ts = teamPlayedAtByGameId.get(d.gameId);
      const result = getGameResult(d, ownPlayerId);
      if (ts === undefined || !result) continue;
      const idx = gameSessionIndex.get(ts);
      if (idx === undefined) continue;
      const cur = sessionResultAgg.get(idx) || { wins: 0, losses: 0, ties: 0 };
      if (result === "W") cur.wins++;
      else if (result === "L") cur.losses++;
      else cur.ties++;
      sessionResultAgg.set(idx, cur);
    }
  }
  const sortedSessions = sessionRows.slice().sort((a, b) => a.start - b.start);
  const longestSessionBreakMs = sortedSessions.slice(1).reduce((maxGap, cur, i) => {
    const prev = sortedSessions[i];
    const gap = Math.max(0, cur.start - prev.end);
    return Math.max(maxGap, gap);
  }, 0);
  const longestSessionBreakLabel =
    longestSessionBreakMs > 24 * 60 * 60 * 1000
      ? `${fmt(longestSessionBreakMs / (24 * 60 * 60 * 1000), 2)} days`
      : `${fmt(longestSessionBreakMs / (60 * 60 * 1000), 2)} hours`;
  const avgGamesPerSession = avg(sessionRows.map((s) => s.games));
  const sessionWinRateBars = ownPlayerId
    ? sessionRows.map((s) => {
        const res = sessionResultAgg.get(s.idx);
        const decisive = (res?.wins || 0) + (res?.losses || 0);
        const rate = decisive > 0 ? pct(res?.wins || 0, decisive) : 0;
        return { label: formatShortDateTime(s.start), value: rate };
      })
    : [];
  const sessionMetricOptions: Array<{ key: string; label: string; bars: Array<{ label: string; value: number }> }> = [
    { key: "avg_score", label: "Avg score", bars: sessionRows.map((s) => ({ label: formatShortDateTime(s.start), value: s.avgScore })) },
    { key: "throw_rate", label: "Throw rate (%)", bars: sessionRows.map((s) => ({ label: formatShortDateTime(s.start), value: s.throwRate })) },
    { key: "fivek_rate", label: "5k rate (%)", bars: sessionRows.map((s) => ({ label: formatShortDateTime(s.start), value: s.fiveKRate })) },
    { key: "avg_duration", label: "Avg duration (s)", bars: sessionRows.map((s) => ({ label: formatShortDateTime(s.start), value: s.avgTime || 0 })) },
    { key: "games", label: "Games", bars: sessionRows.map((s) => ({ label: formatShortDateTime(s.start), value: s.games })) },
    { key: "rounds", label: "Rounds", bars: sessionRows.map((s) => ({ label: formatShortDateTime(s.start), value: s.rounds })) }
  ];
  if (sessionWinRateBars.length > 0) sessionMetricOptions.push({ key: "win_rate", label: "Win rate (%)", bars: sessionWinRateBars });
  sections.push({
    id: "session_quality",
    title: "Sessions",
    group: "Performance",
    appliesFilters: ["date", "mode", "teammate", "country"],
    lines: [
      `Sessions detected (gap >45m): ${sessionRows.length}`,
      `Longest break between sessions: ${longestSessionBreakLabel}`,
      `Avg games per session: ${fmt(avgGamesPerSession, 2)}`
    ],
    chart: {
      type: "selectableBar",
      yLabel: "Sessions",
      orientation: "horizontal",
      initialBars: 10,
      defaultMetricKey: "avg_score",
      defaultSort: "desc",
      options: sessionMetricOptions
    }
  });

  const tempoBuckets = [
    { name: "<20 sec", min: 0, max: 20 },
    { name: "20-30 sec", min: 20, max: 30 },
    { name: "30-45 sec", min: 30, max: 45 },
    { name: "45-60 sec", min: 45, max: 60 },
    { name: "60-90 sec", min: 60, max: 90 },
    { name: "90-180 sec", min: 90, max: 180 },
    { name: ">180 sec", min: 180, max: Infinity }
  ];
  const tempoAgg = tempoBuckets.map((b) => ({
    ...b,
    n: 0,
    scores: [] as number[],
    dist: [] as number[],
    throws: 0,
    fiveKs: 0,
    timeSum: 0
  }));
  for (const rm of roundMetrics) {
    if (typeof rm.timeSec !== "number") continue;
    const t = rm.timeSec;
    const bucket = tempoAgg.find((b) => t >= b.min && t < b.max);
    if (!bucket) continue;
    bucket.n++;
    bucket.scores.push(rm.score);
    if (typeof rm.distKm === "number") bucket.dist.push(rm.distKm);
    if (rm.score < 50) bucket.throws++;
    if (rm.score >= 5000) bucket.fiveKs++;
    bucket.timeSum += t;
  }
  const timedRounds = roundMetrics.filter((r) => typeof r.timeSec === "number");
  const fastestGuess = timedRounds.slice().sort((a, b) => (a.timeSec || 0) - (b.timeSec || 0))[0];
  const slowestGuess = timedRounds.slice().sort((a, b) => (b.timeSec || 0) - (a.timeSec || 0))[0];
  const fastestFiveK = timedRounds
    .filter((r) => r.score >= 5000)
    .sort((a, b) => (a.timeSec || 0) - (b.timeSec || 0))[0];
  const slowestThrow = timedRounds
    .filter((r) => r.score < 50)
    .sort((a, b) => (b.timeSec || 0) - (a.timeSec || 0))[0];
  const tempoMetricOptions: Array<{ key: string; label: string; bars: Array<{ label: string; value: number }> }> = [
    { key: "avg_score", label: "Avg score", bars: tempoAgg.map((b) => ({ label: b.name, value: avg(b.scores) || 0 })) },
    { key: "avg_distance", label: "Avg distance (km)", bars: tempoAgg.map((b) => ({ label: b.name, value: avg(b.dist) || 0 })) },
    { key: "throw_rate", label: "Throw rate (%)", bars: tempoAgg.map((b) => ({ label: b.name, value: b.n ? pct(b.throws, b.n) : 0 })) },
    { key: "fivek_rate", label: "5k rate (%)", bars: tempoAgg.map((b) => ({ label: b.name, value: b.n ? pct(b.fiveKs, b.n) : 0 })) },
    { key: "rounds", label: "Rounds", bars: tempoAgg.map((b) => ({ label: b.name, value: b.n })) }
  ];
  sections.push({
    id: "tempo_vs_quality",
    title: "Tempo",
    group: "Performance",
    appliesFilters: ["date", "mode", "teammate", "country"],
    lines: [
      `Fastest guess: ${
        fastestGuess ? `${fmt(fastestGuess.timeSec, 1)}s on ${formatShortDateTime(fastestGuess.ts)} (score ${fmt(fastestGuess.score, 0)})` : "-"
      }`,
      `Slowest guess: ${
        slowestGuess ? `${fmt(slowestGuess.timeSec, 1)}s on ${formatShortDateTime(slowestGuess.ts)} (score ${fmt(slowestGuess.score, 0)})` : "-"
      }`,
      `Fastest 5k: ${
        fastestFiveK ? `${fmt(fastestFiveK.timeSec, 1)}s on ${formatShortDateTime(fastestFiveK.ts)}` : "-"
      }`,
      `Slowest throw (<50): ${
        slowestThrow ? `${fmt(slowestThrow.timeSec, 1)}s on ${formatShortDateTime(slowestThrow.ts)} (score ${fmt(slowestThrow.score, 0)})` : "-"
      }`
    ],
    chart: {
      type: "selectableBar",
      yLabel: "Time bucket metrics",
      initialBars: tempoBuckets.length,
      defaultMetricKey: "avg_score",
      defaultSort: "chronological",
      options: tempoMetricOptions
    }
  });

  const nearPerfectCount = roundMetrics.filter((x) => x.score >= 4500).length;
  const lowScoreCount = roundMetrics.filter((x) => x.score < 500).length;
  const scoreDistributionBars = buildSmoothedScoreDistribution(scores);
  sections.push({
    id: "scores",
    title: "Scores",
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
      yLabel: "Score distribution (smoothed)",
      initialBars: 24,
      bars: scoreDistributionBars
    }
  });

  const countryAgg = new Map<
    string,
    {
      n: number;
      score: number[];
      scoreCorrectOnly: number[];
      dist: number[];
      correct: number;
      guessed: Map<string, number>;
      throws: number;
      fiveKs: number;
      damageDealt: number;
      damageTaken: number;
      damageN: number;
    }
  >();
  for (const r of teamRounds) {
    const t = normalizeCountryCode(r.trueCountry);
    if (!t) continue;
    const entry = countryAgg.get(t) || {
      n: 0,
      score: [],
      scoreCorrectOnly: [],
      dist: [],
      correct: 0,
      guessed: new Map<string, number>(),
      throws: 0,
      fiveKs: 0,
      damageDealt: 0,
      damageTaken: 0,
      damageN: 0
    };
    entry.n++;

    const sc = extractScore(r);
    if (typeof sc === "number") {
      entry.score.push(sc);
      if (sc < 50) entry.throws++;
      if (sc >= 5000) entry.fiveKs++;
    }

    const dm = extractDistanceMeters(r);
    if (typeof dm === "number") entry.dist.push(dm / 1e3);

    const guess = normalizeCountryCode(getString(asRecord(r), "p1_guessCountry"));
    if (guess) {
      entry.guessed.set(guess, (entry.guessed.get(guess) || 0) + 1);
      if (guess === t) {
        entry.correct++;
        if (typeof sc === "number") entry.scoreCorrectOnly.push(sc);
      }
    }

    if (ownPlayerId) {
      const diff = getRoundDamageDiff(r, ownPlayerId);
      if (typeof diff === "number" && Number.isFinite(diff)) {
        if (diff > 0) entry.damageDealt += diff;
        if (diff < 0) entry.damageTaken += -diff;
        entry.damageN++;
      }
    }

    countryAgg.set(t, entry);
  }

  const topCountries = [...countryAgg.entries()].sort((a, b) => b[1].n - a[1].n);
  const countryMetricRows = topCountries.map(([c, v]) => ({
      country: c,
      n: v.n,
      avgScore: avg(v.score) || 0,
      avgScoreCorrectOnly: avg(v.scoreCorrectOnly) || 0,
      avgDist: avg(v.dist),
      hitRate: v.n > 0 ? v.correct / v.n : 0,
      throwRate: v.score.length > 0 ? v.throws / v.score.length : 0,
      fiveKRate: v.score.length > 0 ? v.fiveKs / v.score.length : 0,
      avgDamageDealt: v.damageN > 0 ? v.damageDealt / v.damageN : 0,
      avgDamageTaken: v.damageN > 0 ? v.damageTaken / v.damageN : 0
    }));
  const countryMetricOptions: Array<{ key: string; label: string; bars: Array<{ label: string; value: number }> }> = [
    { key: "avg_score", label: "Avg score", bars: countryMetricRows.map((x) => ({ label: countryLabel(x.country), value: x.avgScore })) },
    {
      key: "avg_score_correct_only",
      label: "Avg score (correct guesses only)",
      bars: countryMetricRows.map((x) => ({ label: countryLabel(x.country), value: x.avgScoreCorrectOnly }))
    },
    { key: "hit_rate", label: "Hit rate (%)", bars: countryMetricRows.map((x) => ({ label: countryLabel(x.country), value: x.hitRate * 100 })) },
    { key: "avg_distance", label: "Avg distance (km)", bars: countryMetricRows.map((x) => ({ label: countryLabel(x.country), value: x.avgDist || 0 })) },
    { key: "throw_rate", label: "Throw rate (%)", bars: countryMetricRows.map((x) => ({ label: countryLabel(x.country), value: x.throwRate * 100 })) },
    { key: "fivek_rate", label: "5k rate (%)", bars: countryMetricRows.map((x) => ({ label: countryLabel(x.country), value: x.fiveKRate * 100 })) },
    { key: "damage_dealt", label: "Avg damage dealt", bars: countryMetricRows.map((x) => ({ label: countryLabel(x.country), value: x.avgDamageDealt })) },
    { key: "damage_taken", label: "Avg damage taken", bars: countryMetricRows.map((x) => ({ label: countryLabel(x.country), value: x.avgDamageTaken })) },
    { key: "rounds", label: "Rounds", bars: countryMetricRows.map((x) => ({ label: countryLabel(x.country), value: x.n })) }
  ];
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
    id: "country_stats",
    title: "Countries",
    group: "Countries",
    appliesFilters: ["date", "mode", "teammate"],
    lines: [selectedCountry ? "Country filter is ignored here (global country comparison)." : ""].filter((x) => x !== ""),
    charts: [
      {
        type: "selectableBar",
        yLabel: "Country metrics",
        orientation: "horizontal",
        initialBars: 25,
        defaultMetricKey: "avg_score",
        defaultSort: "desc",
        options: countryMetricOptions
      },
      {
        type: "bar",
        yLabel: "Confusion matrix (top pairs)",
        initialBars: 12,
        orientation: "vertical",
        bars: confusions.slice(0, 24).map((x) => ({
          label: `${x.truth.toUpperCase()} -> ${x.guess.toUpperCase()}`,
          value: x.n
        }))
      }
    ]
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
    title: "Opponents",
    group: "Opponents",
    appliesFilters: ["date", "mode", "teammate"],
    lines: [
      selectedCountry ? `Country filter is ignored here (showing all countries for selected time/mode/team).` : "",
      "Top 3 opponents:",
      ...topOpp.slice(0, 3).map(([id, v], i) => `${i + 1}. ${v.name || id.slice(0, 8)}: ${v.games} match-ups${v.country ? ` (${v.country})` : ""}`),
      "Scope:",
      `Unique opponents: ${opponentCounts.size}`,
      `Unique countries: ${oppCountryCounts.size}`
    ].filter((x) => x !== ""),
    chart: {
      type: "bar",
      yLabel: "Match-ups by opponent country",
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
  let bestGain: { delta: number; startTs: number; endTs: number } | undefined;
  let worstLoss: { delta: number; startTs: number; endTs: number } | undefined;
  if (ratingPoints.length > 1) {
    let sessionStartIdx = 0;
    for (let i = 1; i <= ratingPoints.length; i++) {
      const reachedEnd = i === ratingPoints.length;
      const gapBreak = !reachedEnd && ratingPoints[i].x - ratingPoints[i - 1].x > SESSION_GAP_MS;
      if (!reachedEnd && !gapBreak) continue;
      const sessionEndIdx = i - 1;
      if (sessionEndIdx > sessionStartIdx) {
        const start = ratingPoints[sessionStartIdx];
        const end = ratingPoints[sessionEndIdx];
        const delta = end.y - start.y;
        const summary = { delta, startTs: start.x, endTs: end.x };
        if (!bestGain || delta > bestGain.delta) bestGain = summary;
        if (!worstLoss || delta < worstLoss.delta) worstLoss = summary;
      }
      sessionStartIdx = i;
    }
  }
  sections.push({
    id: "rating_history",
    title: "Rating",
    group: "Rating",
    appliesFilters: ["date", "mode", "teammate"],
    lines: [
      ratingDelta !== undefined ? `Trend: ${ratingDelta >= 0 ? "+" : ""}${fmt(ratingDelta, 0)}` : "Trend: -",
      bestGain
        ? `Biggest session rating gain: ${bestGain.delta >= 0 ? "+" : ""}${fmt(bestGain.delta, 0)} (${formatShortDateTime(bestGain.startTs)} -> ${formatShortDateTime(bestGain.endTs)})`
        : "Biggest session rating gain: -",
      worstLoss
        ? `Biggest session rating loss: ${worstLoss.delta >= 0 ? "+" : ""}${fmt(worstLoss.delta, 0)} (${formatShortDateTime(worstLoss.startTs)} -> ${formatShortDateTime(worstLoss.endTs)})`
        : "Biggest session rating loss: -"
    ],
    charts: ratingPoints.length > 1 ? [{ type: "line", yLabel: "Rating", points: ratingPoints }] : undefined
  });

  const teammateToUse = selectedTeammate || [...teammateGames.entries()].sort((a, b) => b[1].size - a[1].size)[0]?.[0];
  if (teammateToUse && ownPlayerId) {
    const mateName = nameMap.get(teammateToUse) || teammateToUse.slice(0, 8);
    const teammateGameSet = teammateGames.get(teammateToUse) || new Set<string>();
    const gamesTogether = baseGames.filter((g) => teammateGameSet.has(g.gameId)).sort((a, b) => a.playedAt - b.playedAt);
    const roundsTogether = baseRounds.filter((r) => teammateGameSet.has(r.gameId));
    const compareRounds = rounds.filter((r) => {
      const mine = getPlayerStatFromRound(r, ownPlayerId);
      const mate = getPlayerStatFromRound(r, teammateToUse);
      return !!mine && !!mate;
    });

    let myScoreWins = 0;
    let mateScoreWins = 0;
    let scoreTies = 0;
    let myCloser = 0;
    let mateCloser = 0;
    let distanceTies = 0;
    let myThrows = 0;
    let mateThrows = 0;
    let myFiveKs = 0;
    let mateFiveKs = 0;
    let myScored = 0;
    let mateScored = 0;

    for (const r of compareRounds) {
      const mine = getPlayerStatFromRound(r, ownPlayerId)!;
      const mate = getPlayerStatFromRound(r, teammateToUse)!;

      if (typeof mine.score === "number" && typeof mate.score === "number") {
        if (mine.score > mate.score) myScoreWins++;
        else if (mine.score < mate.score) mateScoreWins++;
        else scoreTies++;
        if (mine.score < 50) myThrows++;
        if (mate.score < 50) mateThrows++;
        if (mine.score >= 5000) myFiveKs++;
        if (mate.score >= 5000) mateFiveKs++;
        myScored++;
        mateScored++;
      }
      if (typeof mine.distanceKm === "number" && typeof mate.distanceKm === "number") {
        if (mine.distanceKm < mate.distanceKm) myCloser++;
        else if (mine.distanceKm > mate.distanceKm) mateCloser++;
        else distanceTies++;
      }
    }

    const decideLeader = (youValue: number, mateValue: number, neutralLabel = "Tie"): string => {
      const decisive = youValue + mateValue;
      if (decisive === 0) return `${neutralLabel} (-)`;
      if (youValue === mateValue) return `${neutralLabel} (50.0%)`;
      const youWin = youValue > mateValue;
      const leader = youWin ? "You" : mateName;
      const share = youWin ? pct(youValue, decisive) : pct(mateValue, decisive);
      return `${leader} (${fmt(share, 1)}%)`;
    };

    const pairTimes = gamesTogether.map((g) => g.playedAt);
    let firstTogether: number | undefined;
    let lastTogether: number | undefined;
    let longestPairSessionGames = 0;
    let longestPairSessionStart: number | undefined;
    let longestPairSessionEnd: number | undefined;
    let avgPairGamesPerSession: number | undefined;
    let longestPairBreak: number | undefined;
    if (pairTimes.length > 0) {
      firstTogether = pairTimes[0];
      lastTogether = pairTimes[pairTimes.length - 1];
      let start = pairTimes[0];
      let prev = pairTimes[0];
      let gamesInSession = 1;
      let sessionCount = 0;
      let sessionTotalGames = 0;
      for (let i = 1; i < pairTimes.length; i++) {
        const ts = pairTimes[i];
        const gap = ts - prev;
        longestPairBreak = Math.max(longestPairBreak || 0, gap);
        if (gap > 45 * 60 * 1000) {
          sessionCount++;
          sessionTotalGames += gamesInSession;
          if (gamesInSession > longestPairSessionGames) {
            longestPairSessionGames = gamesInSession;
            longestPairSessionStart = start;
            longestPairSessionEnd = prev;
          }
          start = ts;
          gamesInSession = 1;
        } else {
          gamesInSession++;
        }
        prev = ts;
      }
      sessionCount++;
      sessionTotalGames += gamesInSession;
      if (gamesInSession > longestPairSessionGames) {
        longestPairSessionGames = gamesInSession;
        longestPairSessionStart = start;
        longestPairSessionEnd = prev;
      }
      avgPairGamesPerSession = sessionCount ? sessionTotalGames / sessionCount : undefined;
    }

    sections.push({
      id: "teammate_battle",
      title: `Team: You + ${mateName}`,
      group: "Performance",
      appliesFilters: ["date", "mode", "teammate"],
      lines: [
        selectedCountry ? "Country filter is ignored here (team perspective)." : "",
        "Head-to-head questions:",
        `Closer guesses: ${decideLeader(myCloser, mateCloser)}`,
        `Higher score rounds: ${decideLeader(myScoreWins, mateScoreWins)}`,
        `Fewer throws (<50): ${decideLeader(mateThrows, myThrows)}`,
        `More 5k rounds: ${decideLeader(myFiveKs, mateFiveKs)}`,
        "Team facts:",
        `Games together: ${gamesTogether.length}`,
        `Rounds together: ${roundsTogether.length}`,
        `First game together: ${firstTogether ? formatShortDateTime(firstTogether) : "-"}`,
        `Most recent game together: ${lastTogether ? formatShortDateTime(lastTogether) : "-"}`,
        `Longest session together: ${
          longestPairSessionGames > 0 && longestPairSessionStart !== undefined && longestPairSessionEnd !== undefined
            ? `${longestPairSessionGames} games (${formatShortDateTime(longestPairSessionStart)} -> ${formatShortDateTime(longestPairSessionEnd)})`
            : "-"
        }`,
        `Avg games per session together: ${fmt(avgPairGamesPerSession, 1)}`,
        `Longest break between games together: ${longestPairBreak ? formatDurationHuman(longestPairBreak) : "-"}`
      ].filter((x) => x !== "")
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
        `Throws (<50) in this country: ${countryThrows} (${fmt(pct(countryThrows, countryScores.length), 1)}%)`
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
  const smoothedDaily = smoothDailyScoreRecords(dayRecords);
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
      yLabel: smoothedDaily.bucketDays ? `Avg daily score (${smoothedDaily.bucketDays}d smoothed)` : "Avg daily score",
      points: smoothedDaily.points
    }
  });

  return {
    sections,
    availableGameModes,
    availableMovementTypes,
    availableTeammates,
    availableCountries,
    playerName,
    minPlayedAt,
    maxPlayedAt
  };
}

export async function getAnalysisReport(): Promise<string[]> {
  const d = await getDashboardData();
  return d.reportLines;
}
