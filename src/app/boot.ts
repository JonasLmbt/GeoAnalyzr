import { createUIOverlay } from "../uiOverlay";
import { loadServerSyncSettings } from "../serverSync";
import { syncV3FromDb2 } from "../serverSync_v3_db2";
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
          // All variants talk to the v3 endpoint now -- the previous
          // runServerSyncOnceWithOptions() call posted a gzip delta blob
          // that /api/v3/sync can't parse, so auto-sync silently uploaded
          // nothing for every user regardless of variant.
          const res = await syncV3FromDb2({ forceFull: false });

          if (res.ok) {
            const c = res.counts;
            const rowsTotal = (c?.duel_games ?? 0) + (c?.team_duel_games ?? 0) + (c?.standard_games ?? 0);
            ui.setStatus(`Auto-sync OK - games ${rowsTotal}`);
          } else {
            ui.setStatus(`Auto-sync failed: ${res.error ?? "unknown"}`);
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
