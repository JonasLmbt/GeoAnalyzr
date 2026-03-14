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
}): Promise<{ ok: boolean; message: string }> {
  opts.setStatus("Fetching feed + details…");
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
      return { ok: false, message: "Missing sync token. Click to link device." };
    }
    opts.setStatus("Linking device…");
    await linkDeviceViaDiscord();
    settings = loadServerSyncSettings();
  }
  if (!settings.token) return { ok: false, message: "Missing sync token. Link failed." };

  opts.setStatus(opts.forceFull ? "Syncing full snapshot…" : "Syncing…");
  const res = await runServerSyncOnceWithOptions(settings, { forceFull: opts.forceFull });
  const rowsTotal = res.counts.games + res.counts.rounds + res.counts.details + res.counts.gameAgg;
  const modeLabel = opts.forceFull ? "Synced full" : "Synced";
  return res.ok
    ? { ok: true, message: `${modeLabel} · rows ${rowsTotal} · ${Math.round(res.bytesGzip / 1024)} KB` }
    : { ok: false, message: `Sync failed (HTTP ${res.status})` };
}

export function shouldAutoRun(nowMs: number, minIntervalMs: number): boolean {
  const last = readLocalNumber(AUTO_KEY);
  if (!last) return true;
  return nowMs - last >= minIntervalMs;
}

export function markAutoRun(nowMs: number): void {
  writeLocalNumber(AUTO_KEY, nowMs);
}

