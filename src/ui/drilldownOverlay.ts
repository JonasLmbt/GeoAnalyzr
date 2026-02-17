// src/ui/drilldownOverlay.ts
import type { SemanticRegistry } from "../config/semantic.types";
import type { FilterClause } from "../config/dashboard.types";
import { getGames, getRounds, getSessions } from "../engine/queryEngine";
import { pickWithAliases } from "../engine/fieldAccess";
import type { DrilldownColumnDef, DrilldownColumnSpec } from "../config/semantic.types";

export type DrilldownTarget = "rounds" | "games" | "sessions" | "players";

export interface DrilldownRequest {
  title: string;
  target: DrilldownTarget;
  columnsPreset: string;
  rows: any[];
  extraFilters?: FilterClause[];
  initialSort?: { key: string; dir?: "asc" | "desc" };
}

export class DrilldownOverlay {
  private root: HTMLElement;
  private doc: Document;
  private modal: HTMLDivElement;
  private sessionMapByGap = new Map<number, Map<string, string>>(); // gameId -> sessionId
  private sessionRowByIdByGap = new Map<number, Map<string, any>>(); // sessionId -> sessionRow

  constructor(root: HTMLElement) {
    this.root = root;
    this.doc = root.ownerDocument;
    this.modal = this.doc.createElement("div");
    this.modal.className = "ga-drilldown-modal";
    this.modal.style.display = "none";
    this.root.appendChild(this.modal);
  }

  getDocument(): Document {
    return this.doc;
  }

  private readSessionGapMinutes(): number {
    const root = this.root as HTMLElement & { dataset?: DOMStringMap };
    const raw = Number(root.dataset?.gaSessionGapMinutes);
    return Number.isFinite(raw) ? Math.max(1, Math.min(360, Math.round(raw))) : 45;
  }

  private async ensureSessionMaps(semantic: SemanticRegistry): Promise<{ gap: number; gameToSession: Map<string, string>; sessionById: Map<string, any> }> {
    const gap = this.readSessionGapMinutes();
    const cachedGame = this.sessionMapByGap.get(gap);
    const cachedSess = this.sessionRowByIdByGap.get(gap);
    if (cachedGame && cachedSess) return { gap, gameToSession: cachedGame, sessionById: cachedSess };

    const sessions = await getSessions({ global: { spec: undefined, state: {}, sessionGapMinutes: gap } });
    const gameToSession = new Map<string, string>();
    const sessionById = new Map<string, any>();
    for (const s of sessions as any[]) {
      const sid = typeof s?.sessionId === "string" ? s.sessionId : "";
      if (!sid) continue;
      sessionById.set(sid, s);
      const ids = Array.isArray(s?.gameIds) ? (s.gameIds as any[]) : [];
      for (const gid of ids) {
        if (typeof gid === "string" && gid) gameToSession.set(gid, sid);
      }
    }
    this.sessionMapByGap.set(gap, gameToSession);
    this.sessionRowByIdByGap.set(gap, sessionById);
    return { gap, gameToSession, sessionById };
  }

