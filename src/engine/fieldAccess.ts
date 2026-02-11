// src/engine/fieldAccess.ts
import type { RoundRow } from "../db";

function legacy(obj: any, ...keys: string[]): any {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

export function getSelfScore(r: RoundRow): number | undefined {
  const v = legacy(r, "player_self_score", "p1_score", "score");
  return typeof v === "number" ? v : undefined;
}

export function getPlayedAt(r: RoundRow): number | undefined {
  // recommended denormalized
  return (r as any).playedAt;
}

export function getTrueCountry(r: RoundRow): string | undefined {
  return (r as any).trueCountry ?? (r as any).true_country;
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
