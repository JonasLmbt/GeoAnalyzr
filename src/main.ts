import { createUI } from "./ui";
import { db } from "./db";
import { syncFeed } from "./sync";
import { fetchMissingDuelsDetails } from "./details";
import { getAnalysisWindowData } from "./analysis";
import { exportExcel } from "./export";
import { getNcfaToken, setNcfaToken } from "./auth";

const NCFA_HELP_TEXT =
  "NCFA token setup:\n\n" +
  "1) Open geoguessr.com and log in.\n" +
  "2) Open browser DevTools (F12 / Ctrl+Shift+I).\n" +
  "3) Go to Network tab.\n" +
  "4) Reload the page.\n" +
  "5) Use filter and search for 'stats'.\n" +
  "6) Open a 'stats' request.\n" +
  "7) In request headers, find the '_ncfa' cookie.\n" +
  "8) Copy only the value after '=' up to ';' (without ';').";

function isInGame(): boolean {
  const p = location.pathname;
  return (
    p.startsWith("/game/") ||
    p.startsWith("/challenge/") ||
    p.startsWith("/duels/") ||
    p.startsWith("/team-duels/") ||
    p.startsWith("/battle-royale/") ||
    p.startsWith("/live-challenge/")
  );
}

function watchRoutes(onRoute: () => void) {
  const origPush = history.pushState;
  const origReplace = history.replaceState;

  history.pushState = function () {
    origPush.apply(this, arguments as any);
    onRoute();
  };

  history.replaceState = function () {
    origReplace.apply(this, arguments as any);
    onRoute();
  };

  window.addEventListener("popstate", onRoute);
  setInterval(onRoute, 500);
  onRoute();
}

async function refreshUI(ui: ReturnType<typeof createUI>) {
  const [games, rounds, detailsOk, detailsError, detailsMissing] = await Promise.all([
    db.games.count(),
    db.rounds.count(),
    db.details.where("status").equals("ok").count(),
    db.details.where("status").equals("error").count(),
    db.details.where("status").equals("missing").count()
  ]);
  ui.setCounts({ games, rounds, detailsOk, detailsError, detailsMissing });
}

(async function boot() {
  const ui = createUI();

  ui.onUpdateClick(async () => {
    try {
      ui.setStatus("Update started...");
      let ncfa = await getNcfaToken();
      if (!ncfa) {
        const wantsSet = confirm("No NCFA token found. Set it now for more complete fetching?");
        if (wantsSet) {
          const entered = prompt(`Paste _ncfa token here.\n\n${NCFA_HELP_TEXT}`, "");
          if (entered !== null) {
            await setNcfaToken(entered);
            ncfa = await getNcfaToken();
            ui.setStatus(ncfa ? "NCFA token saved. Continuing update..." : "No token saved. Continuing without NCFA...");
          }
        }
      }
      const res = await syncFeed({
        onStatus: (m) => ui.setStatus(m),
        maxPages: 200,
        delayMs: 200,
        ncfa
      });
      await fetchMissingDuelsDetails({
        onStatus: (m) => ui.setStatus(m),
        concurrency: 4,
        retryErrors: true,
        verifyCompleteness: true,
        ncfa
      });
      ui.setStatus(`Update complete. New feed games: ${res.inserted}.`);
      await refreshUI(ui);
    } catch (e) {
      ui.setStatus("Error: " + (e instanceof Error ? e.message : String(e)));
      console.error(e);
    }
  });

  ui.onResetClick(async () => {
    if (!confirm("Reset database? This will permanently delete all local analyzer data.")) return;
    try {
      ui.setStatus("Resetting DB...");
      await db.transaction("rw", db.games, db.rounds, db.details, db.meta, async () => {
        await Promise.all([
          db.games.clear(),
          db.rounds.clear(),
          db.details.clear(),
          db.meta.clear()
        ]);
      });
      ui.setStatus("DB reset complete.");
      await refreshUI(ui);
    } catch (e) {
      ui.setStatus("Error: " + (e instanceof Error ? e.message : String(e)));
      console.error(e);
    }
  });

  ui.onExportClick(async () => {
    try {
      await exportExcel((m) => ui.setStatus(m));
    } catch (e) {
      ui.setStatus("Error: " + (e instanceof Error ? e.message : String(e)));
      console.error(e);
    }
  });

  ui.onTokenClick(async () => {
    try {
      const existing = await getNcfaToken();
      const msg = existing
        ? "NCFA Token setzen/aktualisieren. Leer lassen zum Loeschen."
        : "NCFA Token setzen (optional).";
      const next = prompt(msg, existing || "");
      if (next === null) return;
      await setNcfaToken(next);
      const now = await getNcfaToken();
      ui.setStatus(now ? "NCFA token gespeichert." : "NCFA token entfernt.");
    } catch (e) {
      ui.setStatus("Error: " + (e instanceof Error ? e.message : String(e)));
      console.error(e);
    }
  });

  async function refreshAnalysisWindow(filter?: { fromTs?: number; toTs?: number; mode?: string; teammateId?: string; country?: string }) {
    const data = await getAnalysisWindowData(filter);
    ui.setAnalysisWindowData(data);
  }

  ui.onOpenAnalysisClick(async () => {
    try {
      ui.setStatus("Loading analysis...");
      await refreshAnalysisWindow({ mode: "all", teammateId: "all", country: "all" });
      ui.setStatus("Analysis loaded.");
    } catch (e) {
      ui.setStatus("Error: " + (e instanceof Error ? e.message : String(e)));
      console.error(e);
    }
  });

  ui.onRefreshAnalysisClick(async (filter) => {
    try {
      ui.setStatus("Refreshing analysis...");
      await refreshAnalysisWindow(filter);
      ui.setStatus("Analysis refreshed.");
    } catch (e) {
      ui.setStatus("Error: " + (e instanceof Error ? e.message : String(e)));
      console.error(e);
    }
  });


  await refreshUI(ui);

  watchRoutes(() => {
    ui.setVisible(!isInGame());
  });
})();
