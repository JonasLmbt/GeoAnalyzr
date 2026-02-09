import { createUI } from "./ui";
import { db } from "./db";
import { syncFeed } from "./sync";
import { fetchMissingDuelsDetails } from "./details";
import { getAnalysisWindowData } from "./analysis";
import { exportExcel } from "./export";
import { getNcfaToken, getResolvedNcfaToken, setNcfaToken, validateNcfaToken } from "./auth";

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

async function hasAuthenticatedSession(): Promise<boolean> {
  try {
    const res = await fetch("https://www.geoguessr.com/api/v4/feed/private", { credentials: "include" });
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}

(async function boot() {
  const ui = createUI();

  ui.onUpdateClick(async () => {
    try {
      ui.setStatus("Update started...");
      let resolved = await getResolvedNcfaToken();
      let ncfa = resolved.token;
      if (!ncfa) {
        const wantsSet = confirm("No NCFA token found. Set it now for more complete fetching?");
        if (wantsSet) {
          const entered = prompt(`Paste _ncfa token here.\n\n${NCFA_HELP_TEXT}`, "");
          if (entered !== null) {
            const clean = entered.trim();
            if (clean) {
              const check = await validateNcfaToken(clean);
              if (check.ok) {
                await setNcfaToken(clean);
                resolved = await getResolvedNcfaToken();
                ncfa = resolved.token;
                ui.setStatus(`NCFA token saved and validated (HTTP ${check.status ?? "ok"}). Continuing update...`);
              } else {
                ui.setStatus(`NCFA token not saved: ${check.reason} Continuing without NCFA...`);
              }
            } else {
              await setNcfaToken("");
              ui.setStatus("No token saved. Continuing without NCFA...");
            }
          }
        }
      } else if (resolved.source === "cookie") {
        ui.setStatus("Using NCFA token from browser cookie. Continuing update...");
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
    const existing = await getNcfaToken();
    ui.openNcfaManager({
      initialToken: existing || "",
      helpText: NCFA_HELP_TEXT,
      repoUrl: "https://github.com/JonasLmbt/GeoAnalyzr#getting-your-_ncfa-cookie",
      onSave: async (token) => {
        const clean = token.trim();
        if (!clean) {
          await setNcfaToken("");
          const message = "NCFA token removed.";
          ui.setStatus(message);
          return { saved: false, token: "", message };
        }
        const check = await validateNcfaToken(clean);
        if (!check.ok) {
          const message = `Token validation failed: ${check.reason}`;
          ui.setStatus(message);
          return { saved: false, token: clean, message };
        }
        await setNcfaToken(clean);
        const now = await getNcfaToken();
        const message = `NCFA token saved and validated (HTTP ${check.status ?? "ok"}).`;
        ui.setStatus(message);
        return { saved: !!now, token: now, message };
      },
      onAutoDetect: async () => {
        const resolved = await getResolvedNcfaToken();
        if (resolved.token) {
          const check = await validateNcfaToken(resolved.token);
          if (check.ok) {
            await setNcfaToken(resolved.token);
            const message = `Auto-detect successful (${resolved.source}). Token validated and saved.`;
            ui.setStatus(message);
            return { detected: true, token: resolved.token, source: resolved.source, message };
          }
          const message = `Auto-detected token failed validation (${resolved.source}): ${check.reason}`;
          ui.setStatus(message);
          return { detected: false, token: resolved.token, source: resolved.source, message };
        }
        const sessionOk = await hasAuthenticatedSession();
        if (sessionOk) {
          const message =
            "No readable _ncfa token found. Session auth works, likely because _ncfa is HttpOnly. You can keep manual token if needed for cross-domain endpoints.";
          ui.setStatus(message);
          return { detected: true, source: "session", message };
        }
        const message = "Auto-detect failed: no stored token, no readable cookie, and no authenticated session detected.";
        ui.setStatus(message);
        return { detected: false, source: "none", message };
      }
    });
  });

  async function refreshAnalysisWindow(filter?: {
    fromTs?: number;
    toTs?: number;
    gameMode?: string;
    movementType?: "all" | "moving" | "no_move" | "nmpz" | "unknown";
    teammateId?: string;
    country?: string;
  }) {
    const data = await getAnalysisWindowData(filter);
    ui.setAnalysisWindowData(data);
  }

  ui.onOpenAnalysisClick(async () => {
    try {
      ui.setStatus("Loading analysis...");
      await refreshAnalysisWindow({ gameMode: "all", movementType: "all", teammateId: "all", country: "all" });
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
