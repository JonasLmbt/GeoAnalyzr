import { dbV2, GameRow, RoundRow } from "./db_v2";
import { loadServerSyncSettings } from "./serverSync";
import { getCurrentPlayerId } from "./app/playerIdentity";

export interface SyncV2Progress {
  phase: "reconcile" | "upload" | "verify";
  batch: number;
  totalBatches: number;
  gamesUploaded: number;
  gamesNew: number;
  gamesSkipped: number;
  roundsNew: number;
  /** Set on the second reconcile event after server state is fetched */
  serverCount?: number;
  localCount?: number;
}

export interface SyncV2Result {
  ok: boolean;
  status?: number;
  gamesUploaded: number;
  gamesNew: number;
  gamesSkipped: number;
  roundsNew: number;
  batches: number;
  /** Server game count after sync */
  serverGameCount?: number;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getUserscriptVersion(): string | undefined {
  const info = (globalThis as any)?.GM_info;
  const v = info?.script?.version;
  return typeof v === "string" ? v : undefined;
}

/** Derive the v2 batch endpoint from the configured sync endpoint URL. */
function v2BatchEndpoint(syncEndpointUrl: string): string {
  try {
    const u = new URL(syncEndpointUrl);
    u.pathname = "/api/v2/sync/batch";
    u.search = "";
    return u.toString();
  } catch {
    // Fallback: replace path manually
    return syncEndpointUrl.replace(/\/api\/sync.*$/, "/api/v2/sync/batch");
  }
}

function v2StateEndpoint(syncEndpointUrl: string): string {
  try {
    const u = new URL(syncEndpointUrl);
    u.pathname = "/api/v2/sync/state";
    u.search = "";
    return u.toString();
  } catch {
    return syncEndpointUrl.replace(/\/api\/sync.*$/, "/api/v2/sync/state");
  }
}

async function httpPost(
  url: string,
  token: string,
  body: unknown
): Promise<{ status: number; data: any }> {
  const json = JSON.stringify(body);

  // Prefer GM_xmlhttpRequest for cross-origin requests in userscript context
  const gm = (globalThis as any)?.GM_xmlhttpRequest ?? (globalThis as any)?.GM?.xmlHttpRequest;
  if (typeof gm === "function") {
    return new Promise((resolve) => {
      gm({
        method: "POST",
        url,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        data: json,
        responseType: "text",
        timeout: 60000,
        withCredentials: false,
        onload: (res: any) => {
          const text = typeof res?.responseText === "string" ? res.responseText : "";
          let data: any = null;
          try { data = JSON.parse(text); } catch { /* ignore */ }
          resolve({ status: Number(res?.status) || 0, data });
        },
        onerror: () => resolve({ status: 0, data: null }),
        ontimeout: () => resolve({ status: 0, data: null }),
      });
    });
  }

  // Fallback to fetch
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    body: json,
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* ignore */ }
  return { status: res.status, data };
}

async function httpGet(
  url: string,
  token: string
): Promise<{ status: number; data: any }> {
  const gm = (globalThis as any)?.GM_xmlhttpRequest ?? (globalThis as any)?.GM?.xmlHttpRequest;
  if (typeof gm === "function") {
    return new Promise((resolve) => {
      gm({
        method: "GET",
        url,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        responseType: "text",
        timeout: 30000,
        withCredentials: false,
        onload: (res: any) => {
          const text = typeof res?.responseText === "string" ? res.responseText : "";
          let data: any = null;
          try { data = JSON.parse(text); } catch { /* ignore */ }
          resolve({ status: Number(res?.status) || 0, data });
        },
        onerror: () => resolve({ status: 0, data: null }),
        ontimeout: () => resolve({ status: 0, data: null }),
      });
    });
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* ignore */ }
  return { status: res.status, data };
}

// ─── Reconciliation ───────────────────────────────────────────────────────────

interface ServerState {
  gameCount: number;
  roundCount: number;
  oldestAt: number | null;
  newestAt: number | null;
}

