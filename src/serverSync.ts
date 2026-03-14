import { gzip, strToU8 } from "fflate";
import { db, type FeedGameRow, type GameAggRow, type GameRow, type RoundRow } from "./db";
import { getCurrentPlayerId, getCurrentPlayerName } from "./app/playerIdentity";
import { getGmXmlhttpRequest } from "./gm";

type ColumnarTable = {
  cols: string[];
  rows: unknown[][];
};

export type ServerSyncSettings = {
  endpointUrl: string;
  token: string;
  compact: boolean;
  includeAggregates: boolean;
};

export type ServerSyncStatus = {
  ok: boolean;
  status: number;
  responseText: string;
  cursorFrom: number;
  cursorTo: number;
  counts: { games: number; rounds: number; details: number; gameAgg: number };
  bytesJson: number;
  bytesGzip: number;
};

const SYNC_META_KEY = "server_sync_v1";
const GM_VALUE_PREFIX = "geoanalyzr_server_sync_v1_";

const DEFAULT_ENDPOINT = "https://sync.geoanalyzr.lmbt.app/api/sync";

// Compact mode is optional. It should NEVER drop core analytical fields (like guess countries).
// Keep it conservative: only drop the huge raw payloads.
const COMPACT_DROP_KEYS = new Set<string>(["raw"]);

function compactRecord<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === undefined) continue;
    if (COMPACT_DROP_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out as T;
}

function unionOrderedKeys(rows: Array<Record<string, unknown>>, prefer: string[]): string[] {
  const set = new Set<string>();
  for (const key of prefer) set.add(key);
  for (const row of rows) {
    for (const key of Object.keys(row)) set.add(key);
  }
  const preferSet = new Set(prefer);
  const rest = Array.from(set).filter((k) => !preferSet.has(k)).sort();
  return prefer.concat(rest.filter((k) => !preferSet.has(k)));
}

function toColumnar(rows: Array<Record<string, unknown>>, prefer: string[]): ColumnarTable {
  if (rows.length === 0) return { cols: [], rows: [] };
  const cols = unionOrderedKeys(rows, prefer);
  const outRows: unknown[][] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const arr = new Array(cols.length);
    for (let c = 0; c < cols.length; c++) arr[c] = (r as any)[cols[c]];
    outRows[i] = arr;
  }
  return { cols, rows: outRows };
}

function getUserscriptVersion(): string | undefined {
  const anyGlobal = globalThis as any;
  const info = anyGlobal?.GM_info;
  const v = info?.script?.version;
  return typeof v === "string" ? v : undefined;
}

function readGmValue(key: string): unknown {
  const g: any = globalThis as any;
  try {
    if (typeof g?.GM_getValue === "function") return g.GM_getValue(key);
  } catch {
    // ignore
  }
  try {
    // eslint-disable-next-line no-undef
    if (typeof GM_getValue === "function") return GM_getValue(key);
  } catch {
    // ignore
  }
  try {
    return globalThis?.localStorage?.getItem(key);
  } catch {
    return null;
  }
}

function writeGmValue(key: string, value: string): void {
  const g: any = globalThis as any;
  try {
    if (typeof g?.GM_setValue === "function") return g.GM_setValue(key, value);
  } catch {
    // ignore
  }
  try {
    // eslint-disable-next-line no-undef
    if (typeof GM_setValue === "function") return GM_setValue(key, value);
  } catch {
    // ignore
  }
  try {
    globalThis?.localStorage?.setItem(key, value);
  } catch {
    // ignore
  }
}

