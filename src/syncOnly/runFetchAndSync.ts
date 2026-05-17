import { fetchFeed } from "../feedFetcher_v2";
import { fetchDetails } from "../detailFetcher_v2";
import { syncToServerV2 } from "../serverSync_v2";
import { loadServerSyncSettings } from "../serverSync";
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
  details: { queued: number; succeeded: number; failed: number; permanentlySkipped: number; error?: string };
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
    details: { queued: 0, succeeded: 0, failed: 0, permanentlySkipped: 0 },
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
  let detailsSucceeded = 0;
  try {
    const detailResult = await fetchDetails({
      concurrency: 3,
      delayMs: 400,
      force: opts.forceFull,
      onProgress: (p) => {
        opts.setStatus(`Details ${p.processed}/${p.total} — ok: ${p.succeeded}, fail: ${p.failed}...`);
      },
    });
    log.details = {
      queued: detailResult.queued,
      succeeded: detailResult.succeeded,
      failed: detailResult.failed,
      permanentlySkipped: detailResult.permanentlySkipped,
    };
    detailsSucceeded = detailResult.succeeded;
  } catch (e: any) {
    log.details.error = e instanceof Error ? e.message : String(e || "Details fetch failed");
    // Non-fatal: continue to sync with what we have
  }

  // Phase 3: Server sync — force full if any games had fields updated
  const syncFull = opts.forceFull || detailsSucceeded > 0;
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

  opts.setStatus(syncFull ? "Syncing full snapshot to server..." : "Syncing to server...");
  try {
    const syncResult = await syncToServerV2({
      full: syncFull,
      detailsOnly: false,
      onProgress: (p) => {
        if (p.phase === "upload") {
          opts.setStatus(`Syncing batch ${p.batch}/${p.totalBatches} — ${p.gamesUploaded} games...`);
        }
      },
    });

    log.sync = {
      gamesUploaded: syncResult.gamesUploaded,
      gamesNew: syncResult.gamesNew,
      roundsNew: syncResult.roundsNew,
      batches: syncResult.batches,
    };

    if (!syncResult.ok) {
      const errMap: Record<string, { msg: string; hint: string }> = {
        no_token: { msg: "Missing sync token. Click to link device.", hint: "Click the button to link your device (Discord), then try again." },
        no_player_id: { msg: "Could not determine player ID. Make sure you are logged in to GeoGuessr.", hint: "Reload geoguessr.com, log in, then retry." },
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
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e || "Sync failed");
    log.sync.error = msg;
    return fail(msg);
  }

  const label = opts.forceFull ? "Full sync" : "Synced";
  const message = `${label} — feed: ${log.feed.newGames}, details ok: ${log.details.succeeded}, server new: ${log.sync.gamesNew}`;
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
