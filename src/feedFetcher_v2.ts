import { dbV2, GameRow, ModeFamily, getSyncState, setSyncState } from "./db_v2";
import { httpGetJsonWithRetry } from "./http";

export interface FeedFetchProgress {
  page: number;
  newGames: number;
  skipped: number;
}

export interface FeedFetchResult {
  newGames: number;
  newGameIds: string[];
  pages: number;
  stopped: "exhausted" | "overlap" | "max_pages" | "error";
}

// ─── Feed parsing helpers ─────────────────────────────────────────────────────

function getByPath(obj: any, path: string): any {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== "object" || !(p in cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

function pickFirst(obj: any, paths: string[]): any {
  for (const p of paths) {
    const v = getByPath(obj, p);
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

function classifyModeFamily(ev: any, entry: any): ModeFamily {
  const raw = String(
    pickFirst(ev, [
      "payload.gameMode",
      "payload.competitiveGameMode",
      "payload.mode",
      "gameMode",
      "competitiveGameMode",
      "mode",
      "type",
      "__typename",
      "payload.type",
      "payload.__typename",
      "payload.gameType",
      "payload.slug",
    ]) ??
    pickFirst(entry, ["payload.gameMode", "payload.competitiveGameMode", "gameMode"]) ??
    ""
  ).toLowerCase();

  if (raw.includes("teamduel") || raw.includes("team_duel") || raw.includes("team-duel")) return "teamduels";
  if (raw.includes("duel")) return "duels";
  if (raw.includes("streak")) return "streak";
  if (raw.includes("standard") || raw.includes("singleplayer") || raw.includes("classic")) return "standard";
  return "other";
}

function extractEvents(entry: any): any[] {
  if (Array.isArray(entry?.payload)) return entry.payload;
  if (typeof entry?.payload === "string") {
    try {
      const parsed = JSON.parse(entry.payload);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // ignore
    }
  }
  return [entry];
}

function extractGameId(ev: any): string | undefined {
  for (const path of ["payload.gameId", "payload.gameToken", "gameId", "id", "payload.id"] as const) {
    const v = getByPath(ev, path);
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function extractPlayedAt(ev: any, entry: any): number {
  const raw = pickFirst(ev, ["time", "createdAt", "payload.time"]) ?? entry?.time;
  const parsed = typeof raw === "string" ? Date.parse(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

// ─── Feed HTTP ────────────────────────────────────────────────────────────────

async function fetchFeedPage(
  paginationToken?: string
): Promise<{ data: any; status: number }> {
  const base = "https://www.geoguessr.com/api/v4/feed/private";
  const url = paginationToken
    ? `${base}?paginationToken=${encodeURIComponent(paginationToken)}`
    : base;

  const res = await httpGetJsonWithRetry(url, {
    retries: 6,
    baseDelayMs: 500,
    maxDelayMs: 15000,
    headers: { Accept: "application/json" },
  });

  if ((res.status === 401 || res.status === 403 || res.status === 0)) {
    const gm = await httpGetJsonWithRetry(url, {
      retries: 2,
      baseDelayMs: 400,
      maxDelayMs: 5000,
      forceGm: true,
      headers: { Accept: "application/json" },
    });
    if (gm.status >= 200 && gm.status < 300) return gm;
  }

  return res;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Fetch the GeoGuessr activity feed and write new games to dbV2.
 * Stops early if the cursor overlaps with already-stored games (incremental mode).
 */
export async function fetchFeed(opts: {
  onProgress?: (p: FeedFetchProgress) => void;
  maxPages?: number;
  delayMs?: number;
  /** Stop paginating once we see this many consecutive already-known game IDs */
  overlapThreshold?: number;
  /** Full re-fetch: ignore cursor and keep going until the feed is exhausted */
  full?: boolean;
}): Promise<FeedFetchResult> {
  const maxPages = opts.maxPages ?? 5000;
  const delayMs = opts.delayMs ?? 150;
  const overlapThreshold = opts.overlapThreshold ?? 5;

  // For full re-fetch: resume from saved cursor if interrupted mid-way.
  // For incremental: always start from the top (newest games), the overlap
  // threshold will stop early once we've caught up.
  const savedCursor = opts.full
    ? await getSyncState<string>("feedCursor")
    : undefined;

  let paginationToken: string | undefined = savedCursor ?? undefined;
  const seenTokens = new Set<string>();
  let totalNew = 0;
  let totalSkipped = 0;
  let consecutiveKnown = 0;
  let stopped: FeedFetchResult["stopped"] = "exhausted";
  const allNewGameIds: string[] = [];

  for (let page = 1; page <= maxPages; page++) {
    let res: { data: any; status: number };
    try {
      res = await fetchFeedPage(paginationToken);
    } catch (e) {
      stopped = "error";
      break;
    }

    if (res.status < 200 || res.status >= 300) {
      stopped = "error";
      break;
    }

    const entries: any[] = Array.isArray(res.data?.entries) ? res.data.entries : [];
    if (entries.length === 0) {
      stopped = "exhausted";
      break;
    }

    // Parse entries → GameRow candidates
    const candidates = new Map<string, GameRow>();
    const rawEntries: Array<{ gameId: string; fetchedAt: number; json: unknown }> = [];

    for (const entry of entries) {
      for (const ev of extractEvents(entry)) {
        const gameId = extractGameId(ev);
        if (!gameId) continue;
        const playedAt = extractPlayedAt(ev, entry);
        const modeFamily = classifyModeFamily(ev, entry);

        if (!candidates.has(gameId) || candidates.get(gameId)!.playedAt < playedAt) {
          const partial: GameRow = { gameId, playedAt, modeFamily };
          // Classic games expose extra fields directly in the feed payload
          const p = ev?.payload;
          if (modeFamily === "standard" && p) {
            if (typeof p.mapSlug === "string" && p.mapSlug) partial.mapSlug = p.mapSlug;
            if (typeof p.mapName === "string" && p.mapName) partial.mapName = p.mapName;
            if (typeof p.points === "number") partial.selfScore = p.points;
          }
          candidates.set(gameId, partial);
        }
        rawEntries.push({ gameId, fetchedAt: Date.now(), json: entry });
      }
    }

    // Check how many of these game IDs already exist in v2 DB
    const gameIds = [...candidates.keys()];
    const existing = await dbV2.games.bulkGet(gameIds);
    const existingSet = new Set(existing.filter(Boolean).map((g) => g!.gameId));

    const newGames = gameIds.filter((id) => !existingSet.has(id)).map((id) => candidates.get(id)!);
    const pageKnown = gameIds.length - newGames.length;

    if (newGames.length > 0) {
      await dbV2.games.bulkPut(newGames);
      allNewGameIds.push(...newGames.map((g) => g.gameId));
    }
    await dbV2.rawFeedEntries.bulkPut(rawEntries);

    totalNew += newGames.length;
    totalSkipped += pageKnown;
    consecutiveKnown = newGames.length === 0 ? consecutiveKnown + pageKnown : 0;

    opts.onProgress?.({ page, newGames: totalNew, skipped: totalSkipped });

    // Determine next cursor
    const nextToken: string | undefined =
      typeof res.data?.paginationToken === "string" && res.data.paginationToken
        ? res.data.paginationToken
        : undefined;

    // Only persist the cursor during full syncs so interrupted runs can resume.
    // Incremental syncs always start from the top (savedCursor is ignored).
    if (opts.full && nextToken) {
      await setSyncState("feedCursor", nextToken);
    }

    // Stop if we're seeing too many already-known games in a row (caught up)
    if (!opts.full && consecutiveKnown >= overlapThreshold) {
      stopped = "overlap";
      break;
    }

    if (!nextToken || seenTokens.has(nextToken)) {
      stopped = "exhausted";
      break;
    }

    seenTokens.add(nextToken);
    paginationToken = nextToken;

    if (page < maxPages && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }

    if (page >= maxPages) {
      stopped = "max_pages";
    }
  }

  // Clear saved cursor once a full fetch completes so the next full fetch
  // starts from the top of the feed (not from a stale end-of-feed position).
  if (opts.full && stopped === "exhausted") {
    await dbV2.syncState.delete("feedCursor");
  }

  return { newGames: totalNew, newGameIds: allNewGameIds, pages: 0, stopped };
}
