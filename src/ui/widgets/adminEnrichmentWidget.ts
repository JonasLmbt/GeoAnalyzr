import type { SemanticRegistry } from "../../config/semantic.types";
import type { WidgetDef } from "../../config/dashboard.types";
import { db } from "../../db";
import { analysisConsole } from "../consoleStore";
import { invalidateAdminEnrichmentEnabledCache, maybeEnrichRoundRowsForDimension } from "../../engine/regionEnrichment";
import { invalidateRoundsCache } from "../../engine/queryEngine";

type EnrichPlan = {
  countryIso2: string;
  label: string;
  levels: { id: string; label: string; dimIds: string[] }[];
};

function asIso2(v: unknown): string {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return /^[a-z]{2}$/.test(s) ? s : "";
}

export function getAdminEnrichmentPlan(countryIso2: string): EnrichPlan | null {
  const iso2 = asIso2(countryIso2);
  if (!iso2) return null;
  if (iso2 === "de")
    return {
      countryIso2: iso2,
      label: "Germany (Bundesländer + Landkreise)",
      levels: [
        { id: "adm1", label: "States (ADM1)", dimIds: ["true_state", "guess_state"] },
        { id: "adm2", label: "Districts (ADM2)", dimIds: ["true_district", "guess_district"] }
      ]
    };
  if (iso2 === "us")
    return {
      countryIso2: iso2,
      label: "United States (States)",
      levels: [{ id: "adm1", label: "States (ADM1)", dimIds: ["true_us_state", "guess_us_state"] }]
    };
  if (iso2 === "ca")
    return {
      countryIso2: iso2,
      label: "Canada (Provinces)",
      levels: [{ id: "adm1", label: "Provinces (ADM1)", dimIds: ["true_ca_province", "guess_ca_province"] }]
    };
  if (iso2 === "id")
    return {
      countryIso2: iso2,
      label: "Indonesia (Provinces + Kabupaten)",
      levels: [
        { id: "adm1", label: "Provinces (ADM1)", dimIds: ["true_id_province", "guess_id_province"] },
        { id: "adm2", label: "Kabupaten (ADM2)", dimIds: ["true_id_kabupaten", "guess_id_kabupaten"] }
      ]
    };
  if (iso2 === "ph")
    return {
      countryIso2: iso2,
      label: "Philippines (Provinces)",
      levels: [{ id: "adm1", label: "Provinces (ADM1)", dimIds: ["true_ph_province", "guess_ph_province"] }]
    };
  if (iso2 === "vn")
    return {
      countryIso2: iso2,
      label: "Vietnam (Provinces)",
      levels: [{ id: "adm1", label: "Provinces (ADM1)", dimIds: ["true_vn_province", "guess_vn_province"] }]
    };
  return null;
}

function metaKeyForCountry(iso2: string): string {
  return `admin_enrichment_enabled_${iso2.toLowerCase()}`;
}