export function loadServerSyncSettings(): ServerSyncSettings {
  const endpointUrlRaw = readGmValue(`${GM_VALUE_PREFIX}endpoint_url`);
  const tokenRaw = readGmValue(`${GM_VALUE_PREFIX}token`);
  const compactRaw = readGmValue(`${GM_VALUE_PREFIX}compact`);
  const includeAggRaw = readGmValue(`${GM_VALUE_PREFIX}include_agg`);

  const endpointUrl = typeof endpointUrlRaw === "string" ? endpointUrlRaw.trim() : "";
  const token = typeof tokenRaw === "string" ? tokenRaw.trim() : "";
  const compact =
    typeof compactRaw === "string" ? compactRaw === "1" : typeof compactRaw === "boolean" ? compactRaw : false;
  const includeAggregates =
    typeof includeAggRaw === "string" ? includeAggRaw === "1" : typeof includeAggRaw === "boolean" ? includeAggRaw : false;

  return {
    endpointUrl: endpointUrl || DEFAULT_ENDPOINT,
    token,
    compact,
    includeAggregates
  };
}

export function saveServerSyncSettings(next: Partial<ServerSyncSettings>): void {
  if (typeof next.endpointUrl === "string") writeGmValue(`${GM_VALUE_PREFIX}endpoint_url`, next.endpointUrl.trim());
  if (typeof next.token === "string") writeGmValue(`${GM_VALUE_PREFIX}token`, next.token.trim());
  if (typeof next.compact === "boolean") writeGmValue(`${GM_VALUE_PREFIX}compact`, next.compact ? "1" : "0");
  if (typeof next.includeAggregates === "boolean") writeGmValue(`${GM_VALUE_PREFIX}include_agg`, next.includeAggregates ? "1" : "0");
}

export async function getLastServerSyncCursor(): Promise<number> {
  const meta = await db.meta.get(SYNC_META_KEY);
  const cursor = (meta?.value as any)?.cursorTo;
  return typeof cursor === "number" && Number.isFinite(cursor) ? Math.max(0, Math.floor(cursor)) : 0;
}

async function setLastServerSyncCursor(status: Omit<ServerSyncStatus, "ok"> & { ok: boolean }): Promise<void> {
  await db.meta.put({
    key: SYNC_META_KEY,
    value: {
      cursorFrom: status.cursorFrom,
      cursorTo: status.cursorTo,
      lastSyncAt: Date.now(),
      lastStatus: status.status,
      lastOk: status.ok,
      lastBytesJson: status.bytesJson,
      lastBytesGzip: status.bytesGzip,
      lastCounts: status.counts
    },
    updatedAt: Date.now()
  });
}

async function gzipJson(json: string): Promise<Uint8Array> {
  return await new Promise<Uint8Array>((resolve, reject) => {
    gzip(strToU8(json), { level: 6 }, (err, out) => {
      if (err) reject(err);
      else resolve(out);
    });
  });
}

