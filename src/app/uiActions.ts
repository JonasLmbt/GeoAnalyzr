import { db, isViewerMode, MAIN_DB_NAME, getActiveDbName } from "../db";
import { updateData } from "../sync";
import { normalizeLegacyRounds } from "../migrations/normalizeLegacyRounds";
import { backfillGuessCountries } from "../migrations/backfillGuessCountries";
import { invalidateRoundsCache } from "../engine/queryEngine";
import { initAnalysisWindow } from "../ui";
import { httpGetJson } from "../http";
import { loadFetchGameFilter } from "../fetchGameFilter";
import type { FetchLogDoc, FetchLogEvent } from "../fetchLog";
import { safeError } from "../fetchLog";

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
  onUpdateClick: (handler: (ev: MouseEvent) => void | Promise<void>) => void;
  onResetClick: (handler: () => void | Promise<void>) => void;
  onOpenAnalysisClick: (handler: () => void | Promise<void>) => void;
};

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function downloadJson(filename: string, value: unknown): void {
  // Note: downloads triggered after long async work often lose the browser "user gesture" and may be blocked.
  // We try GM_download first (userscript environments), then fall back to an <a download> click.
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const anchorDownload = () => {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    (document.body ?? document.documentElement).appendChild(a);
    a.click();
    a.remove();
  };

  const gmDownload = () => {
    const gm = (globalThis as any)?.GM_download;
    if (typeof gm !== "function") return false;
    try {
      gm({
        url,
        name: filename,
        saveAs: false,
        onerror: () => {
          try {
            anchorDownload();
          } catch {
            // ignore
          }
        }
      });
      return true;
    } catch {
      return false;
    }
  };

  const gmOk = gmDownload();
  if (!gmOk) {
    try {
      anchorDownload();
    } catch (e) {
      // Last resort: open the blob URL so the user can save manually.
      try {
        const ok = confirm(
          `Fetch log is ready, but your browser blocked the automatic download.\n\nOpen it in a new tab instead?`
        );
        if (ok) window.open(url, "_blank");
      } catch {
        // ignore
      }
      console.error("Failed to trigger JSON download", e);
    }
  }

  setTimeout(() => URL.revokeObjectURL(url), 30_000);
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
  ui.onUpdateClick(async (ev) => {
    if (isViewerMode()) {
      const name = getActiveDbName();
      ui.setStatus("Viewer mode: updates are disabled.");
      alert(
        `GeoAnalyzr is currently in Viewer mode (${name}).\n\n` +
          `Fetching/updating data is disabled to avoid mixing datasets.\n\n` +
          `Go to Settings → Data and click "Switch to my data" (${MAIN_DB_NAME}) to resume syncing.`
      );
      return;
    }
    const status = createThrottledStatus(ui.setStatus);
    const wantLog = Boolean((ev as any)?.shiftKey);
    const fetchLog: FetchLogDoc | null = wantLog
      ? {
          schemaVersion: 1,
          phase: "fetch",
          startedAt: Date.now(),
          pageUrl: typeof location !== "undefined" ? String(location.href || "") : "",
          userAgent: typeof navigator !== "undefined" ? String(navigator.userAgent || "") : "",
          events: []
        }
      : null;
    let droppedLogEvents = 0;

    const appendLogEvent = (x: FetchLogEvent) => {
      if (!fetchLog) return;
      if (fetchLog.events.length > 250_000) {
        droppedLogEvents++;
        return;
      }
      fetchLog.events.push(x);
    };

    const pushLog = (kind: string, data?: any, level: "info" | "warn" | "error" = "info", msg?: string) => {
      const x: FetchLogEvent = { ts: Date.now(), kind };
      if (level && level !== "info") x.level = level;
      if (msg) x.msg = msg;
      if (data !== undefined) x.data = data;
      appendLogEvent(x);
    };

    const onStatus = (m: string) => {
      status.push(m);
      pushLog("status", undefined, "info", m);
    };

    const onStatusNow = (m: string) => {
      status.flushNow(m);
      pushLog("status_now", undefined, "info", m);
    };
    try {
      onStatusNow("Update started...");
      if (wantLog) onStatus("Fetch log enabled (Shift+Click). JSON will download after completion.");

      // Verify we can fetch with the current browser session (no manual _ncfa paste required).
      // If the user is logged out, show a clear hint instead of failing deep inside the sync loop.
      try {
        onStatus("Checking login/session...");
        const probe = await httpGetJson("https://www.geoguessr.com/api/v4/feed/private");
        pushLog("http_probe_feed", { url: "https://www.geoguessr.com/api/v4/feed/private", status: probe.status });
        if (probe.status === 401 || probe.status === 403) {
          onStatusNow("Error: Not authenticated. Please log in on geoguessr.com first.");
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
        onStatus: (m) => onStatus(m),
        onLog: fetchLog ? (x) => appendLogEvent(x) : undefined,
        maxPages: 5000,
        delayMs: 200,
        detailConcurrency: 4,
        retryErrors: true,
        verifyCompleteness: true,
        enrichLimit: 2000,
        gameFilter: loadFetchGameFilter()
      });
      const norm = await normalizeLegacyRounds({ onStatus: (m) => onStatus(m) });
      const backfilled = await backfillGuessCountries({ onStatus: (m) => onStatus(m) });
      try {
        await db.meta.put({ key: "fetch_data_ran_v1", value: { doneAt: Date.now(), inferred: false }, updatedAt: Date.now() });
      } catch {
        // ignore
      }
      invalidateRoundsCache();
      onStatusNow(`Update complete. Feed upserted: ${res.feedUpserted}. Details ok: ${res.detailsOk}, fail: ${res.detailsFail}.`);
      if (norm.updated > 0 || backfilled.updated > 0) {
        onStatusNow(
          `Update complete. Feed upserted: ${res.feedUpserted}. Normalized legacy rounds: ${norm.updated}. Backfilled guessCountry: ${backfilled.updated}.`
        );
      }
      if (fetchLog) fetchLog.summary = { updateData: res, normalizeLegacyRounds: norm, backfillGuessCountries: backfilled };
      await refreshUI(ui);
    } catch (e) {
      const se = safeError(e);
      const feedHttp = /^Feed HTTP (\d{3})\b/.exec(se.message || "");
      if (feedHttp) {
        const code = Number(feedHttp[1]) || 0;
        const hint =
          code === 401 || code === 403
            ? "You are likely logged out, blocked by a privacy/adblock setting, or GeoGuessr denied access for this session."
            : "GeoGuessr returned an unexpected response for your private feed.";
        onStatusNow(`Error: Feed HTTP ${code}. ${hint}`);
        try {
          alert(
            `GeoAnalyzr can't access your private feed (HTTP ${code}).\n\n` +
              `Common causes:\n` +
              `- Not logged in / expired session\n` +
              `- Tracking protection / adblocker blocking cookies or requests\n` +
              `- Temporary GeoGuessr / Cloudflare restriction\n\n` +
              `Try: reload geoguessr.com, ensure you're logged in, disable blockers for geoguessr.com, then retry.\n` +
              `Tip: Shift+Fetch downloads a JSON log you can share for debugging.`
          );
        } catch {
          // ignore
        }
      } else {
        onStatusNow("Error: " + se.message);
      }
      pushLog("handler_error", se, "error");
      console.error(e);
    } finally {
      status.dispose();
      if (fetchLog) {
        fetchLog.endedAt = Date.now();
        fetchLog.summary = {
          ...(fetchLog.summary || {}),
          droppedLogEvents: droppedLogEvents > 0 ? droppedLogEvents : 0
        };
        const stamp = new Date(fetchLog.startedAt).toISOString().replace(/[:.]/g, "-");
        try {
          onStatusNow("Downloading fetch log (JSON)...");
        } catch {
          // ignore
        }
        try {
          downloadJson(`geoanalyzr_fetch_log_${stamp}.json`, fetchLog);
        } catch (downloadErr) {
          console.error("Failed to download fetch log JSON", downloadErr);
          try {
            alert(`Failed to download fetch log JSON: ${errorText(downloadErr)}`);
          } catch {
            // ignore
          }
        }
      }
    }
  });

  ui.onResetClick(async () => {
    if (
      !confirm(
        "WARNING:\n" +
          "- This permanently deletes ALL GeoAnalyzr data stored locally in this browser.\n" +
          "- This does NOT delete any data on the server.\n\n" +
          "Reset local database?"
      )
    )
      return;
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

}
