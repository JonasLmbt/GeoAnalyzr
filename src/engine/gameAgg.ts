import type { GameAggRow, RoundRow } from "../db";

export const GAME_AGG_VERSION = 1;

function normalizeMovementType(raw: unknown): GameAggRow["movementType"] {
  if (typeof raw !== "string") return "unknown";
  const s = raw.trim().toLowerCase();
  if (!s) return "unknown";
  if (s === "mixed") return "mixed";
  if (s.includes("nmpz")) return "nmpz";
  if (s.includes("no move") || s.includes("no_move") || s.includes("nomove") || s.includes("no moving")) return "no_move";
  if (s.includes("moving")) return "moving";
  return "unknown";
}

export function computeGameAggFromRounds(gameId: string, rounds: (RoundRow | any)[]): GameAggRow {
  const agg: GameAggRow = {
    gameId,
    aggVersion: GAME_AGG_VERSION,
    computedAt: Date.now(),
    roundsCount: 0
  };

  let movement: GameAggRow["movementType"] | undefined;

  for (const r of rounds as any[]) {
    if (!r || typeof r !== "object") continue;
    const gid = typeof r.gameId === "string" ? r.gameId : "";
    if (gid !== gameId) continue;

    agg.roundsCount++;

    const mvRaw = r.movementType ?? r.movement_type;
    const mv = normalizeMovementType(mvRaw);
    if (mv && mv !== "unknown") {
      if (!movement) movement = mv;
      else if (movement !== mv && movement !== "mixed") movement = "mixed";
    }

    const score =
      typeof r.player_self_score === "number"
        ? r.player_self_score
        : typeof r.p1_score === "number"
          ? r.p1_score
          : typeof r.score === "number"
            ? r.score
            : null;
    if (typeof score === "number" && Number.isFinite(score) && score >= 0) {
      agg.scoreSum = (agg.scoreSum ?? 0) + score;
      agg.scoreCount = (agg.scoreCount ?? 0) + 1;
      if (score >= 5000) agg.fivekCount = (agg.fivekCount ?? 0) + 1;
      if (score < 50) agg.throwCount = (agg.throwCount ?? 0) + 1;
    }

    const truth = typeof r.trueCountry === "string" ? r.trueCountry : typeof r.true_country === "string" ? r.true_country : "";
    const guess =
      typeof r.player_self_guessCountry === "string"
        ? r.player_self_guessCountry
        : typeof r.p1_guessCountry === "string"
          ? r.p1_guessCountry
          : typeof r.guessCountry === "string"
            ? r.guessCountry
            : "";
    if (truth && guess) {
      agg.hitDenom = (agg.hitDenom ?? 0) + 1;
      if (guess === truth) agg.hitCount = (agg.hitCount ?? 0) + 1;
    }

    const start = typeof r.startTime === "number" && Number.isFinite(r.startTime) ? r.startTime : null;
    const end = typeof r.endTime === "number" && Number.isFinite(r.endTime) ? r.endTime : null;
    if (start !== null) agg.minStart = agg.minStart === undefined ? start : Math.min(agg.minStart, start);
    if (end !== null) agg.maxEnd = agg.maxEnd === undefined ? end : Math.max(agg.maxEnd, end);

    const h = typeof r.player_self_healthAfter === "number" && Number.isFinite(r.player_self_healthAfter) ? r.player_self_healthAfter : null;
    if (h !== null) {
      agg.minHealthAfter = agg.minHealthAfter === undefined ? h : Math.min(agg.minHealthAfter, h);
      agg.maxHealthAfter = agg.maxHealthAfter === undefined ? h : Math.max(agg.maxHealthAfter, h);

      const marker =
        (typeof r.endTime === "number" && Number.isFinite(r.endTime) ? r.endTime : null) ??
        (typeof r.startTime === "number" && Number.isFinite(r.startTime) ? r.startTime : null) ??
        (typeof r.roundNumber === "number" && Number.isFinite(r.roundNumber) ? r.roundNumber : null);
      if (marker !== null) {
        const curMarker = agg.finalHealthMarker;
        if (curMarker === undefined || marker >= curMarker) {
          agg.finalHealthMarker = marker;
          agg.finalHealthAfter = h;
        }
      }
    }
  }

  agg.movementType = movement ?? "unknown";
  return agg;
}

