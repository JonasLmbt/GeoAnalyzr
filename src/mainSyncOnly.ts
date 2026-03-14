import { loadServerSyncSettings } from "./serverSync";
import { createSyncMiniButton } from "./syncOnly/miniButton";
import { markAutoRun, runFetchAndSync, shouldAutoRun } from "./syncOnly/runFetchAndSync";

let running: Promise<void> | null = null;

function setTransientState(ui: ReturnType<typeof createSyncMiniButton>, state: "ok" | "error"): void {
  ui.setState(state);
  window.setTimeout(() => ui.setState("idle"), 2500);
}

async function runOnce(ui: ReturnType<typeof createSyncMiniButton>, opts: { forceFull: boolean; ensureLinked: boolean }) {
  if (running) return running;
  running = (async () => {
    ui.setState("working");
    try {
      const res = await runFetchAndSync({
        forceFull: opts.forceFull,
        ensureLinked: opts.ensureLinked,
        setStatus: (m) => ui.setTitle(`GeoAnalyzr Sync · ${m}`)
      });
      ui.setTitle(`GeoAnalyzr Sync · ${res.message}`);
      if (res.ok) setTransientState(ui, "ok");
      else {
        const tokenMissing = /missing sync token/i.test(res.message);
        ui.setState(tokenMissing ? "needs_link" : "error");
      }
    } catch (e: any) {
      ui.setTitle(`GeoAnalyzr Sync · ${e instanceof Error ? e.message : String(e || "Failed")}`);
      ui.setState("error");
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
    await runOnce(ui, { forceFull, ensureLinked });
  }
});

// Auto-run once in a while (no popups). Only if a token exists already.
window.setTimeout(() => {
  try {
    const settings = loadServerSyncSettings();
    if (!settings.token) {
      ui.setState("needs_link");
      ui.setTitle("GeoAnalyzr Sync · Click to link device");
      return;
    }

    const now = Date.now();
    const intervalMs = 12 * 60 * 60 * 1000; // 12h
    if (!shouldAutoRun(now, intervalMs)) return;
    markAutoRun(now);
    void runOnce(ui, { forceFull: false, ensureLinked: false });
  } catch {
    // ignore
  }
}, 12_000);

