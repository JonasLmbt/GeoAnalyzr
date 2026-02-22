import { db } from "../db";
import { syncFeed } from "../sync";
import { fetchMissingDuelsDetails } from "../details";
import { normalizeLegacyRounds } from "../migrations/normalizeLegacyRounds";
import { invalidateRoundsCache } from "../engine/queryEngine";
import { exportExcel } from "../export";
import { initAnalysisWindow } from "../ui";
import { getNcfaToken, getResolvedNcfaToken, setNcfaToken, validateNcfaToken } from "../auth";
import { hasAuthenticatedSession } from "./session";

type DashboardFilter = {
  fromTs?: number;
  toTs?: number;
  gameMode?: string;
  movementType?: "all" | "moving" | "no_move" | "nmpz" | "unknown";
  teammateId?: string;
  country?: string;
};

type UI = {
  setStatus: (message: string) => void;
  setCounts: (counts: {
    games: number;
    rounds: number;
    detailsOk: number;
    detailsError: number;
    detailsMissing: number;
  }) => void;
  onUpdateClick: (handler: () => void | Promise<void>) => void;
  onResetClick: (handler: () => void | Promise<void>) => void;
  onExportClick: (handler: () => void | Promise<void>) => void;
  onTokenClick: (handler: () => void | Promise<void>) => void;
  onOpenAnalysisClick: (handler: () => void | Promise<void>) => void;
  onDiscordClick: (handler: () => void | Promise<void>) => void;
  openNcfaManager: (args: {
    initialToken: string;
    helpText: string;
    repoUrl: string;
    onSave: (token: string) => Promise<{ saved: boolean; token: string; message: string }>;
    onAutoDetect: () => Promise<{ detected: boolean; token?: string; source: string; message: string }>;
  }) => void;
};

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function refreshUI(ui: UI): Promise<void> {
  const [games, rounds, detailsOk, detailsError, detailsMissing] = await Promise.all([
    db.games.count(),
    db.rounds.count(),
    db.details.where("status").equals("ok").count(),
    db.details.where("status").equals("error").count(),
    db.details.where("status").equals("missing").count()
  ]);
  ui.setCounts({ games, rounds, detailsOk, detailsError, detailsMissing });
}

export function registerUiActions(ui: UI): void {
  ui.onUpdateClick(async () => {
    try {
      ui.setStatus("Update started...");
      let resolved = await getResolvedNcfaToken();
      let ncfa = resolved.token;
      if (!ncfa) {
        const wantsSet = confirm("No NCFA token found. Set it now for more complete fetching?");
        if (wantsSet) {
          const entered = prompt("Paste _ncfa token here.", "");
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
        maxPages: 5000,
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
      const norm = await normalizeLegacyRounds({ onStatus: (m) => ui.setStatus(m) });
      invalidateRoundsCache();
      ui.setStatus(`Update complete. New feed games: ${res.inserted}.`);
      if (norm.updated > 0) ui.setStatus(`Update complete. New feed games: ${res.inserted}. Normalized legacy rounds: ${norm.updated}.`);
      await refreshUI(ui);
    } catch (e) {
      ui.setStatus("Error: " + errorText(e));
      console.error(e);
    }
  });

  ui.onResetClick(async () => {
    if (!confirm("Reset database? This will permanently delete all local analyzer data.")) return;
    try {
      ui.setStatus("Resetting DB...");
      await db.transaction("rw", db.games, db.rounds, db.details, db.meta, async () => {
        await Promise.all([db.games.clear(), db.rounds.clear(), db.details.clear(), db.meta.clear()]);
      });
      invalidateRoundsCache();
      ui.setStatus("DB reset complete.");
      await refreshUI(ui);
    } catch (e) {
      ui.setStatus("Error: " + errorText(e));
      console.error(e);
    }
  });

  ui.onExportClick(async () => {
    try {
      await exportExcel((m) => ui.setStatus(m));
    } catch (e) {
      ui.setStatus("Error: " + errorText(e));
      console.error(e);
    }
  });

  ui.onTokenClick(async () => {
    const existing = await getNcfaToken();
    ui.openNcfaManager({
      initialToken: existing || "",
      helpText: "",
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

  ui.onOpenAnalysisClick(async () => {
    let semanticStatus = "";
    try {
      ui.setStatus("Opening dashboard...");
      const semanticTab = window.open("about:blank", "_blank");
      if (!semanticTab) {
        semanticStatus = " Semantic dashboard popup was blocked.";
      } else {
        try {
          await initAnalysisWindow({ targetWindow: semanticTab });
        } catch (semanticError) {
          const msg = errorText(semanticError);
          semanticStatus = ` Semantic dashboard failed to render: ${msg}`;
          ui.setStatus(`Dashboard error: ${msg}`);
          console.error("Failed to initialize semantic dashboard tab", semanticError);
        }
      }
      ui.setStatus(`Dashboard opened.${semanticStatus}`);
    } catch (e) {
      ui.setStatus("Error: " + errorText(e));
      console.error(e);
    }
  });

  ui.onDiscordClick(() => {
    const url = "https://discord.gg/8RA3VtSC";
    const w = window.open(url, "_blank", "noopener,noreferrer");
    if (w) w.opener = null;
  });
}