async function buildDelta(since: number, opts: { compact: boolean; includeAggregates: boolean }): Promise<{
  cursorFrom: number;
  cursorTo: number;
  counts: { games: number; rounds: number; details: number; gameAgg: number };
  json: string;
  bytesJson: number;
  bytesGzip: Uint8Array;
}> {
  const cursorFrom = Math.max(0, Math.floor(since || 0));

  const [ownerId, ownerName] = await Promise.all([getCurrentPlayerId(), getCurrentPlayerName()]);

  const [gamesByTime, roundsByTime, detailsByTime, gameAggByTime] = await Promise.all([
    db.games.where("playedAt").above(cursorFrom).toArray(),
    db.rounds.where("playedAt").above(cursorFrom).toArray(),
    db.details.where("fetchedAt").above(cursorFrom).toArray(),
    opts.includeAggregates ? db.gameAgg.where("computedAt").above(cursorFrom).toArray() : Promise.resolve([] as GameAggRow[])
  ]);

  // Also include records without timestamps for newly-seen games (rare but prevents "missing rounds/details" on first sync).
  const gameIds = gamesByTime.map((g) => g.gameId);
  const [roundsByGame, detailsByGame] = await Promise.all([
    gameIds.length > 0 ? db.rounds.where("gameId").anyOf(gameIds).toArray() : Promise.resolve([] as RoundRow[]),
    gameIds.length > 0 ? db.details.where("gameId").anyOf(gameIds).toArray() : Promise.resolve([] as GameRow[])
  ]);

  const roundsMerged = (() => {
    const byId = new Map<string, RoundRow>();
    for (const r of roundsByGame) byId.set(r.id, r);
    for (const r of roundsByTime) byId.set(r.id, r);
    return Array.from(byId.values());
  })();

  const detailsMerged = (() => {
    const byId = new Map<string, GameRow>();
    for (const d of detailsByGame) byId.set(d.gameId, d);
    for (const d of detailsByTime) byId.set(d.gameId, d);
    return Array.from(byId.values());
  })();

  // Ensure `round.playedAt` is present: if missing, use game.playedAt for the same gameId.
  // This keeps server-side storage/query fast without having to reconstruct timestamps later.
  const roundsNeedingTsGameIds = Array.from(
    new Set(
      roundsMerged
        .filter((r: any) => !(typeof r?.playedAt === "number" && Number.isFinite(r.playedAt) && r.playedAt > 0))
        .map((r: any) => (typeof r?.gameId === "string" ? r.gameId : ""))
        .filter(Boolean)
    )
  );
  if (roundsNeedingTsGameIds.length > 0) {
    const gamesForBackfill = await db.games.where("gameId").anyOf(roundsNeedingTsGameIds).toArray();
    const gamePlayedAt = new Map<string, number>();
    for (const g of gamesForBackfill) {
      if (typeof g?.playedAt === "number" && Number.isFinite(g.playedAt) && g.playedAt > 0) gamePlayedAt.set(g.gameId, g.playedAt);
    }
    for (const r of roundsMerged as any[]) {
      if (typeof r?.playedAt === "number" && Number.isFinite(r.playedAt) && r.playedAt > 0) continue;
      const gid = typeof r?.gameId === "string" ? r.gameId : "";
      const ts = gid ? gamePlayedAt.get(gid) : undefined;
      if (typeof ts === "number") (r as any).playedAt = ts;
    }
  }

  const games = opts.compact ? gamesByTime.map(compactRecord) : gamesByTime;
  // rounds.playedAt is redundant (it mirrors game.playedAt). Server can backfill by gameId.
  const roundsPayloadBase = roundsMerged.map((r: any) => {
    const out = { ...(r as any) };
    delete out.playedAt;
    return out;
  });
  const rounds = opts.compact ? roundsPayloadBase.map(compactRecord) : roundsPayloadBase;
  const details = opts.compact ? detailsMerged.map(compactRecord) : detailsMerged;
  const gameAgg = opts.compact ? gameAggByTime.map(compactRecord) : gameAggByTime;

  const cursorToCandidates: number[] = [];
  for (const g of gamesByTime) if (typeof g.playedAt === "number") cursorToCandidates.push(g.playedAt);
  for (const r of roundsMerged) if (typeof (r as any).playedAt === "number") cursorToCandidates.push((r as any).playedAt);
  for (const d of detailsMerged) if (typeof (d as any).fetchedAt === "number") cursorToCandidates.push((d as any).fetchedAt);
  for (const a of gameAggByTime) if (typeof (a as any).computedAt === "number") cursorToCandidates.push((a as any).computedAt);
  const cursorTo = cursorToCandidates.length > 0 ? Math.max(...cursorToCandidates) : cursorFrom;

  const tables: Record<string, ColumnarTable> = {
    games: toColumnar(games as any, ["gameId", "playedAt", "type", "modeFamily", "gameMode", "isTeamDuels"]),
    rounds: toColumnar(rounds as any, ["id", "gameId", "roundNumber", "movementType"]),
    details: toColumnar(details as any, ["gameId", "status", "fetchedAt", "modeFamily", "gameMode", "mapSlug"]),
    ...(opts.includeAggregates ? { gameAgg: toColumnar(gameAgg as any, ["gameId", "computedAt", "aggVersion"]) } : {})
  };

  const envelope = {
    schema: "geoanalyzr-sync",
    schemaVersion: 1,
    createdAt: Date.now(),
    appVersion: getUserscriptVersion(),
    owner: { playerId: ownerId, playerName: ownerName },
    cursor: { from: cursorFrom, to: cursorTo },
    options: { compact: opts.compact, includeAggregates: opts.includeAggregates },
    counts: {
      games: gamesByTime.length,
      rounds: roundsMerged.length,
      details: detailsMerged.length,
      gameAgg: gameAggByTime.length
    },
    tables
  };

  const json = JSON.stringify(envelope);
  const bytesGzip = await gzipJson(json);

  return {
    cursorFrom,
    cursorTo,
    counts: envelope.counts,
    json,
    bytesJson: json.length,
    bytesGzip
  };
}

