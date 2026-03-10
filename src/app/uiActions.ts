import { db } from "../db";
import { updateData } from "../sync";
import { normalizeLegacyRounds } from "../migrations/normalizeLegacyRounds";
import { backfillGuessCountries } from "../migrations/backfillGuessCountries";
import { invalidateRoundsCache } from "../engine/queryEngine";
import { exportExcel } from "../export";
import { initAnalysisWindow } from "../ui";
import { httpGetJson } from "../http";

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
  onOpenAnalysisClick: (handler: () => void | Promise<void>) => void;
  onDiscordClick: (handler: () => void | Promise<void>) => void;
};

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function ensureFetchDataHasRunOnce(): Promise<boolean> {
  const metaKey = "fetch_data_ran_v1";
  try {
    const meta = await db.meta.get(metaKey);
    const doneAt = (meta?.value as any)?.doneAt as number | undefined;
    if (typeof doneAt === "number" && Number.isFinite(doneAt) && doneAt > 0) return true;
  } catch {
    // ignore
  }

  // Backwards-compatible fallback: if there is already data in the DB, treat it as "Fetch data ran" and persist the flag.
  try {
    const [games, rounds, details] = await Promise.all([db.games.count(), db.rounds.count(), db.details.count()]);
    const hasAny = games > 0 || rounds > 0 || details > 0;
    if (!hasAny) return false;
    await db.meta.put({ key: metaKey, value: { doneAt: Date.now(), inferred: true }, updatedAt: Date.now() });
    return true;
  } catch {
    return false;
  }
}

function createThrottledStatus(setStatus: (message: string) => void): {
  push: (message: string) => void;
  flushNow: (message: string) => void;
  dispose: () => void;
} {
  let lastRenderAt = 0;
  let currentShownAt = 0;
  let currentMinHoldMs = 0;
  let pending: { message: string; throttleMs: number; minHoldMs: number; immediate: boolean } | null = null;
  let timer: number | null = null;

  const clearTimer = () => {
    if (timer === null) return;
    try {
      window.clearTimeout(timer);
    } catch {
      // ignore
    }
    timer = null;
  };

  const policyFor = (message: string) => {
    const m = String(message || "");
    const isDbUpdate =
      m.startsWith("Database update:") ||
      m.startsWith("Enriching existing details") ||
      m.startsWith("Normalizing legacy rounds");
    const isChattyProgress =
      m.startsWith("Feed page ") ||
      m.startsWith("Fetching feed page ") ||
      m.startsWith("Page ") ||
      m.startsWith("Details ") ||
      m.startsWith("Enrich |");
    const isFinal = m.startsWith("Update complete") || m.startsWith("Error:");

    if (isDbUpdate) return { throttleMs: 0, minHoldMs: 1800, immediate: true };
    if (isFinal) return { throttleMs: 0, minHoldMs: 0, immediate: true };
    if (isChattyProgress) return { throttleMs: 650, minHoldMs: 0, immediate: false };
    return { throttleMs: 200, minHoldMs: 0, immediate: false };
  };

  const flush = () => {
    clearTimer();
    if (!pending) return;

    const now = Date.now();
    const shownFor = now - currentShownAt;
    if (shownFor < currentMinHoldMs) {
      timer = window.setTimeout(flush, Math.max(50, currentMinHoldMs - shownFor));
      return;
    }

    setStatus(pending.message);
    lastRenderAt = now;
    currentShownAt = now;
    currentMinHoldMs = pending.minHoldMs;
    pending = null;
  };

  const scheduleFlush = (throttleMs: number) => {
    if (timer !== null) return;
    const now = Date.now();
    const sinceLast = now - lastRenderAt;
    const delay = Math.max(0, throttleMs - sinceLast);
    timer = window.setTimeout(flush, delay);
  };

  return {
    push(message: string) {
      const p = policyFor(message);
      pending = { message, ...p };

      const now = Date.now();
      const shownFor = now - currentShownAt;
      if (p.immediate && shownFor >= currentMinHoldMs) {
        clearTimer();
        setStatus(message);
        lastRenderAt = now;
        currentShownAt = now;
        currentMinHoldMs = p.minHoldMs;
        pending = null;
        return;
      }

      scheduleFlush(p.throttleMs);
    },
    flushNow(message: string) {
      clearTimer();
      pending = null;
      setStatus(message);
      lastRenderAt = Date.now();
      currentShownAt = lastRenderAt;
      currentMinHoldMs = 0;
    },
    dispose() {
      clearTimer();
      pending = null;
    }
  };
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
    const status = createThrottledStatus(ui.setStatus);
    try {
      status.flushNow("Update started...");

      // Verify we can fetch with the current browser session (no manual _ncfa paste required).
      // If the user is logged out, show a clear hint instead of failing deep inside the sync loop.
      try {
        status.push("Checking login/session...");
        const probe = await httpGetJson("https://www.geoguessr.com/api/v4/feed/private");
        if (probe.status === 401 || probe.status === 403) {
          status.flushNow("Error: Not authenticated. Please log in on geoguessr.com first.");
          alert(
            `GeoAnalyzr can't access your private feed (HTTP ${probe.status}).\n\n` +
              `Please make sure you're logged in on geoguessr.com, then try again.\n\n` +
              `If this persists in your setup, please report it in the Discord.`
          );
          return;
        }
      } catch {
        // Best-effort: continue, but avoid hard-failing here (network quirks / temporary errors).
      }

      const res = await updateData({
        onStatus: (m) => status.push(m),
        maxPages: 5000,
        delayMs: 200,
        detailConcurrency: 4,
        retryErrors: true,
        verifyCompleteness: true,
        enrichLimit: 2000
      });
      const norm = await normalizeLegacyRounds({ onStatus: (m) => status.push(m) });
      const backfilled = await backfillGuessCountries({ onStatus: (m) => status.push(m) });
      try {
        await db.meta.put({ key: "fetch_data_ran_v1", value: { doneAt: Date.now(), inferred: false }, updatedAt: Date.now() });
      } catch {
        // ignore
      }
      invalidateRoundsCache();
      status.flushNow(`Update complete. Feed upserted: ${res.feedUpserted}. Details ok: ${res.detailsOk}, fail: ${res.detailsFail}.`);
      if (norm.updated > 0 || backfilled.updated > 0) {
        status.flushNow(
          `Update complete. Feed upserted: ${res.feedUpserted}. Normalized legacy rounds: ${norm.updated}. Backfilled guessCountry: ${backfilled.updated}.`
        );
      }
      await refreshUI(ui);
    } catch (e) {
      status.flushNow("Error: " + errorText(e));
      console.error(e);
    } finally {
      status.dispose();
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

  ui.onOpenAnalysisClick(async () => {
    let semanticStatus = "";
    try {
      const ok = await ensureFetchDataHasRunOnce();
      if (!ok) {
        ui.setStatus("Please run Fetch data first.");
        try {
          const [games, rounds] = await Promise.all([db.games.count(), db.rounds.count()]);
          alert(
            `GeoAnalyzr has no local data yet (${games} games, ${rounds} rounds).\n\n` +
              `Please click "Update data" (Fetch data) in the GeoAnalyzr panel first.\n` +
              `After it finishes, open the dashboard again.`
          );
        } catch {
          alert(
            `GeoAnalyzr has no local data yet.\n\n` +
              `Please click "Update data" (Fetch data) in the GeoAnalyzr panel first.\n` +
              `After it finishes, open the dashboard again.`
          );
        }
        return;
      }

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
