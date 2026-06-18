import { fetchFeed } from "../feedFetcher_v2";
import { fetchDetails } from "../detailFetcher_v2";
import { getCurrentPlayerId } from "../app/playerIdentity";
import { syncClassicToServer, syncClassicToServerV3 } from "../serverSync_v2";
import { loadServerSyncSettings } from "../serverSync";
import { syncV3FromDb2, syncPlayerProfiles } from "../serverSync_v3_db2";
import { isMigrationNeeded, migrateV1ToV2 } from "../migration_v1_to_v2";
import { linkDeviceViaDiscord } from "./linkDevice";

function readLocalNumber(key: string): number {
  try {
    const raw = globalThis?.localStorage?.getItem(key);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeLocalNumber(key: string, value: number): void {
  try {
    globalThis?.localStorage?.setItem(key, String(Math.floor(value)));
  } catch {
    // ignore
  }
}

const AUTO_KEY = "geoanalyzr_sync_only_last_auto_ms";

export interface SyncLog {
  timestamp: string;
  mode: "incremental" | "full";
  feed: { newGames: number; stopped: string; error?: string };
  details: { queued: number; succeeded: number; failed: number; permanentlySkipped: number; selfIdFixed: number; error?: string };
  sync: { gamesUploaded: number; gamesNew: number; roundsNew: number; batches: number; error?: string };
  result: "ok" | "error";
  message: string;
}

export async function runFetchAndSync(opts: {
  forceFull: boolean;
  setStatus: (msg: string) => void;
  ensureLinked: boolean;
}): Promise<{ ok: boolean; message: string; hint?: string; log: SyncLog }> {
  const log: SyncLog = {
    timestamp: new Date().toISOString(),
    mode: opts.forceFull ? "full" : "incremental",
    feed: { newGames: 0, stopped: "" },
    details: { queued: 0, succeeded: 0, failed: 0, permanentlySkipped: 0, selfIdFixed: 0 },
    sync: { gamesUploaded: 0, gamesNew: 0, roundsNew: 0, batches: 0 },
    result: "error",
    message: "",
  };

  const fail = (message: string, hint?: string): { ok: false; message: string; hint?: string; log: SyncLog } => {
    log.result = "error";
    log.message = message;
    return { ok: false, message, hint, log };
  };

  // One-time migration from v1 IndexedDB to v2
  try {
    if (await isMigrationNeeded()) {
      opts.setStatus("Migrating local data to v2 format...");
      await migrateV1ToV2((p) => {
        if (p.phase === "games") opts.setStatus(`Migrating games: ${p.processed}/${p.total}...`);
        else if (p.phase === "rounds") opts.setStatus(`Migrating rounds: ${p.processed}/${p.total}...`);
      });
    }
  } catch {
    // Non-fatal: migration failure means we start fresh with v2
  }

  // Phase 1: Feed
  opts.setStatus(opts.forceFull ? "Fetching full history (last 365 days)..." : "Fetching feed...");
  let feedNewGameIds: string[] = [];
  try {
    const feedResult = await fetchFeed({
      full: opts.forceFull,
      maxPages: 5000,
      delayMs: 150,
      overlapThreshold: 5,
      onProgress: (p) => {
        opts.setStatus(`Feed page ${p.page} — ${p.newGames} new games...`);
      },
    });
    log.feed.newGames = feedResult.newGames;
    log.feed.stopped = feedResult.stopped;
    feedNewGameIds = feedResult.newGameIds;
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e || "Feed fetch failed");
    log.feed.error = msg;
    const http = msg.match(/HTTP\s*(\d{3})/i);
    const status = http ? Number(http[1]) : NaN;
    if (status === 401 || status === 403) {
      return fail(`Feed HTTP ${status} — please log in to GeoGuessr and retry.`, "Reload geoguessr.com, log in, then try again.");
    }
    return fail(msg);
  }

  // Phase 2: Details
  opts.setStatus("Fetching game details...");
  let detailUpdatedGameIds: string[] = [];
  try {
    const detailResult = await fetchDetails({
      concurrency: 3,
      delayMs: 400,
      force: opts.forceFull,
      maxAgeDays: opts.forceFull ? 365 : undefined,
      currentPlayerId: (await getCurrentPlayerId()) ?? undefined,
      onProgress: (p) => {
        opts.setStatus(`Details ${p.processed}/${p.total} — ok: ${p.succeeded}, fail: ${p.failed}...`);
      },
    });
    log.details = {
      queued: detailResult.queued,
      succeeded: detailResult.succeeded,
      failed: detailResult.failed,
      permanentlySkipped: detailResult.permanentlySkipped,
      selfIdFixed: detailResult.selfIdFixed,
    };
    detailUpdatedGameIds = detailResult.updatedGameIds;
  } catch (e: any) {
    log.details.error = e instanceof Error ? e.message : String(e || "Details fetch failed");
    // Non-fatal: continue to sync with what we have
  }

  // Phase 3: Server sync — only upload games touched in this cycle
  const touchedIds = opts.forceFull ? undefined : [...new Set([...feedNewGameIds, ...detailUpdatedGameIds])];
  const hasNewGames = opts.forceFull || touchedIds!.length > 0;

  let settings = loadServerSyncSettings();
  if (!settings.token) {
    if (!opts.ensureLinked) {
      return fail("Missing sync token. Click to link device.", "Click the button to link your device (Discord), then try again.");
    }
    opts.setStatus("Linking device...");
    await linkDeviceViaDiscord();
    settings = loadServerSyncSettings();
  }
  if (!settings.token) {
    return fail("Missing sync token. Link failed.", "Try linking again. If it keeps failing, disable popup blockers and retry.");
  }

  opts.setStatus(hasNewGames ? (opts.forceFull ? "Syncing to server..." : `Syncing ${touchedIds?.length ?? 0} games to server...`) : "Syncing player profiles...");
  try {
    const syncResult = hasNewGames
      ? await syncV3FromDb2({ forceFull: opts.forceFull, gameIds: touchedIds })
      : { ok: true, counts: { players: 0, standard_games: 0, standard_rounds: 0, duel_games: 0, duel_rounds: 0, team_duel_games: 0, team_duel_rounds: 0 } };

    log.sync = {
      gamesUploaded: syncResult.counts?.duel_games ?? 0 + (syncResult.counts?.team_duel_games ?? 0),
      gamesNew: syncResult.counts?.duel_games ?? 0 + (syncResult.counts?.team_duel_games ?? 0),
      roundsNew: syncResult.counts?.duel_rounds ?? 0 + (syncResult.counts?.team_duel_rounds ?? 0),
      batches: 1,
    };

    if (!syncResult.ok) {
      const errMap: Record<string, { msg: string; hint: string }> = {
        no_token: { msg: "Missing sync token. Click to link device.", hint: "Click the button to link your device (Discord), then try again." },
        no_player_id: { msg: "Could not determine player ID. Make sure you are logged in to GeoGuessr.", hint: "Reload geoguessr.com, log in, then retry." },
        no_endpoint: { msg: "Missing sync endpoint URL. Check your settings.", hint: "Configure the sync endpoint in GeoAnalyzr settings." },
      };
      if (syncResult.error && errMap[syncResult.error]) {
        return fail(errMap[syncResult.error].msg, errMap[syncResult.error].hint);
      }
      const http = String(syncResult.error || "").match(/(\d{3})/);
      const status = http ? Number(http[1]) : NaN;
      if (status === 401 || status === 403) return fail(`Sync failed (HTTP ${status})`, "Token invalid/expired. Click to re-link your device, then retry.");
      if (status === 413) return fail(`Sync failed (HTTP 413)`, "Payload too large. Try without Shift key (incremental sync).");
      if (status >= 500) return fail(`Sync failed (HTTP ${status})`, "Server error. Retry in a few minutes.");
      return fail(`Sync failed: ${syncResult.error ?? "unknown"}`);
    }

    // Classic games sync (non-fatal on failure)
    try { await syncClassicToServer(); } catch { /* ignore */ }
    try { await syncClassicToServerV3(); } catch { /* ignore */ }

    // Phase 4: fill player profiles (own + up to 50 opponents per run)
    opts.setStatus("Syncing player profiles...");
    try {
      const profResult = await syncPlayerProfiles({
        batchSize: 50,
        onProgress: (msg) => opts.setStatus(msg),
      });
      if (profResult.fetched > 0) {
        opts.setStatus(`Player profiles: ${profResult.sent} synced (${profResult.fetched} fetched)`);
      }
    } catch { /* non-fatal */ }
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e || "Sync failed");
    log.sync.error = msg;
    return fail(msg);
  }

  const label = opts.forceFull ? "Full sync" : "Synced";
  const parts = [
    `feed: ${log.feed.newGames}`,
    `details ok: ${log.details.succeeded}`,
    `server new: ${log.sync.gamesNew}`,
  ];
  if (log.details.selfIdFixed > 0) parts.push(`selfId fixed: ${log.details.selfIdFixed}`);
  if (log.details.failed > 0) parts.push(`failed: ${log.details.failed}`);
  const message = `${label} — ${parts.join(", ")}`;
  log.result = "ok";
  log.message = message;
  return { ok: true, message, log };
}

export function shouldAutoRun(nowMs: number, minIntervalMs: number): boolean {
  const last = readLocalNumber(AUTO_KEY);
  if (!last) return true;
  return nowMs - last >= minIntervalMs;
}

export function markAutoRun(nowMs: number): void {
  writeLocalNumber(AUTO_KEY, nowMs);
}
