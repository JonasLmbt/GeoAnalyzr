import { createUIOverlay } from "../uiOverlay";
import { loadServerSyncSettings } from "../serverSync";
import { registerUiActions, refreshUI } from "./uiActions";
import { watchRoutes } from "./routing";

export async function bootApp(): Promise<void> {
  const ui = createUIOverlay();

  registerUiActions(ui);
  await refreshUI(ui);

  // Always keep a dashboard trigger available, even on /game routes.
  watchRoutes(() => {
    ui.setVisible(true);
  });

  // Sync build: auto-run fetch + sync on page reload.
  if (__GA_VARIANT__ === "sync") {
    window.setTimeout(() => {
      try {
        const key = "geoanalyzr_sync_autorun_v1";
        if (globalThis?.sessionStorage?.getItem(key) === "1") return;
        globalThis?.sessionStorage?.setItem(key, "1");

        const settings = loadServerSyncSettings();
        if (!settings.token) {
          ui.setStatus("Not linked. Click Fetch + Sync to link your device.");
          return;
        }
        void ui.runFetchAndSync?.({ auto: true, forceFull: false });
      } catch {
        // ignore
      }
    }, 2500);
  }
}
