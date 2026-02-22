import { db, FeedGameRow, ModeFamily } from "./db";
import { httpGetJson } from "./http";
import { fetchDetailsForGames } from "./details";

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

const GAME_ID_PATHS = ["payload.gameId", "gameId", "id", "payload.id"] as const;

function extractGameIdWithSource(ev: any): { gameId?: string; source: string } {
  for (const path of GAME_ID_PATHS) {
    const id = getByPath(ev, path);
    if (typeof id === "string" && id.trim()) {
      return { gameId: id.trim(), source: path };
    }
  }
  return { source: "none" };
}

function typeHint(ev: any): string {
  const hintRaw = pickFirst(ev, ["type", "__typename", "payload.type", "payload.__typename", "payload.gameType", "payload.mode"]);
  const hint = String(hintRaw || "").trim();
  return hint || "unknown";
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
  const maxPages = opts.maxPages ?? 5000;
  const delayMs = opts.delayMs ?? 150;

  const meta = await db.meta.get("sync");
  const lastSeen = (meta?.value as any)?.lastSeenTime as number | undefined;

  let paginationToken: string | undefined;
  const seenPaginationTokens = new Set<string>();
  let inserted = 0;
  const startedAt = Date.now();
  let pagesFetched = 0;
  let entriesSeen = 0;
  let eventsSeen = 0;
  let rowsWithGameId = 0;
  let dedupedRows = 0;
  let breakReason = "completed";
  let stoppedAtPage = 0;
  let syncNewestObserved = lastSeen || 0;
  let syncOldestObserved = Number.POSITIVE_INFINITY;
  const idSourceCounts = new Map<string, number>();
  const dropReasonCounts = new Map<string, number>();
  const dropTypeCounts = new Map<string, number>();
  const droppedEventSamples: Array<{
    page: number;
    entryIndex: number;
    eventIndex: number;
    reason: string;
    typeHint: string;
    gameModeHint: string;
    idSource: string;
    idCandidate_payloadGameId: string;
    idCandidate_gameId: string;
    idCandidate_id: string;
    idCandidate_payloadId: string;
    timeCandidate: string;
  }> = [];
  const pageDiagnostics: Array<{
    page: number;
    entries: number;
    events: number;
    withGameId: number;
    deduped: number;
    inserted: number;
    droppedNoGameId: number;
    newestPlayedAt?: number;
    oldestPlayedAt?: number;
    hasPaginationToken: number;
  }> = [];

  for (let page = 1; page <= maxPages; page++) {
    pagesFetched = page;
    opts.onStatus(`Feed page ${page}...`);
    const data = await fetchFeedPage(paginationToken, opts.ncfa);
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    entriesSeen += entries.length;
    if (entries.length === 0) {
      breakReason = "empty_page";
      stoppedAtPage = page;
      break;
    }

    const pageRows: FeedGameRow[] = [];
    let pageEvents = 0;
    let pageWithGameId = 0;
    let pageDroppedNoGameId = 0;
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
      const entry = entries[entryIndex];
      const events = extractEvents(entry);
      eventsSeen += events.length;
      pageEvents += events.length;
      for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
        const ev = events[eventIndex];
        const extracted = extractGameIdWithSource(ev);
        const gameId = extracted.gameId;
        if (!gameId) {
          pageDroppedNoGameId++;
          dropReasonCounts.set("no_game_id", (dropReasonCounts.get("no_game_id") || 0) + 1);
          const evType = typeHint(ev);
          dropTypeCounts.set(evType, (dropTypeCounts.get(evType) || 0) + 1);
          if (droppedEventSamples.length < 2000) {
            const gameModeHint = String(
              pickFirst(ev, ["payload.gameMode", "payload.competitiveGameMode", "gameMode", "competitiveGameMode", "mode"]) ||
                ""
            );
            const tCandidate =
              pickFirst(ev, ["time", "createdAt", "payload.time"]) ?? (entry && typeof entry === "object" ? entry.time : undefined);
            droppedEventSamples.push({
              page,
              entryIndex,
              eventIndex,
              reason: "no_game_id",
              typeHint: evType,
              gameModeHint,
              idSource: extracted.source,
              idCandidate_payloadGameId: String(getByPath(ev, "payload.gameId") ?? ""),
              idCandidate_gameId: String(getByPath(ev, "gameId") ?? ""),
              idCandidate_id: String(getByPath(ev, "id") ?? ""),
              idCandidate_payloadId: String(getByPath(ev, "payload.id") ?? ""),
              timeCandidate: String(tCandidate ?? "")
            });
          }
          continue;
        }
        rowsWithGameId++;
        pageWithGameId++;
        idSourceCounts.set(extracted.source, (idSourceCounts.get(extracted.source) || 0) + 1);
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
    dedupedRows += deduped.length;

    // Insert / update rows in one bulkPut (covers older rows that gained mode info later).
    if (deduped.length > 0) {
      await db.games.bulkPut(deduped);
      inserted += deduped.length;
    }
    pageDiagnostics.push({
      page,
      entries: entries.length,
      events: pageEvents,
      withGameId: pageWithGameId,
      deduped: deduped.length,
      inserted: deduped.length,
      droppedNoGameId: pageDroppedNoGameId,
      newestPlayedAt: deduped.length > 0 ? deduped.reduce((m, g) => Math.max(m, g.playedAt), 0) : undefined,
      oldestPlayedAt: deduped.length > 0 ? deduped.reduce((m, g) => Math.min(m, g.playedAt), Number.POSITIVE_INFINITY) : undefined,
      hasPaginationToken: typeof data?.paginationToken === "string" && data.paginationToken ? 1 : 0
    });

    const newest = deduped.reduce((m, g) => Math.max(m, g.playedAt), lastSeen || 0);
    await db.meta.put({
      key: "sync",
      value: { lastSeenTime: newest },
      updatedAt: Date.now()
    });

    paginationToken = typeof data?.paginationToken === "string" && data.paginationToken ? data.paginationToken : undefined;
    const elapsed2 = Date.now() - startedAt;
    let etaText = "ETA unknown";
    let progressText = "";
    if (deduped.length > 0) {
      const newestOnPage = deduped.reduce((m, g) => Math.max(m, g.playedAt), 0);
      const oldestOnPage = deduped.reduce((m, g) => Math.min(m, g.playedAt), Number.POSITIVE_INFINITY);
      if (newestOnPage > syncNewestObserved) syncNewestObserved = newestOnPage;
      if (oldestOnPage < syncOldestObserved) syncOldestObserved = oldestOnPage;
      if (lastSeen && syncNewestObserved > lastSeen && Number.isFinite(syncOldestObserved)) {
        const covered = syncNewestObserved - syncOldestObserved;
        const totalSpan = syncNewestObserved - lastSeen;
        const progress = Math.max(0, Math.min(1, covered / totalSpan));
        if (progress > 0) {
          const etaMs2 = elapsed2 * ((1 - progress) / progress);
          etaText = progress >= 0.999 ? "ETA ~0s" : `ETA ~${etaLabel(etaMs2)}`;
          progressText = ` | progress ${(progress * 100).toFixed(1)}%`;
        }
      }
    }
    opts.onStatus(`Synced ${inserted} games so far.${progressText} ${etaText} (page ${page})`);

    if (!paginationToken) {
      breakReason = "no_pagination_token";
      stoppedAtPage = page;
      break;
    }
    if (seenPaginationTokens.has(paginationToken)) {
      breakReason = "repeated_pagination_token";
      stoppedAtPage = page;
      opts.onStatus("Stopped sync due to repeated pagination token (loop protection).");
      break;
    }
    seenPaginationTokens.add(paginationToken);

    // Stop once this page has no data newer than lastSeen.
    if (lastSeen && deduped.length > 0) {
      const newestOnPage = deduped.reduce((m, g) => Math.max(m, g.playedAt), 0);
      if (newestOnPage <= lastSeen) {
        opts.onStatus(`Reached previously synced period (${new Date(lastSeen).toLocaleString()}).`);
        breakReason = "reached_last_seen";
        stoppedAtPage = page;
        break;
      }
    }

    await new Promise((r) => setTimeout(r, delayMs));
  }
  if (!stoppedAtPage) stoppedAtPage = pagesFetched;
  if (pagesFetched >= maxPages && breakReason === "completed") {
    breakReason = "max_pages_reached";
  }

  const total = await db.games.count();
  const elapsedMs = Date.now() - startedAt;
  const syncDiag = {
    startedAt,
    finishedAt: Date.now(),
    elapsedMs,
    maxPages,
    delayMs,
    lastSeenBeforeSync: lastSeen || null,
    breakReason,
    stoppedAtPage,
    pagesFetched,
    entriesSeen,
    eventsSeen,
    rowsWithGameId,
    dedupedRows,
    idSourceCounts: Object.fromEntries([...idSourceCounts.entries()].sort((a, b) => b[1] - a[1])),
    dropReasonCounts: Object.fromEntries([...dropReasonCounts.entries()].sort((a, b) => b[1] - a[1])),
    dropTypeCounts: Object.fromEntries([...dropTypeCounts.entries()].sort((a, b) => b[1] - a[1])),
    droppedEventSamples,
    pageDiagnostics,
    insertedRows: inserted,
    totalGamesAfterSync: total
  };
  await db.meta.put({
    key: "syncDebugLast",
    value: syncDiag,
    updatedAt: Date.now()
  });
  return { inserted, total };
}