async function fetchServerState(
  stateUrl: string,
  token: string,
  playerId: string
): Promise<ServerState | null> {
  const url = `${stateUrl}?playerId=${encodeURIComponent(playerId)}`;
  const res = await httpGet(url, token);
  if (res.status !== 200 || !res.data?.ok) return null;
  return {
    gameCount: Number(res.data.gameCount) || 0,
    roundCount: Number(res.data.roundCount) || 0,
    oldestAt: res.data.oldestAt ?? null,
    newestAt: res.data.newestAt ?? null,
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

const BATCH_SIZE = 200;

/**
 * Upload all games + rounds from dbV2 to the v2 server endpoint.
 *
 * Strategy:
 * 1. GET /api/v2/sync/state → compare local count with server
 * 2. If server is behind (or full=true), upload all games in batches of 200
 *    with their associated rounds
 * 3. GET /api/v2/sync/state again to confirm
 */
export async function syncToServerV2(opts: {
  onProgress?: (p: SyncV2Progress) => void;
  /** Force full re-upload even if server appears up to date */
  full?: boolean;
  /** Only upload games that have detail data (detailFetchedAt set) */
  detailsOnly?: boolean;
  /** If provided, only upload these specific game IDs (skips count-based reconciliation) */
  gameIds?: string[];
}): Promise<SyncV2Result> {
  const settings = loadServerSyncSettings();
  if (!settings.token) {
    return { ok: false, error: "no_token", gamesUploaded: 0, gamesNew: 0, gamesSkipped: 0, roundsNew: 0, batches: 0 };
  }

  const playerId = await getCurrentPlayerId();
  if (!playerId) {
    return { ok: false, error: "no_player_id", gamesUploaded: 0, gamesNew: 0, gamesSkipped: 0, roundsNew: 0, batches: 0 };
  }

  const batchUrl = v2BatchEndpoint(settings.endpointUrl);
  const stateUrl = v2StateEndpoint(settings.endpointUrl);
  const clientVersion = getUserscriptVersion();

  // 1. Reconcile: check what the server already has
  opts.onProgress?.({ phase: "reconcile", batch: 0, totalBatches: 0, gamesUploaded: 0, gamesNew: 0, gamesSkipped: 0, roundsNew: 0 });

  const serverBefore = await fetchServerState(stateUrl, settings.token, playerId);

  let localGames: GameRow[];
  if (opts.gameIds) {
    const gameIdSet = new Set(opts.gameIds);
    localGames = await dbV2.games.filter((g) => gameIdSet.has(g.gameId)).toArray();
  } else {
    localGames = await dbV2.games
      .filter((g) => !opts.detailsOnly || g.detailFetchedAt !== undefined)
      .toArray();
  }
  const localGameCount = localGames.length;

  const serverCount = serverBefore?.gameCount ?? 0;
  opts.onProgress?.({ phase: "reconcile", batch: 0, totalBatches: 0, gamesUploaded: 0, gamesNew: 0, gamesSkipped: 0, roundsNew: 0, serverCount, localCount: localGameCount });

  if (localGameCount === 0) {
    return { ok: true, gamesUploaded: 0, gamesNew: 0, gamesSkipped: 0, roundsNew: 0, batches: 0, serverGameCount: serverCount };
  }

  // Count-based skip only when syncing everything (no gameIds filter, not forced)
  if (!opts.gameIds && !opts.full && serverCount >= localGameCount && serverCount > 0) {
    return {
      ok: true,
      gamesUploaded: 0,
      gamesNew: 0,
      gamesSkipped: localGameCount,
      roundsNew: 0,
      batches: 0,
      serverGameCount: serverCount,
    };
  }

  // Build a map of rounds by gameId for quick lookup
  const allRounds = await dbV2.rounds.toArray();
  const roundsByGameId = new Map<string, RoundRow[]>();
  for (const r of allRounds) {
    const list = roundsByGameId.get(r.gameId);
    if (list) list.push(r);
    else roundsByGameId.set(r.gameId, [r]);
  }

  // 2. Upload in batches
  const totalBatches = Math.ceil(localGameCount / BATCH_SIZE);
  let totalGamesUploaded = 0;
  let totalGamesNew = 0;
  let totalGamesSkipped = 0;
  let totalRoundsNew = 0;
  let batchIndex = 0;

  for (let i = 0; i < localGames.length; i += BATCH_SIZE) {
    batchIndex++;
    const gameBatch: GameRow[] = localGames.slice(i, i + BATCH_SIZE);
    const roundBatch: RoundRow[] = [];
    for (const g of gameBatch) {
      const rounds = roundsByGameId.get(g.gameId);
      if (rounds) roundBatch.push(...rounds);
    }

    opts.onProgress?.({
      phase: "upload",
      batch: batchIndex,
      totalBatches,
      gamesUploaded: totalGamesUploaded,
      gamesNew: totalGamesNew,
      gamesSkipped: totalGamesSkipped,
      roundsNew: totalRoundsNew,
    });

    const batchId = `v2_${playerId}_${Date.now()}_${batchIndex}`;
    const body = {
      batchId,
      playerId,
      clientVersion: clientVersion ?? undefined,
      games: gameBatch,
      rounds: roundBatch,
    };

    let res: { status: number; data: any };
    try {
      res = await httpPost(batchUrl, settings.token, body);
    } catch (e) {
      return {
        ok: false,
        status: 0,
        error: e instanceof Error ? e.message : String(e),
        gamesUploaded: totalGamesUploaded,
        gamesNew: totalGamesNew,
        gamesSkipped: totalGamesSkipped,
        roundsNew: totalRoundsNew,
        batches: batchIndex - 1,
      };
    }

    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        status: res.status,
        error: "unauthorized",
        gamesUploaded: totalGamesUploaded,
        gamesNew: totalGamesNew,
        gamesSkipped: totalGamesSkipped,
        roundsNew: totalRoundsNew,
        batches: batchIndex - 1,
      };
    }

    if (res.status < 200 || res.status >= 300) {
      return {
        ok: false,
        status: res.status,
        error: res.data?.error ?? `HTTP ${res.status}`,
        gamesUploaded: totalGamesUploaded,
        gamesNew: totalGamesNew,
        gamesSkipped: totalGamesSkipped,
        roundsNew: totalRoundsNew,
        batches: batchIndex - 1,
      };
    }

    totalGamesUploaded += gameBatch.length;
    totalGamesNew += Number(res.data?.gamesNew) || 0;
    totalGamesSkipped += Number(res.data?.gamesSkipped) || 0;
    totalRoundsNew += Number(res.data?.roundsNew) || 0;
  }

  // 3. Verify: check server state after upload
  opts.onProgress?.({ phase: "verify", batch: batchIndex, totalBatches, gamesUploaded: totalGamesUploaded, gamesNew: totalGamesNew, gamesSkipped: totalGamesSkipped, roundsNew: totalRoundsNew });

  const serverAfter = await fetchServerState(stateUrl, settings.token, playerId);

  return {
    ok: true,
    gamesUploaded: totalGamesUploaded,
    gamesNew: totalGamesNew,
    gamesSkipped: totalGamesSkipped,
    roundsNew: totalRoundsNew,
    batches: batchIndex,
    serverGameCount: serverAfter?.gameCount,
  };
}