  open(semantic: SemanticRegistry, req: DrilldownRequest): void {
    this.modal.innerHTML = "";
    this.modal.style.display = "block";

    const bg = this.doc.createElement("div");
    bg.className = "ga-drilldown-bg";
    bg.addEventListener("click", () => this.close());

    const panel = this.doc.createElement("div");
    panel.className = "ga-drilldown-panel";

    const header = this.doc.createElement("div");
    header.className = "ga-drilldown-header";

    const hTitle = this.doc.createElement("div");
    hTitle.className = "ga-drilldown-title";
    hTitle.textContent = `${req.title} (${req.rows.length})`;

    const btn = this.doc.createElement("button");
    btn.className = "ga-drilldown-close";
    btn.type = "button";
    btn.setAttribute("aria-label", "Close");
    btn.textContent = "X";
    btn.addEventListener("click", () => this.close());

    header.appendChild(hTitle);
    header.appendChild(btn);

    const preset = semantic.drilldownPresets[req.target];
    const dateFormat = this.readDateFormatMode();

    const rawCols = (preset?.columnsPresets?.[req.columnsPreset] ?? []) as DrilldownColumnSpec[];
    const cols = rawCols.map((c) => (typeof c === "string" ? ({ key: c } as DrilldownColumnDef) : c));

    // Sorting state is per-overlay instance.
    let sortKey = cols.find((c) => c.sortable)?.key ?? cols[0]?.key ?? "";
    let sortDir: "asc" | "desc" = "desc";
    const initKey = req.initialSort?.key;
    const initDir = req.initialSort?.dir;
    if (typeof initKey === "string" && initKey.trim().length > 0 && cols.some((c) => c.key === initKey)) {
      sortKey = initKey;
      if (initDir === "asc" || initDir === "desc") sortDir = initDir;
    }

    const sortRankForResult = (v: unknown): number => {
      const s = typeof v === "string" ? v.trim().toLowerCase() : "";
      if (s === "win" || s === "w" || s === "true") return 2;
      if (s === "tie" || s === "t") return 1;
      if (s === "loss" || s === "l" || s === "false") return 0;
      return -1;
    };

    const getSortValue = (row: any, col: DrilldownColumnDef): string | number => {
      const key = col.key;
      const v = this.getCellRawValue(row, key, semantic);
      if (key === "result") return sortRankForResult(v);
      if (typeof v === "number" && Number.isFinite(v)) return v;
      const s = typeof v === "string" ? v : String(v ?? "");
      // If this looks like a date, prefer timestamp sorting.
      const k = key.toLowerCase();
      if ((k.includes("date") || k.includes("time") || k.includes("playedat") || k.includes("ts")) && s) {
        const parsed = Date.parse(s);
        if (Number.isFinite(parsed)) return parsed;
      }
      return s.toLowerCase();
    };

    const isSameGame = (a: any, b: any): boolean => {
      const ga = pickWithAliases(a, "gameId", semantic.columnAliases);
      const gb = pickWithAliases(b, "gameId", semantic.columnAliases);
      return typeof ga === "string" && typeof gb === "string" && ga.length > 0 && ga === gb;
    };

    const sortRows = (rows: any[]): any[] => {
      const col = cols.find((c) => c.key === sortKey);
      if (!col) return rows;
      const sorted = [...rows].sort((a, b) => {
        const av = getSortValue(a, col);
        const bv = getSortValue(b, col);
        if (typeof av === "number" && typeof bv === "number") return sortDir === "asc" ? av - bv : bv - av;
        return sortDir === "asc"
          ? String(av).localeCompare(String(bv))
          : String(bv).localeCompare(String(av));
      });
      return sorted;
    };

    const table = this.doc.createElement("table");
    table.className = "ga-drilldown-table";

    const thead = this.doc.createElement("thead");
    const trh = this.doc.createElement("tr");
    thead.appendChild(trh);

    const tbody = this.doc.createElement("tbody");

    const openRoundsForGameId = async (gameId: string, titleSuffix: string): Promise<void> => {
      const all = await getRounds({});
      const rows = (all as any[]).filter((r) => typeof (r as any)?.gameId === "string" && (r as any).gameId === gameId);
      this.open(semantic, {
        title: `${req.title}${titleSuffix}`,
        target: "rounds",
        columnsPreset: semantic.drilldownPresets.rounds?.defaultPreset ?? "roundMode",
        rows
      });
    };

    const openGameById = async (gameId: string, titleSuffix: string): Promise<void> => {
      const all = await getGames({});
      const rows = (all as any[]).filter((g) => typeof (g as any)?.gameId === "string" && (g as any).gameId === gameId);
      this.open(semantic, {
        title: `${req.title}${titleSuffix}`,
        target: "games",
        columnsPreset: semantic.drilldownPresets.games?.defaultPreset ?? "gameMode",
        rows
      });
    };

    const openGamesForSessionId = async (sessionId: string, titleSuffix: string): Promise<void> => {
      const { sessionById } = await this.ensureSessionMaps(semantic);
      const sess = sessionById.get(sessionId);
      const ids = Array.isArray(sess?.gameIds) ? (sess.gameIds as any[]) : [];
      const idSet = new Set(ids.filter((x) => typeof x === "string" && x));
      const all = await getGames({});
      const rows = (all as any[]).filter((g) => typeof (g as any)?.gameId === "string" && idSet.has((g as any).gameId));
      this.open(semantic, {
        title: `${req.title}${titleSuffix}`,
        target: "games",
        columnsPreset: semantic.drilldownPresets.games?.defaultPreset ?? "gameMode",
        rows
      });
    };

    const openSessionById = async (sessionId: string, titleSuffix: string): Promise<void> => {
      const { sessionById } = await this.ensureSessionMaps(semantic);
      const row = sessionById.get(sessionId);
      this.open(semantic, {
        title: `${req.title}${titleSuffix}`,
        target: "sessions",
        columnsPreset: semantic.drilldownPresets.sessions?.defaultPreset ?? "sessionMode",
        rows: row ? [row] : []
      });
    };

    const renderHeader = () => {
      trh.innerHTML = "";
      for (const c of cols) {
        const th = this.doc.createElement("th");
        th.className = "ga-dd-th";
        const label = c.label ?? c.key;
        if (c.sortable) {
          th.classList.add("ga-dd-sortable");
          const arrow = c.key === sortKey ? (sortDir === "asc" ? " ^" : " v") : "";
          th.textContent = `${label}${arrow}`;
          th.addEventListener("click", () => {
            if (sortKey === c.key) sortDir = sortDir === "asc" ? "desc" : "asc";
            else {
              sortKey = c.key;
              sortDir = "desc";
            }
            renderBody(true);
            renderHeader();
          });
        } else {
          th.textContent = label;
        }
        trh.appendChild(th);
      }
    };

    const renderBody = (reset = false) => {
      const rows = sortRows(req.rows);
      if (reset) tbody.innerHTML = "";
      tbody.innerHTML = "";
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const tr = this.doc.createElement("tr");
        tr.className = "ga-dd-tr";
        const next = rows[i + 1];
        if (next && isSameGame(r, next)) tr.classList.add("ga-dd-no-sep");
        for (const c of cols) {
          const td = this.doc.createElement("td");
          td.className = "ga-dd-td";
          this.renderCell(td, r, c, semantic, dateFormat);

          // Cell-level drilldowns to close the loop between entities.
          const key = String(c?.key ?? "");
          const raw = this.getCellRawValue(r, key, semantic);

          // Rounds: click gameId/sessionId.
          if (req.target === "rounds" && key === "gameId" && typeof raw === "string" && raw) {
            td.style.cursor = "pointer";
            td.addEventListener("click", () => void openGameById(raw, ` (game ${raw})`));
          }
          if (req.target === "rounds" && key === "sessionId") {
            const gid = this.getCellRawValue(r, "gameId", semantic);
            if (typeof raw === "string" && raw) {
              td.style.cursor = "pointer";
              td.addEventListener("click", () => void openSessionById(raw, ` (session ${raw})`));
            } else if (typeof gid === "string" && gid) {
              td.style.cursor = "pointer";
              td.textContent = "...";
              void (async () => {
                const { gameToSession } = await this.ensureSessionMaps(semantic);
                const sid = gameToSession.get(gid) ?? "";
                td.textContent = sid || "-";
                if (sid) td.addEventListener("click", () => void openSessionById(sid, ` (session ${sid})`));
              })();
            }
          }

          // Games/Players: click roundsCount, gameId, sessionId.
          if ((req.target === "games" || req.target === "players") && key === "roundsCount") {
            const gid = this.getCellRawValue(r, "gameId", semantic);
            if (typeof gid === "string" && gid) {
              td.style.cursor = "pointer";
              td.addEventListener("click", () => void openRoundsForGameId(gid, ` (game ${gid})`));
            }
          }
          if ((req.target === "games" || req.target === "players") && key === "gameId" && typeof raw === "string" && raw) {
            td.style.cursor = "pointer";
            td.addEventListener("click", () => void openRoundsForGameId(raw, ` (game ${raw})`));
          }
          if ((req.target === "games" || req.target === "players") && key === "sessionId") {
            const gid = this.getCellRawValue(r, "gameId", semantic);
            if (typeof raw === "string" && raw) {
              td.style.cursor = "pointer";
              td.addEventListener("click", () => void openSessionById(raw, ` (session ${raw})`));
            } else if (typeof gid === "string" && gid) {
              td.style.cursor = "pointer";
              td.textContent = "...";
              void (async () => {
                const { gameToSession } = await this.ensureSessionMaps(semantic);
                const sid = gameToSession.get(gid) ?? "";
                td.textContent = sid || "-";
                if (sid) td.addEventListener("click", () => void openSessionById(sid, ` (session ${sid})`));
              })();
            }
          }

          // Sessions: click gamesCount or sessionId.
          if (req.target === "sessions" && key === "gamesCount") {
            const sid = this.getCellRawValue(r, "sessionId", semantic);
            if (typeof sid === "string" && sid) {
              td.style.cursor = "pointer";
              td.addEventListener("click", () => void openGamesForSessionId(sid, ` (session ${sid})`));
            }
          }
          if (req.target === "sessions" && key === "sessionId" && typeof raw === "string" && raw) {
            td.style.cursor = "pointer";
            td.addEventListener("click", () => void openGamesForSessionId(raw, ` (session ${raw})`));
          }

          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
    };

    renderHeader();
    renderBody(true);

    table.appendChild(thead);
    table.appendChild(tbody);

    panel.appendChild(header);
    panel.appendChild(table);

    this.modal.appendChild(bg);
    this.modal.appendChild(panel);
  }

  close(): void {
    this.modal.style.display = "none";
  }

  private readDateFormatMode(): "dd/mm/yyyy" | "mm/dd/yyyy" | "yyyy-mm-dd" | "locale" {
    const root = this.root as HTMLElement & { dataset?: DOMStringMap };
    const mode = root.dataset?.gaDateFormat;
    return mode === "mm/dd/yyyy" || mode === "yyyy-mm-dd" || mode === "locale" ? mode : "dd/mm/yyyy";
  }

  private readCountryFormatMode(): "iso2" | "english" {
    const root = this.root as HTMLElement & { dataset?: DOMStringMap };
    return root.dataset?.gaCountryFormat === "english" ? "english" : "iso2";
  }

  private formatCountry(isoOrName: string): string {
    const mode = this.readCountryFormatMode();
    if (mode === "iso2") return isoOrName;

    const iso2 = isoOrName.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(iso2)) return isoOrName;
    if (typeof Intl === "undefined" || !(Intl as any).DisplayNames) return isoOrName;
    try {
      const dn = new (Intl as any).DisplayNames(["en"], { type: "region" });
      return dn.of(iso2) ?? isoOrName;
    } catch {
      return isoOrName;
    }
  }

