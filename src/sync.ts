import { db, FeedGameRow, ModeFamily } from "./db";
import { httpGetJson } from "./http";

function etaLabel(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1e3));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function getByPath(obj: any, path: string): any {
  const parts = path.split(".");
  let cur = obj;
  for (const part of parts) {
    if (!cur || typeof cur !== "object" || !(part in cur)) return undefined;
    cur = cur[part];
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

function parsePayloadArray(payload: unknown): any[] {
  if (Array.isArray(payload)) return payload;
  if (typeof payload === "string") {
    try {
      const parsed = JSON.parse(payload);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeGameMode(modeRaw: unknown): string | undefined {
  if (typeof modeRaw !== "string") return undefined;
  const trimmed = modeRaw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function classifyModeFamily(gameMode?: string): ModeFamily {
  const m = String(gameMode || "").toLowerCase();
  if (m.includes("teamduels") || m.includes("team_duels") || m.includes("team-duels")) return "teamduels";
  if (m.includes("duels") || m.includes("duel")) return "duels";
  if (m.includes("standard")) return "standard";
  if (m.includes("streak")) return "streak";
  return "other";
}

function classifyModeFamilyFromEvent(ev: any, gameMode?: string): ModeFamily {
  const byMode = classifyModeFamily(gameMode);
  if (byMode !== "other") return byMode;
  const hintRaw = pickFirst(ev, [
    "type",
    "__typename",
    "payload.type",
    "payload.__typename",
    "payload.gameType",
    "payload.mode",
    "payload.slug"
  ]);
  const hint = String(hintRaw || "").toLowerCase();
  if (!hint) return "other";
  if (hint.includes("team") && hint.includes("duel")) return "teamduels";
  if (hint.includes("duel")) return "duels";
  if (hint.includes("streak")) return "streak";
  if (hint.includes("standard") || hint.includes("singleplayer") || hint.includes("classic")) return "standard";
  return "other";
}

function classifyTypeFromFamily(family: ModeFamily): FeedGameRow["type"] {
  if (family === "duels" || family === "teamduels") return "duels";
  if (family === "standard" || family === "streak") return "classic";
  return "other";
}

function extractEvents(entry: any): any[] {
  const payloadEvents = parsePayloadArray(entry?.payload);
  if (payloadEvents.length > 0) return payloadEvents;
  if (entry && typeof entry === "object") return [entry];
  return [];
}

function extractGameId(ev: any): string | undefined {
  const id = pickFirst(ev, [
    "payload.gameId",
    "gameId",
    "id",
    "payload.id"
  ]);
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

function extractEventTimeMs(ev: any, entry: any): number {
  const timeCandidate = pickFirst(ev, ["time", "createdAt", "payload.time"]) ?? entry?.time;
  const parsed = typeof timeCandidate === "string" ? Date.parse(timeCandidate) : NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function extractGameMode(ev: any, entry: any): string | undefined {
  return normalizeGameMode(
    pickFirst(ev, [
      "payload.gameMode",
      "payload.competitiveGameMode",
      "gameMode",
      "competitiveGameMode",
      "mode"
    ]) ?? pickFirst(entry, ["payload.gameMode", "payload.competitiveGameMode", "gameMode"])
  );
}

async function fetchFeedPage(paginationToken?: string, ncfa?: string): Promise<any> {
  const base = "https://www.geoguessr.com/api/v4/feed/private";
  const url = paginationToken ? `${base}?paginationToken=${encodeURIComponent(paginationToken)}` : base;
  const res = await httpGetJson(url, { ncfa });
  if (res.status < 200 || res.status >= 300) throw new Error(`Feed HTTP ${res.status}`);
  return res.data;
}

export async function syncFeed(opts: {
  onStatus: (msg: string) => void;
  maxPages?: number;
  delayMs?: number;
  ncfa?: string;
}): Promise<{ inserted: number; total: number }> {
  const maxPages = opts.maxPages ?? 120;
  const delayMs = opts.delayMs ?? 150;

  const meta = await db.meta.get("sync");
  const lastSeen = (meta?.value as any)?.lastSeenTime as number | undefined;

  let paginationToken: string | undefined;
  let inserted = 0;
  const startedAt = Date.now();

  for (let page = 1; page <= maxPages; page++) {
    const elapsed = Date.now() - startedAt;
    const avgPerPage = elapsed / Math.max(1, page - 1);
    const etaMs = page > 1 ? avgPerPage * Math.max(0, maxPages - page + 1) : 0;
    opts.onStatus(`Feed page ${page}/${maxPages}... ETA ~${etaLabel(etaMs)}`);
    const data = await fetchFeedPage(paginationToken, opts.ncfa);
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    if (entries.length === 0) break;

    const pageRows: FeedGameRow[] = [];
    for (const entry of entries) {
      const events = extractEvents(entry);
      for (const ev of events) {
        const gameId = extractGameId(ev);
        if (!gameId) continue;
        const playedAt = extractEventTimeMs(ev, entry);
        const gameMode = extractGameMode(ev, entry);
        const modeFamily = classifyModeFamilyFromEvent(ev, gameMode);
        pageRows.push({
          gameId,
          playedAt,
          gameMode,
          mode: gameMode,
          modeFamily,
          isTeamDuels: modeFamily === "teamduels",
          type: classifyTypeFromFamily(modeFamily),
          raw: ev
        });
      }
    }

    // Deduplicate within page by gameId, keep newest event for same id.
    const byId = new Map<string, FeedGameRow>();
    for (const row of pageRows) {
      const prev = byId.get(row.gameId);
      if (!prev || row.playedAt > prev.playedAt) byId.set(row.gameId, row);
    }
    const deduped = [...byId.values()];

    // Insert / update rows in one bulkPut (covers older rows that gained mode info later).
    if (deduped.length > 0) {
      await db.games.bulkPut(deduped);
      inserted += deduped.length;
    }

    const newest = deduped.reduce((m, g) => Math.max(m, g.playedAt), lastSeen || 0);
    await db.meta.put({
      key: "sync",
      value: { lastSeenTime: newest },
      updatedAt: Date.now()
    });

    paginationToken = typeof data?.paginationToken === "string" && data.paginationToken ? data.paginationToken : undefined;
    const elapsed2 = Date.now() - startedAt;
    const avgPerPage2 = elapsed2 / page;
    const etaMs2 = avgPerPage2 * Math.max(0, maxPages - page);
    opts.onStatus(`Synced ${inserted} games so far. ETA ~${etaLabel(etaMs2)}`);

    if (!paginationToken) break;

    // Stop once this page is fully at/older than lastSeen.
    if (lastSeen && deduped.length > 0) {
      const newestOnPage = deduped.reduce((m, g) => Math.max(m, g.playedAt), 0);
      const oldestOnPage = deduped.reduce((m, g) => Math.min(m, g.playedAt), Number.POSITIVE_INFINITY);
      if (newestOnPage <= lastSeen || (Number.isFinite(oldestOnPage) && oldestOnPage <= lastSeen)) {
        opts.onStatus(`Reached previously synced period (${new Date(lastSeen).toLocaleString()}).`);
        break;
      }
    }

    await new Promise((r) => setTimeout(r, delayMs));
  }

  const total = await db.games.count();
  return { inserted, total };
}

export async function getModeCounts(): Promise<Array<{ mode: string; count: number }>> {
  const all = await db.games.toArray();
  const map = new Map<string, number>();
  for (const g of all) {
    const k = g.gameMode || g.mode || "unknown";
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()]
    .map(([mode, count]) => ({ mode, count }))
    .sort((a, b) => b.count - a.count);
}
