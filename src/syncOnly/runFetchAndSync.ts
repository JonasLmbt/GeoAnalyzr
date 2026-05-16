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

export async function runFetchAndSync(opts: {
  forceFull: boolean;
  setStatus: (msg: string) => void;
  ensureLinked: boolean;
}): Promise<{ ok: boolean; message: string; hint?: string }> {

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
  let feedResult;
  try {
    feedResult = await fetchFeed({
      full: opts.forceFull,
      maxPages: 5000,
      delayMs: 150,
      overlapThreshold: 5,
      onProgress: (p) => {
        opts.setStatus(`Feed page ${p.page} — ${p.newGames} new games...`);
      },
    });
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e || "Feed fetch failed");
    const http = msg.match(/HTTP\s*(\d{3})/i);
    const status = http ? Number(http[1]) : NaN;
    if (status === 401 || status === 403) {
      return { ok: false, message: `Feed HTTP ${status} — please log in to GeoGuessr and retry.`, hint: "Reload geoguessr.com, log in, then try again." };
    }
    return { ok: false, message: msg };
  }

  // Phase 2: Details
  opts.setStatus("Fetching game details...");
  let detailResult;
  try {
    detailResult = await fetchDetails({
      concurrency: 3,
      delayMs: 400,
      retryFailed: true,
      onProgress: (p) => {
        opts.setStatus(`Details ${p.processed}/${p.total} — ok: ${p.succeeded}, fail: ${p.failed}...`);
      },
    });
  } catch (e: any) {
    // Non-fatal: continue to sync with what we have
    detailResult = { succeeded: 0, failed: 0 };
  }

  // Phase 3: Server sync
  let settings = loadServerSyncSettings();
  if (!settings.token) {
    if (!opts.ensureLinked) {
      return { ok: false, message: "Missing sync token. Click to link device.", hint: "Click the button to link your device (Discord), then try again." };
    }
    opts.setStatus("Linking device...");
    await linkDeviceViaDiscord();
    settings = loadServerSyncSettings();
  }
  if (!settings.token) {
    return { ok: false, message: "Missing sync token. Link failed.", hint: "Try linking again. If it keeps failing, disable popup blockers and retry." };
  }

  opts.setStatus(opts.forceFull ? "Syncing full snapshot to server..." : "Syncing to server...");
  let syncResult;
  try {
    syncResult = await syncToServerV2({
      full: opts.forceFull,
      detailsOnly: false,
      onProgress: (p) => {
        if (p.phase === "upload") {
          opts.setStatus(`Syncing batch ${p.batch}/${p.totalBatches} — ${p.gamesUploaded} games...`);
        }
      },
    });
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e || "Sync failed");
    return { ok: false, message: msg };
  }

  if (!syncResult.ok) {
    const errMap: Record<string, { msg: string; hint: string }> = {
      no_token: { msg: "Missing sync token. Click to link device.", hint: "Click the button to link your device (Discord), then try again." },
      no_player_id: { msg: "Could not determine player ID. Make sure you are logged in to GeoGuessr.", hint: "Reload geoguessr.com, log in, then retry." },
    };
    if (syncResult.error && errMap[syncResult.error]) {
      return { ok: false, ...errMap[syncResult.error] };
    }
    const http = String(syncResult.error || "").match(/(\d{3})/);
    const status = http ? Number(http[1]) : NaN;
    if (status === 401 || status === 403) return { ok: false, message: `Sync failed (HTTP ${status})`, hint: "Token invalid/expired. Click to re-link your device, then retry." };
    if (status === 413) return { ok: false, message: `Sync failed (HTTP 413)`, hint: "Payload too large. Try without Shift key (incremental sync)." };
    if (status >= 500) return { ok: false, message: `Sync failed (HTTP ${status})`, hint: "Server error. Retry in a few minutes." };
    return { ok: false, message: `Sync failed: ${syncResult.error ?? "unknown"}` };
  }

  const label = opts.forceFull ? "Full sync" : "Synced";
  return {
    ok: true,
    message: `${label} — feed: ${feedResult.newGames}, details ok: ${detailResult.succeeded}, server new: ${syncResult.gamesNew}`,
  };
}

export function shouldAutoRun(nowMs: number, minIntervalMs: number): boolean {
  const last = readLocalNumber(AUTO_KEY);
  if (!last) return true;
  return nowMs - last >= minIntervalMs;
}

export function markAutoRun(nowMs: number): void {
  writeLocalNumber(AUTO_KEY, nowMs);
}