  private formatDate(ts: number, mode: "dd/mm/yyyy" | "mm/dd/yyyy" | "yyyy-mm-dd" | "locale"): string {
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return String(ts);
    if (mode === "locale") return d.toLocaleString();

    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");

    if (mode === "yyyy-mm-dd") return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
    if (mode === "mm/dd/yyyy") return `${m}/${day}/${y} ${hh}:${mm}:${ss}`;
    return `${day}/${m}/${y} ${hh}:${mm}:${ss}`;
  }

  private formatCellValue(
    value: unknown,
    columnName: string,
    dateMode: "dd/mm/yyyy" | "mm/dd/yyyy" | "yyyy-mm-dd" | "locale"
  ): string {
    if (value === undefined || value === null) return "";

    const col = columnName.toLowerCase();
    const looksLikeDateColumn =
      col === "ts" ||
      col === "playedat" ||
      col === "starttime" ||
      col === "endtime" ||
      col.includes("date") ||
      col.includes("time") ||
      col.includes("playedat") ||
      col.includes("timestamp");

    if (typeof value === "number" && Number.isFinite(value)) {
      if (looksLikeDateColumn && value > 946684800000 && value < 4102444800000) {
        return this.formatDate(value, dateMode);
      }
      return String(value);
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (looksLikeDateColumn) {
        // Handle raw numeric timestamps that come in as strings.
        if (/^[0-9]{10,13}$/.test(trimmed)) {
          const n = Number(trimmed);
          if (Number.isFinite(n)) {
            const ts = trimmed.length === 10 ? n * 1000 : n;
            if (ts > 946684800000 && ts < 4102444800000) return this.formatDate(ts, dateMode);
          }
        }
        const parsed = Date.parse(trimmed);
        if (Number.isFinite(parsed)) return this.formatDate(parsed, dateMode);
      }
      return value;
    }

    return String(value);
  }