export async function runAdminEnrichment(
  countryIso2: string,
  opts?: {
    levelId?: string;
    onStatus?: (msg: string) => void;
    onPct?: (pct: number) => void;
  }
): Promise<void> {
  const iso2 = asIso2(countryIso2);
  if (!iso2) throw new Error("Missing country ISO2 for admin enrichment");
  const plan = getAdminEnrichmentPlan(iso2);
  if (!plan) throw new Error(`No admin-level dataset configured for '${iso2.toUpperCase()}' yet.`);

  const set = (pct: number, msg: string) => {
    opts?.onPct?.(pct);
    opts?.onStatus?.(msg);
  };

  const wantedLevelId = typeof opts?.levelId === "string" && opts.levelId.trim() ? opts.levelId.trim() : "all";
  const levels =
    wantedLevelId === "all" ? plan.levels : plan.levels.filter((l) => l.id === wantedLevelId || l.label === wantedLevelId);
  if (!levels.length) throw new Error(`Unknown admin level '${wantedLevelId}' for ${iso2.toUpperCase()}.`);
  const dimIds = Array.from(new Set(levels.flatMap((l) => l.dimIds)));

  const existing = await db.meta.get(metaKeyForCountry(iso2));
  const existingValue = (existing?.value as any) ?? {};
  const nextValue: any = {
    ...existingValue,
    enabled: true,
    levels: { ...(existingValue.levels ?? {}) }
  };
  for (const lvl of levels) {
    nextValue.levels[lvl.id] = { ...(nextValue.levels[lvl.id] ?? {}), enabled: true, inProgress: true, startedAt: Date.now(), dimIds: lvl.dimIds };
  }
  await db.meta.put({ key: metaKeyForCountry(iso2), value: nextValue, updatedAt: Date.now() });
  invalidateAdminEnrichmentEnabledCache(iso2);

  analysisConsole.info(`Admin enrichment: loading rounds for ${iso2.toUpperCase()}...`);
  set(2, `Loading rounds for ${iso2.toUpperCase()}...`);

  const rows = await db.rounds.where("trueCountry").equals(iso2 as any).toArray();
  const total = rows.length;
  if (!total) {
    set(0, "No rounds found for this country.");
    return;
  }

  analysisConsole.info(`Admin enrichment: computing ${dimIds.length} dimensions for ${total} rounds...`);
  for (let i = 0; i < dimIds.length; i++) {
    const dimId = dimIds[i];
    const pct = 5 + (i / Math.max(1, dimIds.length)) * 70;
    set(pct, `Computing ${dimId}... (${i + 1}/${dimIds.length})`);
    await maybeEnrichRoundRowsForDimension(dimId, rows as any[]);
  }

  analysisConsole.info("Admin enrichment: saving enriched rounds...");
  set(80, "Saving enriched rounds...");

  const batchSize = 200;
  for (let offset = 0; offset < total; offset += batchSize) {
    const chunk = rows.slice(offset, offset + batchSize);
    await db.rounds.bulkPut(chunk as any);
    set(80 + (offset / Math.max(1, total)) * 18, "Saving enriched rounds...");
    if (offset > 0 && offset % (batchSize * 4) === 0) await new Promise<void>((r) => setTimeout(r, 0));
  }

  const prev = await db.meta.get(metaKeyForCountry(iso2));
  const prevValue = (prev?.value as any) ?? {};
  const finalValue: any = {
    ...prevValue,
    enabled: true,
    doneAt: Date.now(),
    rounds: total,
    dimIdsDone: Array.from(new Set([...(prevValue.dimIdsDone ?? []), ...dimIds])),
    levels: { ...(prevValue.levels ?? {}) }
  };
  for (const lvl of levels) {
    finalValue.levels[lvl.id] = { ...(finalValue.levels[lvl.id] ?? {}), enabled: true, inProgress: false, doneAt: Date.now(), dimIds: lvl.dimIds };
  }
  await db.meta.put({ key: metaKeyForCountry(iso2), value: finalValue, updatedAt: Date.now() });
  invalidateAdminEnrichmentEnabledCache(iso2);

  invalidateRoundsCache();
  (globalThis as any).__gaRequestRerender?.();
  set(100, "Done.");
  analysisConsole.info("Admin enrichment: done.");
}