function gmPostBytes(
  url: string,
  body: Uint8Array,
  opts: { headers: Record<string, string>; timeoutMs?: number }
): Promise<{ status: number; text: string; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const gm = getGmXmlhttpRequest();
    if (!gm) return reject(new Error("GM_xmlhttpRequest is not available."));

    gm({
      method: "POST",
      url,
      headers: opts.headers,
      data: body as any,
      responseType: "text",
      timeout: opts.timeoutMs ?? 45000,
      onload: (res: any) => {
        const status = typeof res?.status === "number" ? res.status : Number(res?.status) || 0;
        const text = typeof res?.responseText === "string" ? res.responseText : "";
        const rawHeaders = typeof res?.responseHeaders === "string" ? res.responseHeaders : "";
        const headers: Record<string, string> = {};
        for (const line of rawHeaders.split(/\r?\n/)) {
          const idx = line.indexOf(":");
          if (idx <= 0) continue;
          const k = line.slice(0, idx).trim().toLowerCase();
          const v = line.slice(idx + 1).trim();
          if (!k) continue;
          if (headers[k]) headers[k] = `${headers[k]}, ${v}`;
          else headers[k] = v;
        }
        resolve({ status, text, headers });
      },
      onerror: (err: any) => reject(err instanceof Error ? err : new Error("GM_xmlhttpRequest failed")),
      ontimeout: () => reject(new Error("GM_xmlhttpRequest timeout"))
    });
  });
}

export async function runServerSyncOnce(settings: ServerSyncSettings): Promise<ServerSyncStatus> {
  return runServerSyncOnceWithOptions(settings, {});
}

