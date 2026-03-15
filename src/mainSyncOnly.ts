import { loadServerSyncSettings } from "./serverSync";
import { createSyncMiniButton } from "./syncOnly/miniButton";
import { markAutoRun, runFetchAndSync, shouldAutoRun } from "./syncOnly/runFetchAndSync";

let running: Promise<void> | null = null;

function setTransientState(ui: ReturnType<typeof createSyncMiniButton>, state: "ok" | "error"): void {
  ui.setState(state);
  window.setTimeout(() => ui.setState("idle"), 2500);
}

function buildHintFromMessage(message: string): string | undefined {
  const m = typeof message === "string" ? message : "";
  if (/popup blocked/i.test(m)) return "Your browser blocked the linking tab. Allow popups for geoguessr.com and try again.";
  if (/missing sync token/i.test(m)) return "Click the button to link your device (Discord), then try again.";

  const http = m.match(/HTTP\\s+(\\d{3})/i);
  const status = http ? Number(http[1]) : NaN;
  if (status === 401 || status === 403) return "Token invalid/expired. Click to re-link your device, then retry.";
  if (status === 413) return "Too much data at once. Retry later (or Shift+Click for a full sync if needed).";
  if (status >= 500 && status < 600) return "Server error. Try again in a few minutes.";

  if (/link timeout/i.test(m)) return "Linking timed out. Keep the linking tab open and try again.";
  if (/timeout/i.test(m)) return "Request timed out. Check your connection/ad blockers and retry.";
  if (/gm_xmlhttprequest is not available/i.test(m))
    return "Your userscript manager is missing required permissions. Reinstall the script and ensure GM_xmlhttpRequest is granted.";

  return "Hover the button to see the last status. If it persists: reload, click again, and consider re-linking the device.";
}

async function runOnce(
  ui: ReturnType<typeof createSyncMiniButton>,
  opts: { forceFull: boolean; ensureLinked: boolean; showHints: boolean }
) {
  if (running) return running;
  running = (async () => {
    ui.setState("working");
    try {
      const res = await runFetchAndSync({
        forceFull: opts.forceFull,
        ensureLinked: opts.ensureLinked,
        setStatus: (m) => ui.setTitle(`GeoAnalyzr Sync - ${m}`)
      });
      ui.setTitle(`GeoAnalyzr Sync - ${res.message}`);
      if (res.ok) setTransientState(ui, "ok");
      else {
        const tokenMissing = /missing sync token/i.test(res.message);
        ui.setState(tokenMissing ? "needs_link" : "error");
        if (opts.showHints) {
          const hint = (res as any)?.hint ?? buildHintFromMessage(res.message);
          ui.showToast(hint ? `${res.message}\n${hint}` : res.message, tokenMissing ? "warn" : "error");
        }
      }
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : String(e || "Failed");
      ui.setTitle(`GeoAnalyzr Sync - ${msg}`);
      ui.setState("error");
      if (opts.showHints) {
        const hint = buildHintFromMessage(msg);
        ui.showToast(hint ? `${msg}\n${hint}` : msg, "error");
      }
    } finally {
      running = null;
    }
  })();
  return running;
}

const ui = createSyncMiniButton({
  onClick: async (ev) => {
    const forceFull = !!(ev && (ev as any).shiftKey);
    const settings = loadServerSyncSettings();
    const ensureLinked = !settings.token; // click can open linking tab when token missing
    await runOnce(ui, { forceFull, ensureLinked, showHints: true });
  }
});

// Auto-run once in a while (no popups). Only if a token exists already.
window.setTimeout(() => {
  try {
    const settings = loadServerSyncSettings();
    if (!settings.token) {
      ui.setState("needs_link");
      ui.setTitle("GeoAnalyzr Sync - Click to link device");
      return;
    }

    const now = Date.now();
    const intervalMs = 12 * 60 * 60 * 1000; // 12h
    if (!shouldAutoRun(now, intervalMs)) return;
    markAutoRun(now);
    void runOnce(ui, { forceFull: false, ensureLinked: false, showHints: false });
  } catch {
    // ignore
  }
}, 12_000);