  private movementLabel(v: unknown): string {
    const s = typeof v === "string" ? v.trim().toLowerCase() : "";
    if (!s) return "";
    if (s === "moving") return "Moving";
    if (s === "no_move" || s === "nomove" || s.includes("no move")) return "No Move";
    if (s === "nmpz" || s.includes("nmpz")) return "NMPZ";
    return v as any;
  }

  private gameModeLabel(v: unknown): string {
    const s = typeof v === "string" ? v.trim() : "";
    const k = s.toLowerCase();
    if (!k) return "";
    if (k === "duels" || k === "duel") return "Duel";
    if (k === "teamduels" || k === "teamduel" || k.includes("team") && k.includes("duel")) return "Team Duel";
    return s;
  }

  private getCellRawValue(row: any, key: string, semantic: SemanticRegistry): unknown {
    const pickNum = (k: string): number | undefined => {
      const v = pickWithAliases(row, k, semantic.columnAliases);
      return typeof v === "number" && Number.isFinite(v) ? v : undefined;
    };

    const pickBool = (k: string): boolean | undefined => {
      const v = pickWithAliases(row, k, semantic.columnAliases);
      return typeof v === "boolean" ? v : undefined;
    };

    const bestOwnGuess = (): { lat?: number; lng?: number; score?: number } => {
      const mf = String((row as any)?.modeFamily ?? "").toLowerCase();
      if (mf !== "teamduels") {
        return {
          lat: pickNum("player_self_guessLat"),
          lng: pickNum("player_self_guessLng"),
          score: pickNum("player_self_score")
        };
      }

      const self = {
        lat: pickNum("player_self_guessLat"),
        lng: pickNum("player_self_guessLng"),
        score: pickNum("player_self_score"),
        best: pickBool("player_self_isBestGuess")
      };
      const mate = {
        lat: pickNum("player_mate_guessLat"),
        lng: pickNum("player_mate_guessLng"),
        score: pickNum("player_mate_score"),
        best: pickBool("player_mate_isBestGuess")
      };

      // Prefer explicit best-guess flag when present.
      if (mate.best === true && self.best !== true) return mate;
      if (self.best === true && mate.best !== true) return self;

      // Fallback: pick higher score if available.
      if (typeof mate.score === "number" && typeof self.score === "number") return mate.score > self.score ? mate : self;
      if (typeof mate.score === "number") return mate;
      return self;
    };

    if (key === "guess_maps") {
      const g = bestOwnGuess();
      if (typeof g.lat === "number" && typeof g.lng === "number") return `https://www.google.com/maps?q=${g.lat},${g.lng}`;
      return undefined;
    }
    if (key === "street_view") {
      const lat = pickWithAliases(row, "trueLat", semantic.columnAliases);
      const lng = pickWithAliases(row, "trueLng", semantic.columnAliases);
      if (typeof lat === "number" && typeof lng === "number") return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
      return undefined;
    }

    if (key === "opponentName") return typeof (row as any)?.opponentName === "string" ? (row as any).opponentName : undefined;
    if (key === "opponentCountry") return typeof (row as any)?.opponentCountry === "string" ? (row as any).opponentCountry : undefined;
    if (key === "matchups") return typeof (row as any)?.matchups === "number" ? (row as any).matchups : undefined;

    // Drilldown requirement: in team duels, score should reflect the best own guess (self or mate).
    if (key === "player_self_score") {
      const mf = String((row as any)?.modeFamily ?? "").toLowerCase();
      if (mf === "teamduels") {
        const g = bestOwnGuess();
        if (typeof g.score === "number") return g.score;
      }
    }

    if (key === "endRating") {
      const mf = String((row as any)?.modeFamily ?? "").toLowerCase();
      if (mf === "teamduels" || (mf.includes("team") && mf.includes("duel")) || (row as any)?.isTeamDuels === true) {
        return (
          pickWithAliases(row, "teamOneEndRating", semantic.columnAliases) ??
          pickWithAliases(row, "player_self_endRating", semantic.columnAliases) ??
          pickWithAliases(row, "playerOneEndRating", semantic.columnAliases)
        );
      }
      return pickWithAliases(row, "player_self_endRating", semantic.columnAliases) ?? pickWithAliases(row, "playerOneEndRating", semantic.columnAliases);
    }

    if (key === "ratingDelta") {
      const mf = String((row as any)?.modeFamily ?? "").toLowerCase();
      const isTeam = mf === "teamduels" || (mf.includes("team") && mf.includes("duel")) || (row as any)?.isTeamDuels === true;
      const start = isTeam
        ? (pickWithAliases(row, "teamOneStartRating", semantic.columnAliases) ?? pickWithAliases(row, "player_self_startRating", semantic.columnAliases))
        : (pickWithAliases(row, "player_self_startRating", semantic.columnAliases) ?? pickWithAliases(row, "playerOneStartRating", semantic.columnAliases));
      const end = this.getCellRawValue(row, "endRating", semantic);
      if (typeof start === "number" && Number.isFinite(start) && typeof end === "number" && Number.isFinite(end)) return end - start;
      return undefined;
    }

    return pickWithAliases(row, key, semantic.columnAliases);
  }