export async function runServerSyncOnceWithOptions(
  settings: ServerSyncSettings,
  opts: { forceFull?: boolean } = {}
): Promise<ServerSyncStatus> {
  const endpointUrl = (settings.endpointUrl || "").trim();
  if (!endpointUrl) throw new Error("Missing sync endpoint URL.");
  const token = (settings.token || "").trim();
  if (!token) throw new Error("Missing sync token.");

  const forceFull = opts.forceFull === true;
  const cursorFrom = forceFull ? 0 : await getLastServerSyncCursor();

  // Full-fidelity sync: keep payload complete so the server/website can reproduce
  // the old semantic dashboard without missing fields.
  const effectiveCompact = false;

  const delta = forceFull
    ? await (async () => {
        const [ownerId, ownerName] = await Promise.all([getCurrentPlayerId(), getCurrentPlayerName()]);
        const [gamesAll, roundsAll, detailsAll, gameAggAll] = await Promise.all([
          db.games.toArray(),
          db.rounds.toArray(),
          db.details.toArray(),
          settings.includeAggregates ? db.gameAgg.toArray() : Promise.resolve([] as GameAggRow[])
        ]);

        // Backfill missing round.playedAt from game.playedAt for the full snapshot too.
        const gamePlayedAt = new Map<string, number>();
        for (const g of gamesAll) {
          if (typeof g?.playedAt === "number" && Number.isFinite(g.playedAt) && g.playedAt > 0) gamePlayedAt.set(g.gameId, g.playedAt);
        }
        for (const r of roundsAll as any[]) {
          if (typeof r?.playedAt === "number" && Number.isFinite(r.playedAt) && r.playedAt > 0) continue;
          const gid = typeof r?.gameId === "string" ? r.gameId : "";
          const ts = gid ? gamePlayedAt.get(gid) : undefined;
          if (typeof ts === "number") (r as any).playedAt = ts;
        }

        const games = effectiveCompact ? gamesAll.map(compactRecord) : gamesAll;
        // rounds.playedAt is redundant (it mirrors game.playedAt). Server can backfill by gameId.
        const roundsNoPlayedAt = (roundsAll as any[]).map((r: any) => {
          const out = { ...(r as any) };
          delete out.playedAt;
          return out;
        });
        const rounds = effectiveCompact ? roundsNoPlayedAt.map(compactRecord) : roundsNoPlayedAt;
        const details = effectiveCompact ? (detailsAll as any[]).map(compactRecord) : detailsAll;
        const gameAgg = effectiveCompact ? (gameAggAll as any[]).map(compactRecord) : gameAggAll;

        const tables: Record<string, ColumnarTable> = {
          games: toColumnar(games as any, ["gameId", "playedAt", "type", "modeFamily", "gameMode", "isTeamDuels"]),
          rounds: toColumnar(rounds as any, ["id", "gameId", "roundNumber", "movementType"]),
          details: toColumnar(details as any, ["gameId", "status", "fetchedAt", "modeFamily", "gameMode", "mapSlug"]),
          ...(settings.includeAggregates ? { gameAgg: toColumnar(gameAgg as any, ["gameId", "computedAt", "aggVersion"]) } : {})
        };

        const cursorToCandidates: number[] = [];
        for (const g of gamesAll) if (typeof g.playedAt === "number") cursorToCandidates.push(g.playedAt);
        for (const r of roundsAll as any[]) if (typeof r?.playedAt === "number") cursorToCandidates.push(r.playedAt);
        for (const d of detailsAll as any[]) if (typeof d?.fetchedAt === "number") cursorToCandidates.push(d.fetchedAt);
        for (const a of gameAggAll as any[]) if (typeof a?.computedAt === "number") cursorToCandidates.push(a.computedAt);
        const cursorTo = cursorToCandidates.length > 0 ? Math.max(...cursorToCandidates) : 0;

        const envelope = {
          schema: "geoanalyzr-sync",
          schemaVersion: 1,
          createdAt: Date.now(),
          appVersion: getUserscriptVersion(),
          owner: { playerId: ownerId, playerName: ownerName },
          cursor: { from: 0, to: cursorTo },
          options: { compact: effectiveCompact, includeAggregates: settings.includeAggregates, forceFull: true },
          counts: { games: gamesAll.length, rounds: roundsAll.length, details: detailsAll.length, gameAgg: gameAggAll.length },
          tables
        };

        const json = JSON.stringify(envelope);
        const bytesGzip = await gzipJson(json);
        return {
          cursorFrom: 0,
          cursorTo,
          counts: envelope.counts,
          json,
          bytesJson: json.length,
          bytesGzip
        };
      })()
    : await buildDelta(cursorFrom, { compact: effectiveCompact, includeAggregates: settings.includeAggregates });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Content-Encoding": "gzip",
    Authorization: `Bearer ${token}`,
    "X-GA-Cursor-From": String(delta.cursorFrom),
    "X-GA-Cursor-To": String(delta.cursorTo),
    "X-GA-Schema-Version": "1",
    ...(getUserscriptVersion() ? { "X-GA-Script-Version": String(getUserscriptVersion()) } : {})
  };

  const res = await gmPostBytes(endpointUrl, delta.bytesGzip, { headers, timeoutMs: 60000 });
  const ok = res.status >= 200 && res.status < 300;

  const status: ServerSyncStatus = {
    ok,
    status: res.status,
    responseText: res.text,
    cursorFrom: delta.cursorFrom,
    cursorTo: delta.cursorTo,
    counts: delta.counts,
    bytesJson: delta.bytesJson,
    bytesGzip: delta.bytesGzip.length
  };

  await setLastServerSyncCursor(status);
  return status;
}

export async function getLastServerSyncMeta(): Promise<any | null> {
  const meta = await db.meta.get(SYNC_META_KEY);
  return meta?.value ?? null;
}
