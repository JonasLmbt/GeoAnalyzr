import { createUIOverlay } from "../uiOverlay";
import { loadServerSyncSettings, runServerSyncOnceWithOptions } from "../serverSync";
import { loadFetchGameFilter } from "../fetchGameFilter";
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

  // Auto-fetch latest rounds on full page reload. If linked, auto-sync as well.
  window.setTimeout(() => {
    try {
      const g: any = globalThis as any;
      const onceKey = "__ga_autofetch_and_sync_v1";
      if (g[onceKey]) return;
      g[onceKey] = 1;

      void (async () => {
        try {
          await ui.runFetch?.({ auto: true });
        } catch {
          // ignore
        }

        try {
          const settings = loadServerSyncSettings();
          if (!settings.token) return; // not linked => do not sync

          ui.setStatus("Auto-syncing...");
          const isSyncVariant = __GA_VARIANT__ === "sync";
          const f = isSyncVariant ? loadFetchGameFilter() : null;
          const res = await runServerSyncOnceWithOptions(
            settings,
            isSyncVariant
              ? {
                  forceFull: false,
                  filterModeFamily: f?.modeFamily,
                  filterMovementAnyOf: f?.movementAnyOf,
                  filterRated: f?.rated,
                  filterFromMs: f?.fromMs,
                  filterToMs: f?.toMs
                }
              : { forceFull: false }
          );

          if (res.ok) {
            const rowsTotal = res.counts.games + res.counts.rounds + res.counts.details + res.counts.gameAgg;
            ui.setStatus(`Auto-sync OK - rows ${rowsTotal} - ${Math.round(res.bytesGzip / 1024)} KB (gz)`);
          } else {
            ui.setStatus(`Auto-sync failed (HTTP ${res.status})`);
          }
        } catch {
          // ignore (never block the UI on auto-run)
        }
      })();
    } catch {
      // ignore
    }
  }, 2500);
}