export async function renderAdminEnrichmentWidget(
  _semantic: SemanticRegistry,
  widget: WidgetDef,
  _overlay: any,
  baseRows: any[]
): Promise<HTMLElement> {
  const doc = document;
  const el = doc.createElement("div");
  el.className = "ga-widget ga-admin-enrichment";

  const title = doc.createElement("div");
  title.style.fontWeight = "600";
  title.style.marginBottom = "6px";
  title.textContent = widget.title || "Detailed administrative regions";
  el.appendChild(title);

  const hint = doc.createElement("div");
  hint.style.opacity = "0.9";
  hint.style.fontSize = "12px";
  hint.style.marginBottom = "10px";
  hint.textContent =
    (widget.spec as any)?.description ??
    "Optional: download admin boundaries and compute region fields (e.g. province/state) for this country. This enables hit-rate stats and region maps.";
  el.appendChild(hint);

  const body = doc.createElement("div");
  body.style.display = "flex";
  body.style.flexDirection = "column";
  body.style.gap = "8px";
  el.appendChild(body);

  const countryIso2 = (() => {
    const first = Array.isArray(baseRows) ? baseRows.find((r) => r && typeof r === "object") : null;
    return asIso2(first?.trueCountry ?? first?.true_country);
  })();

  if (!countryIso2) {
    const msg = doc.createElement("div");
    msg.textContent = "Select a country in Country Insight to enable detailed admin analysis.";
    body.appendChild(msg);
    return el;
  }

  const plan = getAdminEnrichmentPlan(countryIso2);
  if (!plan) {
    const msg = doc.createElement("div");
    msg.textContent = `No detailed admin-level dataset configured for '${countryIso2.toUpperCase()}' yet.`;
    body.appendChild(msg);
    return el;
  }

  const status = doc.createElement("div");
  status.style.fontSize = "12px";
  status.style.opacity = "0.9";
  body.appendChild(status);

  const progress = doc.createElement("div");
  progress.style.height = "8px";
  progress.style.borderRadius = "999px";
  progress.style.background = "rgba(255,255,255,0.10)";
  progress.style.overflow = "hidden";
  const progressFill = doc.createElement("div");
  progressFill.style.height = "100%";
  progressFill.style.width = "0%";
  progressFill.style.background = "linear-gradient(90deg, rgba(0,190,255,0.85), rgba(170,255,120,0.85))";
  progress.appendChild(progressFill);
  body.appendChild(progress);

  const actions = doc.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "10px";
  actions.style.flexWrap = "wrap";
  body.appendChild(actions);

  const btn = doc.createElement("button");
  btn.className = "ga-filter-btn";
  btn.textContent = "Start detailed analysis";
  actions.appendChild(btn);

  const clearBtn = doc.createElement("button");
  clearBtn.className = "ga-filter-btn";
  clearBtn.textContent = "Disable";
  actions.appendChild(clearBtn);

  const refresh = async (): Promise<void> => {
    const meta = await db.meta.get(metaKeyForCountry(countryIso2));
    const enabled = (meta?.value as any)?.enabled === true;
    const doneAt = (meta?.value as any)?.doneAt as number | undefined;
    const doneTxt = typeof doneAt === "number" && Number.isFinite(doneAt) ? new Date(doneAt).toLocaleString() : "";
    status.textContent = enabled ? `Enabled for ${plan.label}. ${doneTxt ? `Last run: ${doneTxt}.` : ""}` : `Disabled for ${plan.label}.`;
    btn.textContent = enabled ? "Re-run detailed analysis" : "Start detailed analysis";
  };

  const setBusy = (pct: number, msg: string) => {
    progressFill.style.width = `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`;
    status.textContent = msg;
  };

  btn.addEventListener("click", () => {
    void (async () => {
      btn.disabled = true;
      clearBtn.disabled = true;
      try {
        let pct = 0;
        let msg = "";
        const sync = () => setBusy(pct, msg);
        await runAdminEnrichment(countryIso2, {
          onPct: (p) => {
            pct = p;
            sync();
          },
          onStatus: (m) => {
            msg = m;
            sync();
          }
        });
        setBusy(100, "Done. Refreshing view...");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        analysisConsole.error(`Admin enrichment failed: ${msg}`);
        setBusy(0, `Error: ${msg}`);
      } finally {
        btn.disabled = false;
        clearBtn.disabled = false;
        await refresh();
      }
    })();
  });

  clearBtn.addEventListener("click", () => {
    void (async () => {
      clearBtn.disabled = true;
      btn.disabled = true;
      try {
        await db.meta.put({ key: metaKeyForCountry(countryIso2), value: { enabled: false, doneAt: Date.now() }, updatedAt: Date.now() });
        invalidateAdminEnrichmentEnabledCache(countryIso2);
        invalidateRoundsCache();
        (globalThis as any).__gaRequestRerender?.();
      } finally {
        clearBtn.disabled = false;
        btn.disabled = false;
        await refresh();
      }
    })();
  });

  await refresh();
  return el;
}