  private renderCell(
    td: HTMLTableCellElement,
    row: any,
    col: DrilldownColumnDef,
    semantic: SemanticRegistry,
    dateMode: "dd/mm/yyyy" | "mm/dd/yyyy" | "yyyy-mm-dd" | "locale"
  ): void {
    const key = col.key;
    const raw = this.getCellRawValue(row, key, semantic);

    const mkProfileUrl = (id: unknown): string => {
      const s = typeof id === "string" ? id.trim() : "";
      return s ? `https://www.geoguessr.com/user/${s}` : "";
    };

    const maybeRenderProfileLink = (nameKey: string, idKey: string) => {
      if (key !== nameKey) return false;
      if (typeof raw !== "string" || !raw.trim()) return true;
      const id = pickWithAliases(row, idKey, semantic.columnAliases);
      const href = mkProfileUrl(id);
      if (!href) return false;
      const a = this.doc.createElement("a");
      a.className = "ga-dd-link";
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = raw;
      td.appendChild(a);
      return true;
    };

    if (
      maybeRenderProfileLink("player_opponent_name", "player_opponent_id") ||
      maybeRenderProfileLink("player_opponent_mate_name", "player_opponent_mate_id") ||
      maybeRenderProfileLink("player_mate_name", "player_mate_id")
    ) {
      return;
    }

    if (col.type === "link" || key === "guess_maps" || key === "street_view") {
      const href = typeof raw === "string" ? raw : "";
      if (!href) return;
      const a = this.doc.createElement("a");
      a.className = "ga-dd-link";
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = col.link?.label ?? "Open";
      td.appendChild(a);
      return;
    }

    let text = this.formatCellValue(raw, key, dateMode);

    if (key === "movementType" || key === "movement_type" || key === "movement") {
      const lbl = this.movementLabel(raw);
      if (lbl) text = String(lbl);
    }
    if (key === "gameMode" || key === "game_mode" || key === "modeFamily") {
      const lbl = this.gameModeLabel(raw);
      if (lbl) text = String(lbl);
    }

    if (key === "result") {
      if (typeof raw === "boolean") text = raw ? "Win" : "Loss";
      else if (typeof raw === "string") text = raw;
      else text = "-";
    }

    if (key === "durationSeconds" && typeof raw === "number" && Number.isFinite(raw)) {
      text = `${raw.toFixed(1)}s`;
    }
    if (key === "damage" && typeof raw === "number" && Number.isFinite(raw)) {
      const signed = raw > 0 ? `+${Math.round(raw)}` : `${Math.round(raw)}`;
      text = signed;
    }
    if (key === "ratingDelta" && typeof raw === "number" && Number.isFinite(raw)) {
      const signed = raw > 0 ? `+${Math.round(raw)}` : `${Math.round(raw)}`;
      text = signed;
    }
    if (
      (key === "true_country" ||
        key === "trueCountry" ||
        key === "player_self_country" ||
        key === "player_self_guessCountry" ||
        key === "opponentCountry") &&
      typeof raw === "string"
    ) {
      text = this.formatCountry(raw);
    }

    if (key === "gameId" && col.display?.truncate) {
      const head = typeof col.display.truncateHead === "number" ? col.display.truncateHead : 8;
      const s = typeof raw === "string" ? raw : text;
      if (s.length > head + 3) text = `${s.slice(0, head)}...`;
    }
    if (key === "sessionId" && col.display?.truncate) {
      const head = typeof col.display.truncateHead === "number" ? col.display.truncateHead : 2;
      const s = typeof raw === "string" ? raw : text;
      if (s.length > head + 3) text = `${s.slice(0, head)}...`;
    }

    const span = this.doc.createElement("span");
    span.textContent = text;

    if (col.colored) {
      if (key === "result") {
        const s = (typeof raw === "string" ? raw : String(raw ?? "")).trim().toLowerCase();
        if (s === "win" || s === "w" || s === "true") span.classList.add("ga-dd-pos");
        else if (s === "loss" || s === "l" || s === "false") span.classList.add("ga-dd-neg");
      }
      if (key === "damage" && typeof raw === "number" && Number.isFinite(raw)) {
        if (raw > 0) span.classList.add("ga-dd-pos");
        else if (raw < 0) span.classList.add("ga-dd-neg");
      }
      if (key === "ratingDelta" && typeof raw === "number" && Number.isFinite(raw)) {
        if (raw > 0) span.classList.add("ga-dd-pos");
        else if (raw < 0) span.classList.add("ga-dd-neg");
      }
    }

    td.appendChild(span);
  }
}
