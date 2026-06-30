import { httpGetJson } from "../http";

let cachedPlayerName: string | null | undefined;
let cachedPlayerId: string | null | undefined;

function asTrimmedString(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : undefined;
}

function pickFirst(obj: any, paths: string[]): unknown {
  for (const path of paths) {
    if (!obj || typeof obj !== "object") continue;
    const parts = path.split(".");
    let cur: any = obj;
    let ok = true;
    for (const p of parts) {
      if (!cur || typeof cur !== "object" || !(p in cur)) {
        ok = false;
        break;
      }
      cur = cur[p];
    }
    if (!ok) continue;
    if (cur !== undefined && cur !== null) return cur;
  }
  return undefined;
}

async function fetchPlayerNameFromApi(): Promise<string | undefined> {
  const idCandidates = [
    "https://www.geoguessr.com/api/v3/profiles",
    "https://www.geoguessr.com/api/v4/profiles",
    "https://www.geoguessr.com/api/v3/users/me"
  ];

  let playerId: string | undefined;
  for (const url of idCandidates) {
    try {
      const res = await httpGetJson(url);
      if (res.status < 200 || res.status >= 300) continue;
      const id = pickFirst(res.data, ["user.id", "id", "player.id", "playerId", "user.userId"]);
      playerId = asTrimmedString(id);
      if (playerId) break;
    } catch {
      // ignore
    }
  }

  if (!playerId) return undefined;

  try {
    const res = await httpGetJson(`https://www.geoguessr.com/api/v3/users/${encodeURIComponent(playerId)}`);
    if (res.status < 200 || res.status >= 300) return undefined;
    return asTrimmedString(res.data?.nick);
  } catch {
    return undefined;
  }
}

async function fetchPlayerIdFromApi(): Promise<string | undefined> {
  const idCandidates = [
    "https://www.geoguessr.com/api/v3/profiles",
    "https://www.geoguessr.com/api/v4/profiles",
    "https://www.geoguessr.com/api/v3/users/me"
  ];

  for (const url of idCandidates) {
    try {
      const res = await httpGetJson(url);
      if (res.status < 200 || res.status >= 300) continue;
      const id = pickFirst(res.data, ["user.id", "id", "player.id", "playerId", "user.userId"]);
      const playerId = asTrimmedString(id);
      if (playerId) return playerId;
    } catch {
      // ignore
    }
  }
  return undefined;
}

// Identity must come from GeoGuessr's own authenticated API -- never guessed
// from locally-cached game details (an opponent's row can land in the
// "player one" slot of a stored detail record just as easily as our own,
// which previously caused sync to attribute a Discord link to whichever
// opponent happened to be in slot 0; see serverSync_v3_db2.ts).
export async function getCurrentPlayerId(): Promise<string | undefined> {
  if (cachedPlayerId !== undefined) return cachedPlayerId || undefined;

  const fromApi = await fetchPlayerIdFromApi();
  cachedPlayerId = fromApi ?? null;
  return fromApi;
}

export async function getCurrentPlayerName(): Promise<string | undefined> {
  if (cachedPlayerName !== undefined) return cachedPlayerName || undefined;

  const fromApi = await fetchPlayerNameFromApi();
  cachedPlayerName = fromApi ?? null;
  return fromApi;
}