export async function updateData(opts: {
  onStatus: (msg: string) => void;
  maxPages?: number;
  delayMs?: number;
  detailConcurrency?: number;
  verifyCompleteness?: boolean;
  retryErrors?: boolean;
  enrichLimit?: number;
  ncfa?: string;
}): Promise<{
  feedPages: number;
  feedUpserted: number;
  detailsQueued: number;
  detailsOk: number;
  detailsFail: number;
  detailsSkipped: number;
  enrichedQueued: number;
  enrichedOk: number;
  enrichedFail: number;
  enrichedSkipped: number;
}> {
  const maxPages = opts.maxPages ?? 5000;
  const delayMs = opts.delayMs ?? 150;
  const detailConcurrency = opts.detailConcurrency ?? 4;
  const verifyCompleteness = opts.verifyCompleteness ?? true;
  const retryErrors = opts.retryErrors ?? true;
  const enrichLimit = opts.enrichLimit ?? 1500;

  const startedAt = Date.now();
  const meta = await db.meta.get("sync");
  const lastSeen = (meta?.value as any)?.lastSeenTime ? Number((meta?.value as any)?.lastSeenTime) : null;

  let paginationToken: string | undefined;
  let feedPages = 0;
  let feedUpserted = 0;
  let estimatedTotalPages: number | null = null;
  let estimatedTotalGames: number | null = null;
  let probeDone = false;
  let probePromise: Promise<void> | null = null;
  const probeErrors: string[] = [];

  let detailsQueued = 0;
  let detailsOk = 0;
  let detailsFail = 0;
  let detailsSkipped = 0;

  const seenPaginationTokens = new Set<string>();

  opts.onStatus("Update started (feed + details)...");

  for (let page = 0; page < maxPages; page++) {
    feedPages = page + 1;
    opts.onStatus(`Fetching feed page ${page}...`);

    const data = await fetchFeedPage(paginationToken, opts.ncfa);
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    if (entries.length === 0) {
      opts.onStatus(`Feed page ${page} empty. Stopping.`);
      break;
    }

    const nextPaginationToken = typeof data?.paginationToken === "string" && data.paginationToken ? data.paginationToken : undefined;

    const pageRows: FeedGameRow[] = [];
    for (const entry of entries) {
      const evs = extractEvents(entry);
      for (const ev of evs) {
        const { gameId } = extractGameIdWithSource(ev);
        if (!gameId) continue;
        const playedAt = extractEventTimeMs(ev, entry);
        const gameMode = extractGameMode(ev, entry);
        const modeFamily = classifyModeFamilyFromEvent(ev, gameMode);
        pageRows.push({
          gameId,
          type: classifyTypeFromFamily(modeFamily),
          playedAt,
          mode: gameMode,
          gameMode,
          modeFamily,
          isTeamDuels: modeFamily === "teamduels",
          raw: ev
        });
      }
    }

    // Dedupe by gameId and keep most recent playedAt.
    const byId = new Map<string, FeedGameRow>();
    for (const row of pageRows) {
      const prev = byId.get(row.gameId);
      if (!prev || row.playedAt > prev.playedAt) byId.set(row.gameId, row);
    }
    const deduped = [...byId.values()];

    if (deduped.length > 0) {
      await db.games.bulkPut(deduped);
      feedUpserted += deduped.length;
    }

    const newestOnPage = deduped.length > 0 ? deduped.reduce((m, g) => Math.max(m, g.playedAt), 0) : 0;
    const oldestOnPage = deduped.length > 0 ? deduped.reduce((m, g) => Math.min(m, g.playedAt), Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
    const elapsed = Date.now() - startedAt;

    // Best-effort probe to estimate how many pages/games are left. Runs in parallel with detail fetching.
    if (!probePromise && nextPaginationToken) {
      probePromise = (async () => {
        try {
          const seenTokensProbe = new Set<string>();
          let token = nextPaginationToken;
          let pages = feedPages;
          let games = feedUpserted;

          while (token && pages < maxPages) {
            if (seenTokensProbe.has(token)) break;
            seenTokensProbe.add(token);

            const d = await fetchFeedPage(token, opts.ncfa);
            const ents = Array.isArray(d?.entries) ? d.entries : [];
            if (ents.length === 0) break;

            const rows: FeedGameRow[] = [];
            for (const entry of ents) {
              const evs = extractEvents(entry);
              for (const ev of evs) {
                const { gameId } = extractGameIdWithSource(ev);
                if (!gameId) continue;
                const playedAt = extractEventTimeMs(ev, entry);
                const gameMode = extractGameMode(ev, entry);
                const modeFamily = classifyModeFamilyFromEvent(ev, gameMode);
                rows.push({
                  gameId,
                  type: classifyTypeFromFamily(modeFamily),
                  playedAt,
                  mode: gameMode,
                  gameMode,
                  modeFamily,
                  isTeamDuels: modeFamily === "teamduels",
                  raw: ev
                });
              }
            }

            // Dedupe within page (same logic as the main loop; estimate only).
            const byId = new Map<string, FeedGameRow>();
            for (const row of rows) {
              const prev = byId.get(row.gameId);
              if (!prev || row.playedAt > prev.playedAt) byId.set(row.gameId, row);
            }
            const ded = [...byId.values()];
            games += ded.length;
            pages += 1;

            const newest = ded.length > 0 ? ded.reduce((m, g) => Math.max(m, g.playedAt), 0) : 0;
            const next = typeof d?.paginationToken === "string" && d.paginationToken ? d.paginationToken : undefined;
            token = next;

            if (!token) break;
            if (lastSeen && newest > 0 && newest <= lastSeen) break;
          }

          estimatedTotalPages = pages;
          estimatedTotalGames = games;
        } catch (e) {
          probeErrors.push(e instanceof Error ? e.message : String(e));
        } finally {
          probeDone = true;
        }
      })();
      void probePromise;
    }

    // Keep the "lastSeen" pointer at the newest known timestamp (head of feed).
    const newest = Math.max(Number(lastSeen || 0), newestOnPage || 0);
    await db.meta.put({ key: "sync", value: { lastSeenTime: newest }, updatedAt: Date.now() });

    // Fetch/enrich details for games we just saw, so the update proceeds step-by-step.
    if (deduped.length > 0) {
      const res = await fetchDetailsForGames({
        onStatus: (m) => opts.onStatus(`Page ${page} | ${m}`),
        games: deduped,
        concurrency: detailConcurrency,
        verifyCompleteness,
        retryErrors,
        ncfa: opts.ncfa,
        reason: `feed-page-${page}`
      });
      detailsQueued += res.queued;
      detailsOk += res.ok;
      detailsFail += res.fail;
      detailsSkipped += res.skipped;
    }

    // Progress: time-span based (stable across shifting pages) + optional page-count based ETA (if probe finished).
    let spanEtaText = "ETA unknown";
    if (lastSeen && Number.isFinite(oldestOnPage) && newestOnPage > 0) {
      const covered = newestOnPage - oldestOnPage;
      const totalSpan = newestOnPage - lastSeen;
      const progress = totalSpan > 0 ? Math.max(0, Math.min(1, covered / totalSpan)) : 1;
      if (progress > 0) {
        const etaMs = elapsed * ((1 - progress) / progress);
        spanEtaText = progress >= 0.999 ? "ETA ~0s" : `ETA ~${etaLabel(etaMs)}`;
      }
    }

    let pageEtaText = "";
    if (estimatedTotalPages && estimatedTotalPages >= feedPages) {
      const avgMsPerPage = elapsed / Math.max(1, feedPages);
      const remainingPages = Math.max(0, estimatedTotalPages - feedPages);
      const etaMs = avgMsPerPage * remainingPages;
      const gamesPart = estimatedTotalGames ? `, games ~${feedUpserted}/${estimatedTotalGames}` : "";
      pageEtaText = `Overall: ${feedPages}/${estimatedTotalPages} pages${gamesPart} ETA ~${etaLabel(etaMs)}`;
    } else if (probePromise && !probeDone) {
      pageEtaText = "Overall: estimating total pages...";
    } else if (probeErrors.length > 0) {
      pageEtaText = "Overall: estimate unavailable.";
    }

    opts.onStatus(
      `Feed page ${page}: upserted ${deduped.length} games (total ${feedUpserted}). Details queued ${detailsQueued}, ok ${detailsOk}, fail ${detailsFail}. ${pageEtaText || spanEtaText}`
    );

    paginationToken = nextPaginationToken;
    if (!paginationToken) {
      opts.onStatus("Feed has no pagination token. Stopping.");
      break;
    }
    if (seenPaginationTokens.has(paginationToken)) {
      opts.onStatus("Stopped sync due to repeated pagination token (loop protection).");
      break;
    }
    seenPaginationTokens.add(paginationToken);

    // Stop once this page has no data newer than lastSeen.
    if (lastSeen && newestOnPage > 0 && newestOnPage <= lastSeen) {
      opts.onStatus(`Reached previously synced period (${new Date(lastSeen).toLocaleString()}).`);
      break;
    }

    await new Promise((r) => setTimeout(r, delayMs));
  }

  // Enrichment pass: fill newly introduced fields (map, rated) for already-fetched games.
  let enrichedQueued = 0;
  let enrichedOk = 0;
  let enrichedFail = 0;
  let enrichedSkipped = 0;
  if (enrichLimit > 0) {
    opts.onStatus(`Enriching existing details (limit ${enrichLimit})...`);
    const recentDetails = await db.details.orderBy("fetchedAt").reverse().limit(enrichLimit).toArray();
    const needIds = recentDetails
      .filter((d: any) => d?.status === "ok")
      .filter((d: any) => {
        const missSlug = typeof d?.mapSlug !== "string" || !d.mapSlug.trim();
        const missName = typeof d?.mapName !== "string" || !d.mapName.trim();
        const missRated = typeof d?.isRated !== "boolean";
        return missSlug || missName || missRated;
      })
      .map((d: any) => d.gameId)
      .filter((x: any): x is string => typeof x === "string" && x);

    if (needIds.length > 0) {
      const games = (await db.games.bulkGet(needIds)).filter((g): g is FeedGameRow => !!g);
      const res = await fetchDetailsForGames({
        onStatus: (m) => opts.onStatus(`Enrich | ${m}`),
        games,
        concurrency: detailConcurrency,
        verifyCompleteness: false,
        retryErrors,
        ncfa: opts.ncfa,
        reason: "enrich-missing-fields"
      });
      enrichedQueued = res.queued;
      enrichedOk = res.ok;
      enrichedFail = res.fail;
      enrichedSkipped = res.skipped;
    } else {
      opts.onStatus("No existing details need enrichment.");
    }
  }

  opts.onStatus("Update complete.");
  return {
    feedPages,
    feedUpserted,
    detailsQueued,
    detailsOk,
    detailsFail,
    detailsSkipped,
    enrichedQueued,
    enrichedOk,
    enrichedFail,
    enrichedSkipped
  };
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
