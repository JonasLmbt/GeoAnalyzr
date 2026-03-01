// src/engine/fieldAccess.ts
import type { RoundRow } from "../db";

function legacy(obj: any, ...keys: string[]): any {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

export function getSelfScore(r: RoundRow): number | undefined {
  // Prefer explicit "self score" fields. Only fall back to a generic `score` if the row does not
  // appear to be in the newer denormalized shape (where `score` can mean something else / be unset).
  const hasExplicitSelfScoreKey =
    r &&
    typeof r === "object" &&
    ("player_self_score" in (r as any) ||
      "playerSelfScore" in (r as any) ||
      "p1_score" in (r as any) ||
      "p1Score" in (r as any));

  const selfRaw = hasExplicitSelfScoreKey ? legacy(r, "player_self_score", "p1_score") : legacy(r, "player_self_score", "p1_score", "score");
  return typeof selfRaw === "number" ? selfRaw : undefined;
}

export function getPlayedAt(r: RoundRow): number | undefined {
  // recommended denormalized
  return (r as any).playedAt;
}

export function getTrueCountry(r: RoundRow): string | undefined {
  return (r as any).trueCountry ?? (r as any).true_country;
}

export function getMovementType(r: RoundRow): string | undefined {
  const v = (r as any).movementType ?? (r as any).movement_type;
  return typeof v === "string" ? v : undefined;
}

export function getDurationSeconds(r: RoundRow): number | undefined {
  const v = legacy(r, "durationSeconds", "guessDurationSec", "timeSec");
  return typeof v === "number" ? v : undefined;
}

export function getDistanceKm(r: RoundRow): number | undefined {
  const v = legacy(r, "distanceKm", "player_self_distanceKm", "p1_distanceKm");
  return typeof v === "number" ? v : undefined;
}

export function getMateScore(r: RoundRow): number | undefined {
  const v = legacy(r, "player_mate_score", "p2_score");
  return typeof v === "number" ? v : undefined;
}

export function getOpponentScore(r: RoundRow): number | undefined {
  const v = legacy(r, "player_opponent_score", "playerTwoScore", "p2_score_opponent");
  return typeof v === "number" ? v : undefined;
}

export function getOpponentMateScore(r: RoundRow): number | undefined {
  const v = legacy(r, "player_opponent_mate_score", "opponentMateScore");
  return typeof v === "number" ? v : undefined;
}

export function getMateDistanceKm(r: RoundRow): number | undefined {
  const v = legacy(r, "player_mate_distanceKm", "p2_distanceKm");
  return typeof v === "number" ? v : undefined;
}

export function getTeammateName(r: RoundRow): string | undefined {
  const v = legacy(r, "teammateName", "player_mate_name");
  return typeof v === "string" ? v : undefined;
}

export function getGuessCountrySelf(r: RoundRow): string | undefined {
  const v = legacy(r, "player_self_guessCountry", "p1_guessCountry", "guessCountry");
  return typeof v === "string" ? v : undefined;
}

export function pick(obj: any, key: string): any {
  if (!obj) return undefined;

  // accept both snake_case and camelCase
  if (key in obj) return obj[key];

  const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  if (camel in obj) return obj[camel];

  const snake = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  if (snake in obj) return obj[snake];

  return undefined;
}

export function pickWithAliases(
  obj: any,
  logicalKey: string,
  columnAliases: Record<string, string[]> | undefined
): any {
  const aliases = columnAliases?.[logicalKey] ?? [];
  const probeOrder = [logicalKey, ...aliases];
  for (const candidate of probeOrder) {
    const value = pick(obj, candidate);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}
