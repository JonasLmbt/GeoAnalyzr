// src/engine/fieldAccess.ts
import type { RoundRow } from "../db";

export function getSelfScore(r: RoundRow): number | undefined {
  return (r as any).player_self_score;
}

export function getPlayedAt(r: RoundRow): number | undefined {
  // recommended denormalized
  return (r as any).playedAt;
}

export function getTrueCountry(r: RoundRow): string | undefined {
  return (r as any).trueCountry ?? (r as any).true_country;
}

export function getGuessCountrySelf(r: RoundRow): string | undefined {
  return (r as any).player_self_guessCountry;
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
