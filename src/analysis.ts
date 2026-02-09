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

function buildGoogleMapsUrl(lat?: number, lng?: number): string | undefined {
  if (typeof lat !== "number" || typeof lng !== "number") return undefined;
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function buildStreetViewUrl(lat?: number, lng?: number): string | undefined {
  if (typeof lat !== "number" || typeof lng !== "number") return undefined;
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
}

function buildUserProfileUrl(playerId?: string): string | undefined {
  if (typeof playerId !== "string" || !playerId.trim()) return undefined;
  return `https://www.geoguessr.com/user/${playerId}`;
}

type AnalysisDrilldownMeta = {
  movementLabel?: string;
  gameModeLabel?: string;
  teammateName?: string;
  ownPlayerId?: string;
};

function toDrilldownFromRound(r: RoundRow, ts?: number, score?: number, meta?: AnalysisDrilldownMeta): AnalysisDrilldownItem {
  const rr = asRecord(r);
  const trueLat = typeof r.trueLat === "number" ? r.trueLat : undefined;
  const trueLng = typeof r.trueLng === "number" ? r.trueLng : undefined;
  const guessLat =
    getNumber(rr, "p1_guessLat") ??
    getNumber(rr, "guessLat");
  const guessLng =
    getNumber(rr, "p1_guessLng") ??
    getNumber(rr, "guessLng");
  const timeMs = extractTimeMs(r);
  const damage = meta?.ownPlayerId ? getRoundDamageDiff(r, meta.ownPlayerId) : undefined;
  return {
    gameId: r.gameId,
    roundNumber: r.roundNumber,
    ts,
    score,
    trueCountry: normalizeCountryCode(r.trueCountry),
    guessCountry: normalizeCountryCode(getString(asRecord(r), "p1_guessCountry")),
    trueLat,
    trueLng,
    guessLat,
    guessLng,
    guessDurationSec: typeof timeMs === "number" ? timeMs / 1e3 : undefined,
    movement: meta?.movementLabel,
    gameMode: meta?.gameModeLabel,
    teammate: meta?.teammateName,
    damage,
    googleMapsUrl: buildGoogleMapsUrl(guessLat, guessLng),
    streetViewUrl: buildStreetViewUrl(trueLat, trueLng)
  };
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

export interface AnalysisDrilldownItem {
  gameId: string;
  roundNumber: number;
  ts?: number;
  score?: number;
  trueCountry?: string;
  guessCountry?: string;
  trueLat?: number;
  trueLng?: number;
  guessLat?: number;
  guessLng?: number;
  guessDurationSec?: number;
  movement?: string;
  gameMode?: string;
  teammate?: string;
  damage?: number;
  googleMapsUrl?: string;
  streetViewUrl?: string;
  result?: GameResult;
  matchups?: number;
  opponentId?: string;
  opponentName?: string;
  opponentCountry?: string;
  opponentProfileUrl?: string;
}

export interface AnalysisBarPoint {
  label: string;
  value: number;
  drilldown?: AnalysisDrilldownItem[];
}

export interface AnalysisLineDrilldown {
  lineLabel: string;
  items: AnalysisDrilldownItem[];
}

function buildSmoothedScoreDistributionWithDrilldown(
  points: Array<{ score: number; drill: AnalysisDrilldownItem }>,
  bucketSize = 100
): AnalysisBarPoint[] {
  if (points.length === 0) return [];
  const maxScore = 5000;
  const bucketCount = Math.ceil((maxScore + 1) / bucketSize);
  const buckets = new Array(bucketCount).fill(0);
  const drillByBucket: AnalysisDrilldownItem[][] = Array.from({ length: bucketCount }, () => []);
  for (const p of points) {
    const s = Math.max(0, Math.min(maxScore, p.score));
    const idx = Math.min(bucketCount - 1, Math.floor(s / bucketSize));
    buckets[idx]++;
    drillByBucket[idx].push(p.drill);
  }
  const weights = [1, 2, 3, 2, 1];
  const radius = Math.floor(weights.length / 2);
  return buckets.map((_, i) => {
    let weighted = 0;
    let weightSum = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j < 0 || j >= buckets.length) continue;
      const w = weights[k + radius];
      weighted += buckets[j] * w;
      weightSum += w;
    }
    const start = i * bucketSize;
    const end = Math.min(maxScore, start + bucketSize - 1);
    return {
      label: `${start}-${end}`,
      value: weightSum ? weighted / weightSum : 0,
      drilldown: drillByBucket[i]
    };
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

function getTeammateNameForGame(detail: GameRow, ownPlayerId: string | undefined, nameMap: Map<string, string>): string | undefined {
  const d = asRecord(detail);
  if (getString(d, "modeFamily") !== "teamduels" || !ownPlayerId) return undefined;

  const t1p1 = getString(d, "teamOnePlayerOneId");
  const t1p2 = getString(d, "teamOnePlayerTwoId");
  const t2p1 = getString(d, "teamTwoPlayerOneId");
  const t2p2 = getString(d, "teamTwoPlayerTwoId");

  let mateId: string | undefined;
  if (ownPlayerId === t1p1) mateId = t1p2;
  else if (ownPlayerId === t1p2) mateId = t1p1;
  else if (ownPlayerId === t2p1) mateId = t2p2;
  else if (ownPlayerId === t2p2) mateId = t2p1;
  if (!mateId) return undefined;

  const explicitName =
    (mateId === t1p1 ? getString(d, "teamOnePlayerOneName") : undefined) ??
    (mateId === t1p2 ? getString(d, "teamOnePlayerTwoName") : undefined) ??
    (mateId === t2p1 ? getString(d, "teamTwoPlayerOneName") : undefined) ??
    (mateId === t2p2 ? getString(d, "teamTwoPlayerTwoName") : undefined);

  return explicitName || nameMap.get(mateId) || mateId.slice(0, 8);
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
      series?: Array<{
        key: string;
        label: string;
        points: Array<{ x: number; y: number; label?: string }>;
      }>;
    }
  | {
      type: "bar";
      yLabel?: string;
      initialBars?: number;
      orientation?: "vertical" | "horizontal";
      minHeight?: number;
      bars: AnalysisBarPoint[];
    }
  | {
      type: "selectableBar";
      yLabel?: string;
      initialBars?: number;
      orientation?: "vertical" | "horizontal";
      minHeight?: number;
      allowSort?: boolean;
      defaultMetricKey?: string;
      defaultSort?: "chronological" | "desc" | "asc";
      options: Array<{
        key: string;
        label: string;
        bars: AnalysisBarPoint[];
      }>;
    }
  | {
      type: "selectableLine";
      yLabel?: string;
      defaultMetricKey?: string;
      maxCompare?: number;
      primaryKey: string;
      compareCandidates: Array<{ key: string; label: string }>;
      defaultCompareKeys?: string[];
      options: Array<{
        key: string;
        label: string;
        series: Array<{
          key: string;
          label: string;
          points: Array<{ x: number; y: number; label?: string }>;
        }>;
      }>;
    };

export interface AnalysisSection {
  id: string;
  title: string;
  group?: "Overview" | "Performance" | "Rounds" | "Countries" | "Opponents" | "Rating";
  appliesFilters?: Array<"date" | "mode" | "gameMode" | "movement" | "teammate" | "country">;
  lines: string[];
  lineDrilldowns?: AnalysisLineDrilldown[];
  lineLinks?: Array<{ lineLabel: string; url: string }>;
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
  round: RoundRow;
  ts: number;
  day: number;
  gameId: string;
  roundNumber: number;
  score: number;
  timeSec: number | undefined;
  distKm: number | undefined;
  guessCountry?: string;
  trueCountry?: string;
  trueLat?: number;
  trueLng?: number;
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
  const drilldownMetaByGameId = new Map<string, AnalysisDrilldownMeta>();
  for (const g of teamGames) {
    drilldownMetaByGameId.set(g.gameId, {
      movementLabel: movementTypeLabel(movementByGameId.get(g.gameId) || "unknown"),
      gameModeLabel: gameModeLabel(getGameMode(g)),
      ownPlayerId
    });
  }
  for (const d of teamDetails) {
    const meta = drilldownMetaByGameId.get(d.gameId);
    if (!meta) continue;
    const teammateName = getTeammateNameForGame(d, ownPlayerId, nameMap);
    if (teammateName) meta.teammateName = teammateName;
  }
  const toDrilldownItem = (r: RoundRow, ts?: number, score?: number): AnalysisDrilldownItem =>
    toDrilldownFromRound(r, ts, score, drilldownMetaByGameId.get(r.gameId));

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
  const overviewTimePlayedMs = rounds
    .map(extractTimeMs)
    .filter((v): v is number => typeof v === "number")
    .reduce((acc, v) => acc + v, 0);
  const overviewTimedRounds = rounds.reduce((acc, r) => acc + (typeof extractTimeMs(r) === "number" ? 1 : 0), 0);
  const roundMetrics = rounds
    .map((r) => {
      const ts = playedAtByGameId.get(r.gameId);
      const score = extractScore(r);
      const timeMs = extractTimeMs(r);
      const distMeters = extractDistanceMeters(r);
      if (ts === undefined || typeof score !== "number") return undefined;
      const item: RoundMetric = {
        round: r,
        ts,
        day: startOfLocalDay(ts),
        gameId: r.gameId,
        roundNumber: r.roundNumber,
        score,
        timeSec: typeof timeMs === "number" ? timeMs / 1e3 : undefined,
        distKm: typeof distMeters === "number" ? distMeters / 1e3 : undefined,
        guessCountry: normalizeCountryCode(getString(asRecord(r), "p1_guessCountry")),
        trueCountry: normalizeCountryCode(r.trueCountry),
        trueLat: typeof r.trueLat === "number" ? r.trueLat : undefined,
        trueLng: typeof r.trueLng === "number" ? r.trueLng : undefined
      };
      return item;
    })
    .filter((x): x is RoundMetric => x !== undefined);
  const fiveKCount = roundMetrics.filter((x) => x.score >= 5000).length;
  const throwCount = roundMetrics.filter((x) => x.score < 50).length;
  const perfectFiveKDrill = roundMetrics
    .filter((x) => x.score >= 5000)
    .map((x) => toDrilldownItem(x.round, x.ts, x.score));
  const nearPerfectDrill = roundMetrics
    .filter((x) => x.score >= 4500)
    .map((x) => toDrilldownItem(x.round, x.ts, x.score));
  const lowScoreDrill = roundMetrics
    .filter((x) => x.score < 500)
    .map((x) => toDrilldownItem(x.round, x.ts, x.score));
  const throwDrill = roundMetrics
    .filter((x) => x.score < 50)
    .map((x) => toDrilldownItem(x.round, x.ts, x.score));
  const overviewBucketMs = pickOverviewBucketMs(Math.max(0, gameTimes[gameTimes.length - 1] - gameTimes[0]));
  const overviewBucketDays = overviewBucketMs ? Math.round(overviewBucketMs / DAY_MS) : 0;
  const gamesPerDayPoints = buildOverviewGamesSeries(games.map((g) => g.playedAt), gameTimes[0], gameTimes[gameTimes.length - 1], overviewBucketMs);
  const avgScorePerDayPoints = buildOverviewAvgScoreSeries(
    rounds
      .map((r) => ({ ts: playedAtByGameId.get(r.gameId) || 0, value: extractScore(r) }))
      .filter((x): x is { ts: number; value: number } => x.ts > 0 && typeof x.value === "number"),
    overviewBucketMs
  );

  const overviewLines: string[] = [];
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
        `Avg score: ${fmt(avg(scores), 1)} | Median: ${fmt(median(scores), 1)} | StdDev: ${fmt(stdDev(scores), 1)}`,
        `Avg distance: ${fmt(avg(distancesKm), 2)} km | Median: ${fmt(median(distancesKm), 2)} km`,
        `Avg time: ${fmt(avg(timesSec), 1)} s | Median: ${fmt(median(timesSec), 1)} s`,
        `Time played: ${overviewTimedRounds > 0 ? formatDurationHuman(overviewTimePlayedMs) : "-"}${
          overviewTimedRounds > 0 && overviewTimedRounds < rounds.length ? ` (from ${overviewTimedRounds}/${rounds.length} rounds with time data)` : ""
        }`,
        `Perfect 5k rounds: ${fiveKCount} (${fmt(pct(fiveKCount, roundMetrics.length), 1)}%)`,
        `Throws (<50): ${throwCount} (${fmt(pct(throwCount, roundMetrics.length), 1)}%)`,
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
  overviewLines.push(...breakdownLines);

  sections.push({
    id: "overview",
    title: "Overview",
    group: "Overview",
    appliesFilters: ["date", "mode", "movement", "teammate", "country"],
    lines: overviewLines,
    lineDrilldowns: [
      { lineLabel: "Perfect 5k rounds", items: perfectFiveKDrill },
      { lineLabel: "Throws (<50)", items: throwDrill }
    ],
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
  const weekdayDrilldowns = wdNames.map<AnalysisDrilldownItem[]>(() => []);
  const hourDrilldowns: AnalysisDrilldownItem[][] = Array.from({ length: 24 }, () => []);
  for (const r of rounds) {
    const ts = playedAtByGameId.get(r.gameId);
    if (typeof ts !== "number") continue;
    const d = new Date(ts);
    const wd = d.getDay();
    const hr = d.getHours();
    weekdayDrilldowns[wd].push(toDrilldownItem(r, ts, extractScore(r)));
    hourDrilldowns[hr].push(toDrilldownItem(r, ts, extractScore(r)));
  }
  const weekdayMetricOptions = [
    {
      key: "games",
      label: "Games",
      bars: weekday.map((v, i) => ({ label: wdNames[i], value: v, drilldown: weekdayDrilldowns[i] }))
    },
    {
      key: "avg_score",
      label: "Avg score",
      bars: wdNames.map((name, i) => ({
        label: name,
        value: weekdayScoreCount[i] ? weekdayScoreSum[i] / weekdayScoreCount[i] : 0,
        drilldown: weekdayDrilldowns[i]
      }))
    },
    {
      key: "avg_time",
      label: "Avg guess time (s)",
      bars: wdNames.map((name, i) => ({
        label: name,
        value: weekdayTimeCount[i] ? weekdayTimeSum[i] / weekdayTimeCount[i] / 1e3 : 0,
        drilldown: weekdayDrilldowns[i]
      }))
    },
    {
      key: "throw_rate",
      label: "Throw rate (%)",
      bars: wdNames.map((name, i) => ({
        label: name,
        value: weekdayRounds[i] ? pct(weekdayThrows[i], weekdayRounds[i]) : 0,
        drilldown: weekdayDrilldowns[i]
      }))
    },
    {
      key: "fivek_rate",
      label: "5k rate (%)",
      bars: wdNames.map((name, i) => ({
        label: name,
        value: weekdayRounds[i] ? pct(weekdayFiveKs[i], weekdayRounds[i]) : 0,
        drilldown: weekdayDrilldowns[i]
      }))
    }
  ];
  const hourMetricOptions = [
    {
      key: "games",
      label: "Games",
      bars: hour.map((v, h) => ({ label: String(h).padStart(2, "0"), value: v, drilldown: hourDrilldowns[h] }))
    },
    {
      key: "avg_score",
      label: "Avg score",
      bars: hour.map((_, h) => ({
        label: String(h).padStart(2, "0"),
        value: hourScoreCount[h] ? hourScoreSum[h] / hourScoreCount[h] : 0,
        drilldown: hourDrilldowns[h]
      }))
    },
    {
      key: "avg_time",
      label: "Avg guess time (s)",
      bars: hour.map((_, h) => ({
        label: String(h).padStart(2, "0"),
        value: hourTimeCount[h] ? hourTimeSum[h] / hourTimeCount[h] / 1e3 : 0,
        drilldown: hourDrilldowns[h]
      }))
    },
    {
      key: "throw_rate",
      label: "Throw rate (%)",
      bars: hour.map((_, h) => ({
        label: String(h).padStart(2, "0"),
        value: hourRounds[h] ? pct(hourThrows[h], hourRounds[h]) : 0,
        drilldown: hourDrilldowns[h]
      }))
    },
    {
      key: "fivek_rate",
      label: "5k rate (%)",
      bars: hour.map((_, h) => ({
        label: String(h).padStart(2, "0"),
        value: hourRounds[h] ? pct(hourFiveKs[h], hourRounds[h]) : 0,
        drilldown: hourDrilldowns[h]
      }))
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
  const sessionDrillByIdx = new Map<number, AnalysisDrilldownItem[]>();
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
    const drill = sessionDrillByIdx.get(idx) || [];
    drill.push(toDrilldownItem(rm.round, rm.ts, rm.score));
    sessionDrillByIdx.set(idx, drill);
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
        return { label: formatShortDateTime(s.start), value: rate, drilldown: sessionDrillByIdx.get(s.idx) || [] };
      })
    : [];
  const sessionMetricOptions: Array<{ key: string; label: string; bars: AnalysisBarPoint[] }> = [
    {
      key: "avg_score",
      label: "Avg score",
      bars: sessionRows.map((s) => ({ label: formatShortDateTime(s.start), value: s.avgScore, drilldown: sessionDrillByIdx.get(s.idx) || [] }))
    },
    {
      key: "throw_rate",
      label: "Throw rate (%)",
      bars: sessionRows.map((s) => ({ label: formatShortDateTime(s.start), value: s.throwRate, drilldown: sessionDrillByIdx.get(s.idx) || [] }))
    },
    {
      key: "fivek_rate",
      label: "5k rate (%)",
      bars: sessionRows.map((s) => ({ label: formatShortDateTime(s.start), value: s.fiveKRate, drilldown: sessionDrillByIdx.get(s.idx) || [] }))
    },
    {
      key: "avg_duration",
      label: "Avg duration (s)",
      bars: sessionRows.map((s) => ({ label: formatShortDateTime(s.start), value: s.avgTime || 0, drilldown: sessionDrillByIdx.get(s.idx) || [] }))
    },
    { key: "games", label: "Games", bars: sessionRows.map((s) => ({ label: formatShortDateTime(s.start), value: s.games, drilldown: sessionDrillByIdx.get(s.idx) || [] })) },
    { key: "rounds", label: "Rounds", bars: sessionRows.map((s) => ({ label: formatShortDateTime(s.start), value: s.rounds, drilldown: sessionDrillByIdx.get(s.idx) || [] })) }
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
    timeSum: 0,
    drilldown: [] as AnalysisDrilldownItem[]
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
    bucket.drilldown.push(toDrilldownItem(rm.round, rm.ts, rm.score));
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
  const tempoMetricOptions: Array<{ key: string; label: string; bars: AnalysisBarPoint[] }> = [
    { key: "avg_score", label: "Avg score", bars: tempoAgg.map((b) => ({ label: b.name, value: avg(b.scores) || 0, drilldown: b.drilldown })) },
    { key: "avg_distance", label: "Avg distance (km)", bars: tempoAgg.map((b) => ({ label: b.name, value: avg(b.dist) || 0, drilldown: b.drilldown })) },
    { key: "throw_rate", label: "Throw rate (%)", bars: tempoAgg.map((b) => ({ label: b.name, value: b.n ? pct(b.throws, b.n) : 0, drilldown: b.drilldown })) },
    { key: "fivek_rate", label: "5k rate (%)", bars: tempoAgg.map((b) => ({ label: b.name, value: b.n ? pct(b.fiveKs, b.n) : 0, drilldown: b.drilldown })) },
    { key: "rounds", label: "Rounds", bars: tempoAgg.map((b) => ({ label: b.name, value: b.n, drilldown: b.drilldown })) }
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
  const scoreDistributionBars = buildSmoothedScoreDistributionWithDrilldown(
    roundMetrics.map((rm) => ({
      score: rm.score,
      drill: toDrilldownItem(rm.round, rm.ts, rm.score)
    }))
  );
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
    lineDrilldowns: [
      { lineLabel: "Perfect 5k", items: perfectFiveKDrill },
      { lineLabel: "Near-perfect (>=4500)", items: nearPerfectDrill },
      { lineLabel: "Low scores (<500)", items: lowScoreDrill },
      { lineLabel: "Throws (<50)", items: throwDrill }
    ],
    chart: {
      type: "bar",
      yLabel: "Score distribution (smoothed)",
      bars: scoreDistributionBars
    }
  });

  const roundMetricsForRoundSection = teamRounds
    .map((r) => {
      const ts = teamPlayedAtByGameId.get(r.gameId);
      const score = extractScore(r);
      const timeMs = extractTimeMs(r);
      const distMeters = extractDistanceMeters(r);
      if (ts === undefined || typeof score !== "number") return undefined;
      return {
        round: r,
        ts,
        gameId: r.gameId,
        roundNumber: r.roundNumber,
        score,
        timeSec: typeof timeMs === "number" ? timeMs / 1e3 : undefined,
        distKm: typeof distMeters === "number" ? distMeters / 1e3 : undefined,
        guessCountry: normalizeCountryCode(getString(asRecord(r), "p1_guessCountry")),
        trueCountry: normalizeCountryCode(r.trueCountry)
      };
    })
    .filter(
      (
        x
      ): x is {
        round: RoundRow;
        ts: number;
        gameId: string;
        roundNumber: number;
        score: number;
        timeSec?: number;
        distKm?: number;
        guessCountry?: string;
        trueCountry?: string;
      } => !!x
    )
    .sort((a, b) => (a.ts !== b.ts ? a.ts - b.ts : a.roundNumber - b.roundNumber));

  type RoundNumberBucket = {
    roundNumber: number;
    n: number;
    scoreSum: number;
    hit: number;
    throws: number;
    fiveKs: number;
    distSum: number;
    distN: number;
    timeSum: number;
    timeN: number;
    drilldown: AnalysisDrilldownItem[];
  };
  const roundBucketsByNumber = new Map<number, RoundNumberBucket>();
  for (const rm of roundMetricsForRoundSection) {
    const key = rm.roundNumber;
    const b = roundBucketsByNumber.get(key) || {
        roundNumber: key,
        n: 0,
        scoreSum: 0,
        hit: 0,
        throws: 0,
        fiveKs: 0,
        distSum: 0,
        distN: 0,
        timeSum: 0,
        timeN: 0,
        drilldown: []
      };
    b.n++;
    b.scoreSum += rm.score;
    if (rm.guessCountry && rm.trueCountry && rm.guessCountry === rm.trueCountry) b.hit++;
    if (rm.score < 50) b.throws++;
    if (rm.score >= 5000) b.fiveKs++;
    if (typeof rm.distKm === "number" && Number.isFinite(rm.distKm)) {
      b.distSum += rm.distKm;
      b.distN++;
    }
    if (typeof rm.timeSec === "number" && Number.isFinite(rm.timeSec)) {
      b.timeSum += rm.timeSec;
      b.timeN++;
    }
    b.drilldown.push(toDrilldownItem(rm.round, rm.ts, rm.score));
    roundBucketsByNumber.set(key, b);
  }
  const roundBuckets = [...roundBucketsByNumber.values()].sort((a, b) => a.roundNumber - b.roundNumber);

  const roundProgressionOptions: Array<{ key: string; label: string; bars: AnalysisBarPoint[] }> = [
    {
      key: "avg_score",
      label: "Avg score",
      bars: roundBuckets.map((b) => ({
        label: `#${b.roundNumber}`,
        value: b.n > 0 ? b.scoreSum / b.n : 0,
        drilldown: b.drilldown
      }))
    },
    {
      key: "hit_rate",
      label: "Hit rate (%)",
      bars: roundBuckets.map((b) => ({
        label: `#${b.roundNumber}`,
        value: b.n > 0 ? (b.hit / b.n) * 100 : 0,
        drilldown: b.drilldown
      }))
    },
    {
      key: "throw_rate",
      label: "Throw rate (%)",
      bars: roundBuckets.map((b) => ({
        label: `#${b.roundNumber}`,
        value: b.n > 0 ? (b.throws / b.n) * 100 : 0,
        drilldown: b.drilldown
      }))
    },
    {
      key: "fivek_rate",
      label: "5k rate (%)",
      bars: roundBuckets.map((b) => ({
        label: `#${b.roundNumber}`,
        value: b.n > 0 ? (b.fiveKs / b.n) * 100 : 0,
        drilldown: b.drilldown
      }))
    },
    {
      key: "avg_distance",
      label: "Avg distance (km)",
      bars: roundBuckets.map((b) => ({
        label: `#${b.roundNumber}`,
        value: b.distN > 0 ? b.distSum / b.distN : 0,
        drilldown: b.drilldown
      }))
    },
    {
      key: "avg_time",
      label: "Avg guess time (s)",
      bars: roundBuckets.map((b) => ({
        label: `#${b.roundNumber}`,
        value: b.timeN > 0 ? b.timeSum / b.timeN : 0,
        drilldown: b.drilldown
      }))
    },
    {
      key: "rounds",
      label: "Rounds",
      bars: roundBuckets.map((b) => ({
        label: `#${b.roundNumber}`,
        value: b.n,
        drilldown: b.drilldown
      }))
    }
  ];

  const roundsByGame = new Map<string, typeof roundMetricsForRoundSection[number][]>();
  for (const rm of roundMetricsForRoundSection) {
    if (!roundsByGame.has(rm.gameId)) roundsByGame.set(rm.gameId, []);
    roundsByGame.get(rm.gameId)!.push(rm);
  }
  const gameRoundEntries = [...roundsByGame.entries()].map(([gameId, items]) => ({ gameId, items, n: items.length }));
  const maxRoundsEntry = gameRoundEntries.slice().sort((a, b) => b.n - a.n)[0];
  const minRoundsEligibleEntries = gameRoundEntries.filter((x) => x.n >= 2);
  const minRoundsSource = minRoundsEligibleEntries.length > 0 ? minRoundsEligibleEntries : gameRoundEntries;
  const minRounds = minRoundsSource.length > 0 ? Math.min(...minRoundsSource.map((x) => x.n)) : 0;
  const minRoundsEntries = minRoundsSource.filter((x) => x.n === minRounds);
  const maxSpreadEntry = gameRoundEntries
    .map((x) => {
      const scores = x.items.map((r) => r.score);
      const spread = scores.length > 0 ? Math.max(...scores) - Math.min(...scores) : 0;
      return { ...x, spread };
    })
    .sort((a, b) => b.spread - a.spread)[0];
  const maxThrowsEntry = gameRoundEntries
    .map((x) => ({ ...x, throws: x.items.filter((r) => r.score < 50).length }))
    .sort((a, b) => b.throws - a.throws)[0];
  const avgScoreSource = minRoundsEligibleEntries.length > 0 ? minRoundsEligibleEntries : gameRoundEntries;
  const bestAvgEntry = avgScoreSource
    .map((x) => ({ ...x, avgScore: x.n > 0 ? x.items.reduce((sum, r) => sum + r.score, 0) / x.n : 0 }))
    .sort((a, b) => b.avgScore - a.avgScore)[0];
  const worstAvgEntry = avgScoreSource
    .map((x) => ({ ...x, avgScore: x.n > 0 ? x.items.reduce((sum, r) => sum + r.score, 0) / x.n : 0 }))
    .sort((a, b) => a.avgScore - b.avgScore)[0];

  const gameEntryDrill = (entry?: { items: RoundMetric[] }): AnalysisDrilldownItem[] =>
    entry ? entry.items.map((r) => toDrilldownItem(r.round, r.ts, r.score)) : [];
  const gameDateLabel = (entry?: { items: RoundMetric[] }): string =>
    entry && entry.items.length > 0 ? formatShortDateTime(entry.items[0].ts) : "-";

  sections.push({
    id: "rounds",
    title: "Rounds",
    group: "Rounds",
    appliesFilters: ["date", "mode", "teammate"],
    lines: [
      `Game with most rounds: ${maxRoundsEntry ? `${maxRoundsEntry.n} rounds (${gameDateLabel(maxRoundsEntry)})` : "-"}`,
      `Games with fewest rounds: ${minRoundsEntries.length > 0 ? `${minRounds} rounds (${minRoundsEntries.length} game(s))` : "-"}`,
      `Largest score spread (max-min in one game): ${maxSpreadEntry ? `${fmt(maxSpreadEntry.spread, 0)} points (${gameDateLabel(maxSpreadEntry)})` : "-"}`,
      `Most throws (<50) in one game: ${maxThrowsEntry ? `${maxThrowsEntry.throws} throws (${gameDateLabel(maxThrowsEntry)})` : "-"}`
    ],
    lineDrilldowns: [
      { lineLabel: "Game with most rounds", items: gameEntryDrill(maxRoundsEntry) },
      { lineLabel: "Games with fewest rounds", items: minRoundsEntries.flatMap((entry) => gameEntryDrill(entry)) },
      { lineLabel: "Largest score spread (max-min in one game)", items: gameEntryDrill(maxSpreadEntry) },
      { lineLabel: "Most throws (<50) in one game", items: gameEntryDrill(maxThrowsEntry) }
    ],
    chart:
      roundProgressionOptions.length > 0
        ? {
            type: "selectableBar",
            yLabel: "Round progression metrics",
            initialBars: 50,
            orientation: "vertical",
            allowSort: false,
            defaultSort: "chronological",
            defaultMetricKey: "avg_score",
            options: roundProgressionOptions
          }
        : undefined
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
  const countryDrilldowns = new Map<string, AnalysisDrilldownItem[]>();
  const confusionDrilldowns = new Map<string, AnalysisDrilldownItem[]>();
  for (const r of teamRounds) {
    const t = normalizeCountryCode(r.trueCountry);
    if (!t) continue;
    const ts = teamPlayedAtByGameId.get(r.gameId);
    const sc = extractScore(r);
    const drillItem = toDrilldownItem(r, ts, sc);
    if (!countryDrilldowns.has(t)) countryDrilldowns.set(t, []);
    countryDrilldowns.get(t)!.push(drillItem);
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
      } else {
        const cKey = `${t}|${guess}`;
        if (!confusionDrilldowns.has(cKey)) confusionDrilldowns.set(cKey, []);
        confusionDrilldowns.get(cKey)!.push(drillItem);
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
  const totalDamageDealt = topCountries.reduce((acc, [, v]) => acc + v.damageDealt, 0);
  const totalDamageTaken = topCountries.reduce((acc, [, v]) => acc + v.damageTaken, 0);
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
      avgDamageTaken: v.damageN > 0 ? v.damageTaken / v.damageN : 0,
      damageDealtShare: totalDamageDealt > 0 ? (v.damageDealt / totalDamageDealt) * 100 : 0,
      damageTakenShare: totalDamageTaken > 0 ? (v.damageTaken / totalDamageTaken) * 100 : 0
    }));
  const countryMetricOptions: Array<{ key: string; label: string; bars: AnalysisBarPoint[] }> = [
    {
      key: "avg_score",
      label: "Avg score",
      bars: countryMetricRows.map((x) => ({ label: countryLabel(x.country), value: x.avgScore, drilldown: countryDrilldowns.get(x.country) || [] }))
    },
    {
      key: "avg_score_correct_only",
      label: "Avg score (correct guesses only)",
      bars: countryMetricRows.map((x) => ({
        label: countryLabel(x.country),
        value: x.avgScoreCorrectOnly,
        drilldown: (countryDrilldowns.get(x.country) || []).filter(
          (d) => d.trueCountry && d.guessCountry && d.trueCountry === d.guessCountry
        )
      }))
    },
    {
      key: "hit_rate",
      label: "Hit rate (%)",
      bars: countryMetricRows.map((x) => ({ label: countryLabel(x.country), value: x.hitRate * 100, drilldown: countryDrilldowns.get(x.country) || [] }))
    },
    {
      key: "avg_distance",
      label: "Avg distance (km)",
      bars: countryMetricRows.map((x) => ({ label: countryLabel(x.country), value: x.avgDist || 0, drilldown: countryDrilldowns.get(x.country) || [] }))
    },
    {
      key: "throw_rate",
      label: "Throw rate (%)",
      bars: countryMetricRows.map((x) => ({ label: countryLabel(x.country), value: x.throwRate * 100, drilldown: countryDrilldowns.get(x.country) || [] }))
    },
    {
      key: "fivek_rate",
      label: "5k rate (%)",
      bars: countryMetricRows.map((x) => ({ label: countryLabel(x.country), value: x.fiveKRate * 100, drilldown: countryDrilldowns.get(x.country) || [] }))
    },
    {
      key: "damage_dealt",
      label: "Avg damage dealt",
      bars: countryMetricRows.map((x) => ({ label: countryLabel(x.country), value: x.avgDamageDealt, drilldown: countryDrilldowns.get(x.country) || [] }))
    },
    {
      key: "damage_taken",
      label: "Avg damage taken",
      bars: countryMetricRows.map((x) => ({ label: countryLabel(x.country), value: x.avgDamageTaken, drilldown: countryDrilldowns.get(x.country) || [] }))
    },
    {
      key: "damage_dealt_share",
      label: "Damage dealt share (%)",
      bars: countryMetricRows.map((x) => ({ label: countryLabel(x.country), value: x.damageDealtShare, drilldown: countryDrilldowns.get(x.country) || [] }))
    },
    {
      key: "damage_taken_share",
      label: "Damage taken share (%)",
      bars: countryMetricRows.map((x) => ({ label: countryLabel(x.country), value: x.damageTakenShare, drilldown: countryDrilldowns.get(x.country) || [] }))
    },
    {
      key: "rounds",
      label: "Rounds",
      bars: countryMetricRows.map((x) => ({ label: countryLabel(x.country), value: x.n, drilldown: countryDrilldowns.get(x.country) || [] }))
    }
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
          value: x.n,
          drilldown: confusionDrilldowns.get(`${x.truth}|${x.guess}`) || []
        }))
      }
    ]
  });

  type OpponentEncounter = {
    opponentId: string;
    opponentName: string;
    opponentCountry: string;
    gameId: string;
    ts?: number;
    result?: GameResult;
    gameMode?: string;
  };

  const opponentCounts = new Map<string, { games: number; name?: string; country?: string }>();
  const opponentEncounters: OpponentEncounter[] = [];
  for (const d of teamDetails) {
    const dd = asRecord(d);
    const ids: Array<{ id?: string; name?: string; country?: string }> = [];
    const modeFamily = getString(dd, "modeFamily");
    const ts = teamPlayedAtByGameId.get(d.gameId);
    const result = getGameResult(d, ownPlayerId);
    const modeLabel = drilldownMetaByGameId.get(d.gameId)?.gameModeLabel;
    if (modeFamily === "duels") {
      ids.push({
        id: getString(dd, "playerTwoId") ?? getString(dd, "p2_playerId"),
        name: getString(dd, "playerTwoName") ?? getString(dd, "p2_playerName"),
        country: getString(dd, "playerTwoCountry")
      });
    } else if (modeFamily === "teamduels") {
      ids.push({
        id: getString(dd, "p3_playerId") ?? getString(dd, "teamTwoPlayerOneId"),
        name: getString(dd, "p3_playerName") ?? getString(dd, "teamTwoPlayerOneName"),
        country: getString(dd, "teamTwoPlayerOneCountry")
      });
      ids.push({
        id: getString(dd, "p4_playerId") ?? getString(dd, "teamTwoPlayerTwoId"),
        name: getString(dd, "p4_playerName") ?? getString(dd, "teamTwoPlayerTwoName"),
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
      opponentEncounters.push({
        opponentId: x.id,
        opponentName: x.name || nameMap.get(x.id) || x.id.slice(0, 8),
        opponentCountry: x.country?.trim() || "Unknown",
        gameId: d.gameId,
        ts,
        result,
        gameMode: modeLabel
      });
    }
  }

  const topOpp = [...opponentCounts.entries()].sort((a, b) => b[1].games - a[1].games).slice(0, 20);
  const oppCountryCounts = new Map<string, number>();
  for (const [, v] of opponentCounts) {
    const c = typeof v.country === "string" && v.country.trim() ? v.country.trim() : "Unknown";
    oppCountryCounts.set(c, (oppCountryCounts.get(c) || 0) + v.games);
  }
  const drillForOpponent = (e: OpponentEncounter): AnalysisDrilldownItem => {
    const count = opponentCounts.get(e.opponentId)?.games || 0;
    return {
      gameId: e.gameId,
      roundNumber: 0,
      ts: e.ts,
      gameMode: e.gameMode,
      result: e.result,
      matchups: count,
      opponentId: e.opponentId,
      opponentName: e.opponentName,
      opponentCountry: e.opponentCountry,
      opponentProfileUrl: buildUserProfileUrl(e.opponentId)
    };
  };
  const opponentDrilldowns = new Map<string, AnalysisDrilldownItem[]>();
  const countryOpponentDrilldowns = new Map<string, AnalysisDrilldownItem[]>();
  for (const e of opponentEncounters) {
    const byOpponent = opponentDrilldowns.get(e.opponentId) || [];
    byOpponent.push(drillForOpponent(e));
    opponentDrilldowns.set(e.opponentId, byOpponent);
    const c = e.opponentCountry?.trim() || "Unknown";
    const byCountry = countryOpponentDrilldowns.get(c) || [];
    byCountry.push(drillForOpponent(e));
    countryOpponentDrilldowns.set(c, byCountry);
  }
  const top3LineEntries = topOpp.slice(0, 3).map(([id, v], i) => {
    const displayName = v.name || id.slice(0, 8);
    return {
      lineLabel: `${i + 1}. ${displayName}`,
      lineText: `${i + 1}. ${displayName}: ${v.games} match-ups${v.country ? ` (${v.country})` : ""}`,
      profileUrl: buildUserProfileUrl(id),
      drill: opponentDrilldowns.get(id) || []
    };
  });

  sections.push({
    id: "opponents",
    title: "Opponents",
    group: "Opponents",
    appliesFilters: ["date", "mode", "teammate"],
    lines: [
      selectedCountry ? `Country filter is ignored here (showing all countries for selected time/mode/team).` : "",
      "Top 3 opponents:",
      ...top3LineEntries.map((x) => x.lineText),
      "Scope:",
      `Unique opponents: ${opponentCounts.size}`,
      `Unique countries: ${oppCountryCounts.size}`
    ].filter((x) => x !== ""),
    lineLinks: top3LineEntries
      .filter((x) => typeof x.profileUrl === "string")
      .map((x) => ({ lineLabel: x.lineLabel, url: x.profileUrl as string })),
    lineDrilldowns: top3LineEntries.map((x) => ({ lineLabel: x.lineLabel, items: x.drill })),
    chart: {
      type: "bar",
      yLabel: "Match-ups by opponent country",
      bars: [...oppCountryCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([c, n]) => ({ label: c, value: n, drilldown: countryOpponentDrilldowns.get(c) || [] }))
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
    const teamTimePlayedMs = roundsTogether
      .map(extractTimeMs)
      .filter((v): v is number => typeof v === "number")
      .reduce((acc, v) => acc + v, 0);
    const teamTimedRounds = roundsTogether.reduce((acc, r) => acc + (typeof extractTimeMs(r) === "number" ? 1 : 0), 0);
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
        `Time played together: ${teamTimedRounds > 0 ? formatDurationHuman(teamTimePlayedMs) : "-"}${
          teamTimedRounds > 0 && teamTimedRounds < roundsTogether.length
            ? ` (from ${teamTimedRounds}/${roundsTogether.length} rounds with time data)`
            : ""
        }`,
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

    const countryRounds = teamRounds.filter((r) => normalizeCountryCode(r.trueCountry) === spotlightCountry);
    const countryRoundMetrics = countryRounds
      .map((r) => {
        const ts = teamPlayedAtByGameId.get(r.gameId);
        const score = extractScore(r);
        if (typeof ts !== "number" || typeof score !== "number") return undefined;
        const guessCountry = normalizeCountryCode(getString(asRecord(r), "p1_guessCountry"));
        const trueCountry = normalizeCountryCode(r.trueCountry);
        return {
          score,
          guessCountry,
          trueCountry,
          drill: toDrilldownItem(r, ts, score)
        };
      })
      .filter(
        (
          x
        ): x is {
          score: number;
          guessCountry: string | undefined;
          trueCountry: string | undefined;
          drill: AnalysisDrilldownItem;
        } => x !== undefined
      );
    const countryScores = countryRounds.map(extractScore).filter((x): x is number => typeof x === "number");
    const countryFiveK = countryScores.filter((s) => s >= 5000).length;
    const countryThrows = countryScores.filter((s) => s < 50).length;
    const distributionAll = buildSmoothedScoreDistributionWithDrilldown(countryRoundMetrics.map((x) => ({ score: x.score, drill: x.drill })));
    const distributionCorrectOnly = buildSmoothedScoreDistributionWithDrilldown(
      countryRoundMetrics
        .filter((x) => x.guessCountry && x.trueCountry && x.guessCountry === x.trueCountry)
        .map((x) => ({ score: x.score, drill: x.drill }))
    );
    const spotlightCandidates: string[] = [
      spotlightCountry,
      ...topCountries.map(([country]) => country).filter((country) => country !== spotlightCountry).slice(0, 24)
    ];

    const spanStartRaw = teamGames[0]?.playedAt ?? gameTimes[0];
    const spanEndRaw = teamGames[teamGames.length - 1]?.playedAt ?? gameTimes[gameTimes.length - 1];
    const spanStart = typeof spanStartRaw === "number" && Number.isFinite(spanStartRaw) ? spanStartRaw : 0;
    const spanEnd = typeof spanEndRaw === "number" && Number.isFinite(spanEndRaw) ? spanEndRaw : spanStart;
    const timelineBucketMs = pickOverviewBucketMs(Math.max(0, spanEnd - spanStart));
    const countryTimeline = new Map<
      string,
      Map<number, { rounds: number; scoreSum: number; correct: number; throws: number; fiveKs: number; damageDealt: number; damageTaken: number }>
    >();
    const totalDamageByBucket = new Map<number, { dealt: number; taken: number }>();
    const bucketSet = new Set<number>();

    for (const r of teamRounds) {
      const ts = teamPlayedAtByGameId.get(r.gameId);
      const country = normalizeCountryCode(r.trueCountry);
      if (!ts || !country || !spotlightCandidates.includes(country)) continue;
      const day = startOfLocalDay(ts);
      const bucket = timelineBucketMs ? Math.floor(day / timelineBucketMs) * timelineBucketMs : day;
      bucketSet.add(bucket);
      if (!countryTimeline.has(country)) countryTimeline.set(country, new Map());
      const byBucket = countryTimeline.get(country)!;
      const cur = byBucket.get(bucket) || { rounds: 0, scoreSum: 0, correct: 0, throws: 0, fiveKs: 0, damageDealt: 0, damageTaken: 0 };
      cur.rounds += 1;
      const sc = extractScore(r);
      if (typeof sc === "number") {
        cur.scoreSum += sc;
        if (sc < 50) cur.throws += 1;
        if (sc >= 5000) cur.fiveKs += 1;
      }
      const guess = normalizeCountryCode(getString(asRecord(r), "p1_guessCountry"));
      if (guess && guess === country) cur.correct += 1;
      if (ownPlayerId) {
        const diff = getRoundDamageDiff(r, ownPlayerId);
        if (typeof diff === "number" && Number.isFinite(diff)) {
          if (diff > 0) {
            cur.damageDealt += diff;
            const total = totalDamageByBucket.get(bucket) || { dealt: 0, taken: 0 };
            total.dealt += diff;
            totalDamageByBucket.set(bucket, total);
          } else if (diff < 0) {
            cur.damageTaken += -diff;
            const total = totalDamageByBucket.get(bucket) || { dealt: 0, taken: 0 };
            total.taken += -diff;
            totalDamageByBucket.set(bucket, total);
          }
        }
      }
      byBucket.set(bucket, cur);
    }

    const sortedBuckets = [...bucketSet].sort((a, b) => a - b);
    const MIN_BUCKET_ROUNDS_FOR_RATE = 5;
    const PRIOR_STRENGTH = 12;
    const smoothFraction = (success: number, total: number, prior: number, strength = PRIOR_STRENGTH): number => {
      if (total <= 0) return prior;
      const s = Math.max(0, Math.min(1, prior));
      return (success + s * strength) / (total + strength);
    };
    const makeCountrySeries = (
      metric:
        | "damage_dealt_share"
        | "damage_taken_share"
        | "avg_score"
        | "hit_rate"
        | "throw_rate"
        | "fivek_rate"
        | "rounds"
        | "avg_damage_dealt"
        | "avg_damage_taken"
    ) =>
      spotlightCandidates.map((country) => {
        const byBucket = countryTimeline.get(country) || new Map();
        const overall = countryAgg.get(country);
        const overallRounds = overall?.n || 0;
        const overallAvgScore = overall && overall.score.length > 0 ? overall.score.reduce((a, b) => a + b, 0) / overall.score.length : 0;
        const overallHitRate = overallRounds > 0 ? overall.correct / overallRounds : 0;
        const overallThrowRate = overall && overall.score.length > 0 ? overall.throws / overall.score.length : 0;
        const overallFiveKRate = overall && overall.score.length > 0 ? overall.fiveKs / overall.score.length : 0;
        const overallAvgDamageDealt = overall && overallRounds > 0 ? overall.damageDealt / overallRounds : 0;
        const overallAvgDamageTaken = overall && overallRounds > 0 ? overall.damageTaken / overallRounds : 0;
        const overallDealtShare = totalDamageDealt > 0 && overall ? overall.damageDealt / totalDamageDealt : 0;
        const overallTakenShare = totalDamageTaken > 0 && overall ? overall.damageTaken / totalDamageTaken : 0;
        let lastY: number | undefined;
        const points = sortedBuckets.map((bucket) => {
          const v = byBucket.get(bucket) || {
            rounds: 0,
            scoreSum: 0,
            correct: 0,
            throws: 0,
            fiveKs: 0,
            damageDealt: 0,
            damageTaken: 0
          };
          const totals = totalDamageByBucket.get(bucket) || { dealt: 0, taken: 0 };
          let y: number | undefined;
          if (metric === "rounds") {
            y = v.rounds;
          } else if (metric === "avg_score") {
            y = v.rounds > 0 ? v.scoreSum / v.rounds : undefined;
          } else if (metric === "avg_damage_dealt") {
            y = v.rounds > 0 ? v.damageDealt / v.rounds : undefined;
          } else if (metric === "avg_damage_taken") {
            y = v.rounds > 0 ? v.damageTaken / v.rounds : undefined;
          } else if (metric === "hit_rate") {
            if (v.rounds >= MIN_BUCKET_ROUNDS_FOR_RATE) {
              y = smoothFraction(v.correct, v.rounds, overallHitRate) * 100;
            }
          } else if (metric === "throw_rate") {
            if (v.rounds >= MIN_BUCKET_ROUNDS_FOR_RATE) {
              y = smoothFraction(v.throws, v.rounds, overallThrowRate) * 100;
            }
          } else if (metric === "fivek_rate") {
            if (v.rounds >= MIN_BUCKET_ROUNDS_FOR_RATE) {
              y = smoothFraction(v.fiveKs, v.rounds, overallFiveKRate) * 100;
            }
          } else if (metric === "damage_dealt_share") {
            if (v.rounds >= MIN_BUCKET_ROUNDS_FOR_RATE && totals.dealt > 0) {
              y = smoothFraction(v.damageDealt, totals.dealt, overallDealtShare) * 100;
            }
          } else if (metric === "damage_taken_share") {
            if (v.rounds >= MIN_BUCKET_ROUNDS_FOR_RATE && totals.taken > 0) {
              y = smoothFraction(v.damageTaken, totals.taken, overallTakenShare) * 100;
            }
          }

          if (y === undefined) {
            if (lastY !== undefined) {
              y = lastY;
            } else if (metric === "rounds") {
              y = 0;
            } else if (metric === "avg_score") {
              y = overallAvgScore;
            } else if (metric === "avg_damage_dealt") {
              y = overallAvgDamageDealt;
            } else if (metric === "avg_damage_taken") {
              y = overallAvgDamageTaken;
            } else if (metric === "hit_rate") {
              y = overallHitRate * 100;
            } else if (metric === "throw_rate") {
              y = overallThrowRate * 100;
            } else if (metric === "fivek_rate") {
              y = overallFiveKRate * 100;
            } else if (metric === "damage_dealt_share") {
              y = overallDealtShare * 100;
            } else if (metric === "damage_taken_share") {
              y = overallTakenShare * 100;
            } else {
              y = 0;
            }
          }
          lastY = y;
          return { x: bucket, y, label: formatDay(bucket) };
        });
        return {
          key: country,
          label: countryLabel(country),
          points
        };
      });

    sections.push({
      id: "country_spotlight",
      title: `Country Spotlight: ${countryLabel(spotlightCountry)}`,
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
          type: "selectableBar",
          yLabel: "Score distribution (smoothed)",
          orientation: "vertical",
          allowSort: false,
          defaultMetricKey: "all_guesses",
          defaultSort: "chronological",
          options: [
            { key: "all_guesses", label: "All guesses", bars: distributionAll },
            { key: "correct_only", label: "Only correct-country guesses", bars: distributionCorrectOnly }
          ]
        },
        {
          type: "selectableLine",
          yLabel: "Country trend comparison",
          defaultMetricKey: "damage_dealt_share",
          primaryKey: spotlightCountry,
          maxCompare: 4,
          compareCandidates: spotlightCandidates
            .filter((country) => country !== spotlightCountry)
            .map((country) => ({ key: country, label: countryLabel(country) })),
          defaultCompareKeys: spotlightCandidates.filter((country) => country !== spotlightCountry).slice(0, 4),
          options: [
            { key: "damage_dealt_share", label: "Damage dealt share (%)", series: makeCountrySeries("damage_dealt_share") },
            { key: "damage_taken_share", label: "Damage taken share (%)", series: makeCountrySeries("damage_taken_share") },
            { key: "avg_score", label: "Avg score", series: makeCountrySeries("avg_score") },
            { key: "hit_rate", label: "Hit rate (%)", series: makeCountrySeries("hit_rate") },
            { key: "throw_rate", label: "Throw rate (%)", series: makeCountrySeries("throw_rate") },
            { key: "fivek_rate", label: "5k rate (%)", series: makeCountrySeries("fivek_rate") },
            { key: "avg_damage_dealt", label: "Avg damage dealt", series: makeCountrySeries("avg_damage_dealt") },
            { key: "avg_damage_taken", label: "Avg damage taken", series: makeCountrySeries("avg_damage_taken") },
            { key: "rounds", label: "Rounds", series: makeCountrySeries("rounds") }
          ]
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
      `Best avg score in a game: ${bestAvgEntry ? `${fmt(bestAvgEntry.avgScore, 1)} (${bestAvgEntry.n} rounds, ${gameDateLabel(bestAvgEntry)})` : "-"}`,
      `Worst avg score in a game: ${worstAvgEntry ? `${fmt(worstAvgEntry.avgScore, 1)} (${worstAvgEntry.n} rounds, ${gameDateLabel(worstAvgEntry)})` : "-"}`,
      `Fastest day: ${fastestDayRecord ? `${formatDay(fastestDayRecord.day)} (${fmt(fastestDayRecord.avgTime, 1)} s)` : "-"}`,
      `Slowest day: ${slowestDayRecord ? `${formatDay(slowestDayRecord.day)} (${fmt(slowestDayRecord.avgTime, 1)} s)` : "-"}`,
      `Best 5k streak: ${bestFivekStreak} rounds in a row`,
      `Worst throw streak (<50): ${worstThrowStreak} rounds in a row`
    ],
    lineDrilldowns: [
      { lineLabel: "Best avg score in a game", items: gameEntryDrill(bestAvgEntry) },
      { lineLabel: "Worst avg score in a game", items: gameEntryDrill(worstAvgEntry) }
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
