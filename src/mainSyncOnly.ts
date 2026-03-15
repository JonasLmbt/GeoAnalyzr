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
  if (/missing sync token/i.test(m)) return "Klicke auf den Button, um dein Gerät via Discord zu verknüpfen.";
  const http = m.match(/HTTP\\s+(\\d{3})/i);
  const status = http ? Number(http[1]) : NaN;
  if (status === 401 || status === 403) return "Token ungültig/abgelaufen. Klicke zum Neu-Verknüpfen und versuche es erneut.";
  if (status === 413) return "Zu viele Daten auf einmal. Versuche es später erneut (oder Shift+Klick für Full Sync).";
  if (status >= 500 && status < 600) return "Serverfehler. In ein paar Minuten erneut versuchen.";
  if (/timeout/i.test(m)) return "Timeout. Prüfe Verbindung/Adblocker und versuche es erneut.";
  return "Hover über den Button zeigt den letzten Status. Wenn es bleibt: neu laden, erneut klicken, ggf. neu verknüpfen.";
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
