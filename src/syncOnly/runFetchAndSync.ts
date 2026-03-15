import { updateData } from "../sync";
import { loadServerSyncSettings, runServerSyncOnceWithOptions } from "../serverSync";
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
  opts.setStatus("Fetching feed + details...");
  await updateData({
    onStatus: (m) => opts.setStatus(m),
    maxPages: 5000,
    delayMs: 150,
    detailConcurrency: 4,
    verifyCompleteness: true,
    retryErrors: true,
    enrichLimit: 1500
  });

  let settings = loadServerSyncSettings();
  if (!settings.token) {
    if (!opts.ensureLinked) {
      return { ok: false, message: "Missing sync token. Click to link device.", hint: "Click the button to link your device (Discord), then try again." };
    }
    opts.setStatus("Linking device...");
    await linkDeviceViaDiscord();
    settings = loadServerSyncSettings();
  }
  if (!settings.token) return { ok: false, message: "Missing sync token. Link failed.", hint: "Try linking again. If it keeps failing, disable popup blockers and retry." };

  opts.setStatus(opts.forceFull ? "Syncing full snapshot..." : "Syncing...");
  const res = await runServerSyncOnceWithOptions(settings, { forceFull: opts.forceFull });
  const rowsTotal = res.counts.games + res.counts.rounds + res.counts.details + res.counts.gameAgg;
  const modeLabel = opts.forceFull ? "Synced full" : "Synced";
  return res.ok
    ? { ok: true, message: `${modeLabel} - rows ${rowsTotal} - ${Math.round(res.bytesGzip / 1024)} KB` }
    : (() => {
        const base = `Sync failed (HTTP ${res.status})`;
        if (res.status === 401 || res.status === 403) {
          return { ok: false, message: base, hint: "Token invalid/expired. Click to re-link your device, then retry." };
        }
        if (res.status === 413) {
          return { ok: false, message: base, hint: "Payload too large. Retry later; if it persists, re-link and try a full sync (Shift+Click)." };
        }
        if (res.status >= 500) {
          return { ok: false, message: base, hint: "Server error. Retry in a few minutes." };
        }
        return { ok: false, message: base };
      })();
}

export function shouldAutoRun(nowMs: number, minIntervalMs: number): boolean {
  const last = readLocalNumber(AUTO_KEY);
  if (!last) return true;
  return nowMs - last >= minIntervalMs;
}

export function markAutoRun(nowMs: number): void {
  writeLocalNumber(AUTO_KEY, nowMs);
}
