import { db } from "../db";
import { httpGetJson } from "../http";

let cachedPlayerName: string | null | undefined;

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

async function guessPlayerNameFromDb(): Promise<string | undefined> {
  try {
    const latest = await db.details.orderBy("fetchedAt").reverse().limit(10).toArray();
    for (const d of latest as any[]) {
      const candidate =
        asTrimmedString(d?.player_self_name) ??
        asTrimmedString(d?.playerOneName) ??
        asTrimmedString(d?.playerOneNick) ??
        asTrimmedString(d?.playerOneNickname);
      if (candidate) return candidate;
    }
  } catch {
    // ignore
  }
  return undefined;
}

export async function getCurrentPlayerName(): Promise<string | undefined> {
  if (cachedPlayerName !== undefined) return cachedPlayerName || undefined;

  const fromApi = await fetchPlayerNameFromApi();
  if (fromApi) {
    cachedPlayerName = fromApi;
    return fromApi;
  }

  const fromDb = await guessPlayerNameFromDb();
  cachedPlayerName = fromDb ?? null;
  return fromDb;
}

