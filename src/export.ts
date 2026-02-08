import * as XLSX from "xlsx";
import { db } from "./db";
import { resolveCountryCodeByLatLng } from "./countries";

function getByPath(obj: any, path: string): any {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== "object" || !(p in cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

function pickFirst(obj: any, paths: string[]): any {
  for (const p of paths) {
    const v = getByPath(obj, p);
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

function iso(ts?: number): string {
  if (!ts || !Number.isFinite(ts)) return "";
  return new Date(ts).toISOString();
}

function sanitizeSheetName(name: string): string {
  const n = (name || "unknown").replace(/[\\/*?:[\]]/g, "_");
  return n.length > 31 ? n.slice(0, 31) : n;
}

function normalizeIso2(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const x = v.trim().toLowerCase();
  return /^[a-z]{2}$/.test(x) ? x : undefined;
}

function fmtCoord(v?: number): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(4) : "?";
}

function isLatLngInRange(lat?: number, lng?: number): boolean {
  return (
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    Math.abs(lat) <= 90 &&
    typeof lng === "number" &&
    Number.isFinite(lng) &&
    Math.abs(lng) <= 180
  );
}

function toTsMaybe(isoMaybe: unknown): number | undefined {
  if (typeof isoMaybe !== "string" || !isoMaybe) return undefined;
  const t = Date.parse(isoMaybe);
  return Number.isFinite(t) ? t : undefined;
}

function exportModeSheetKey(gameMode: string | undefined, modeFamily: string | undefined): string {
  const family = String(modeFamily || "").toLowerCase();
  if (family === "standard") return "standard";
  if (family === "streak") return "streak";
  return gameMode || "unknown";
}

async function resolveGuessCountryForExport(
  existing: unknown,
  lat?: number,
  lng?: number
): Promise<string> {
  const direct = normalizeIso2(existing);
  if (direct) return direct;
  if (!isLatLngInRange(lat, lng)) {
    return "";
  }
  let resolved = normalizeIso2(await resolveCountryCodeByLatLng(lat, lng));
  if (!resolved && isLatLngInRange(lng, lat)) {
    resolved = normalizeIso2(await resolveCountryCodeByLatLng(lng, lat));
  }
  if (resolved) return resolved;
  return `ERR_RESOLVE_FAILED(${fmtCoord(lat)},${fmtCoord(lng)})`;
}

async function downloadWorkbook(wb: XLSX.WorkBook, filename: string): Promise<void> {
  const arrayBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const blob = new Blob([arrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  await new Promise((r) => setTimeout(r, 150));
  URL.revokeObjectURL(url);
}

export async function exportExcel(onStatus: (msg: string) => void): Promise<void> {
  onStatus("Preparing export...");

  const [games, rounds, details] = await Promise.all([
    db.games.orderBy("playedAt").reverse().toArray(),
    db.rounds.toArray(),
    db.details.toArray()
  ]);

  if (games.length === 0) {
    onStatus("No games to export.");
    return;
  }

  const detailsByGame = new Map(details.map((d) => [d.gameId, d]));
  const gameById = new Map(games.map((g) => [g.gameId, g]));

  const gamesByMode = new Map<string, Array<any & { __playedAt?: number }>>();
  for (const g of games) {
    const d = detailsByGame.get(g.gameId);
    const modeFamily = g.modeFamily || "";
    const mode = exportModeSheetKey(g.gameMode || g.mode, modeFamily);
    if (!gamesByMode.has(mode)) gamesByMode.set(mode, []);
    const played = new Date(g.playedAt);
    const date = played.toISOString().slice(0, 10);
    const time = played.toISOString().slice(11, 23);
    const isTeam = (mode || "").toLowerCase().includes("team");
    const isStandard = modeFamily === "standard";
    const isStreak = modeFamily === "streak" && !(mode || "").toLowerCase().includes("team");
    const raw = g.raw as any;
    if (isStandard || isStreak) {
      if (isStandard) {
        gamesByMode.get(mode)!.push({
          gameNumber: "",
          date,
          clock: time,
          mapSlug: pickFirst(raw, ["payload.mapSlug", "payload.map.slug", "mapSlug", "map.slug"]) || "",
          mapName: pickFirst(raw, ["payload.mapName", "payload.map.name", "mapName", "map.name"]) || "",
          points: pickFirst(raw, ["payload.points", "payload.score", "points", "score"]) || "",
          gameToken: pickFirst(raw, ["payload.gameToken", "payload.token", "payload.gameId", "gameToken", "token", "id"]) || g.gameId,
          gameMode: mode || "",
          __playedAt: g.playedAt
        });
      } else {
        gamesByMode.get(mode)!.push({
          gameNumber: "",
          date,
          clock: time,
          mapSlug: pickFirst(raw, ["payload.mapSlug", "payload.map.slug", "mapSlug", "map.slug"]) || "",
          points: pickFirst(raw, ["payload.points", "payload.score", "points", "score"]) || "",
          gameToken: pickFirst(raw, ["payload.gameToken", "payload.token", "payload.gameId", "gameToken", "token", "id"]) || g.gameId,
          gameMode: mode || "",
          __playedAt: g.playedAt
        });
      }
      continue;
    }

    const base: any = {
      gameId: g.gameId,
      date,
      time,
      gameMode: d?.gameModeSimple || mode || "",
      mapName: d?.mapName || "",
      mapSlug: d?.mapSlug || "",
      detailsStatus: d?.status || "missing",
      detailsFetchedAt: iso(d?.fetchedAt),
      detailsError: d?.status === "error" ? (d?.error || "") : ""
    };
    if (!isTeam) {
      base.playerOneId = (d as any)?.playerOneId ?? (d as any)?.p1_playerId ?? "";
      base.playerOneName = (d as any)?.playerOneName ?? (d as any)?.p1_playerName ?? "";
      base.playerOneCountry = (d as any)?.playerOneCountry ?? "";
      base.playerOneVictory = (d as any)?.playerOneVictory === undefined ? "" : (d as any)?.playerOneVictory;
      base.playerOneFinalHealth = (d as any)?.playerOneFinalHealth ?? "";
      base.playerOneStartRating = (d as any)?.playerOneStartRating ?? (d as any)?.p1_ratingBefore ?? "";
      base.playerOneEndRating = (d as any)?.playerOneEndRating ?? (d as any)?.p1_ratingAfter ?? "";
      base.playerTwoId = (d as any)?.playerTwoId ?? (d as any)?.p2_playerId ?? "";
      base.playerTwoName = (d as any)?.playerTwoName ?? (d as any)?.p2_playerName ?? "";
      base.playerTwoCountry = (d as any)?.playerTwoCountry ?? "";
      base.playerTwoVictory = (d as any)?.playerTwoVictory === undefined ? "" : (d as any)?.playerTwoVictory;
      base.playerTwoFinalHealth = (d as any)?.playerTwoFinalHealth ?? "";
      base.playerTwoStartRating = (d as any)?.playerTwoStartRating ?? (d as any)?.p2_ratingBefore ?? "";
      base.playerTwoEndRating = (d as any)?.playerTwoEndRating ?? (d as any)?.p2_ratingAfter ?? "";
      base.totalRounds = d?.totalRounds ?? "";
      base.damageMultiplierRounds = Array.isArray(d?.damageMultiplierRounds) ? `[${d?.damageMultiplierRounds.join(", ")}]` : "[]";
      base.healingRounds = Array.isArray(d?.healingRounds) ? `[${d?.healingRounds.join(", ")}]` : "[]";
    } else {
      base.teamOneId = (d as any)?.teamOneId ?? "";
      base.teamOneVictory = (d as any)?.teamOneVictory ?? "";
      base.teamOneFinalHealth = (d as any)?.teamOneFinalHealth ?? "";
      base.teamOneStartRating = (d as any)?.teamOneStartRating ?? "";
      base.teamOneEndRating = (d as any)?.teamOneEndRating ?? "";
      base.teamOnePlayerOneId = (d as any)?.teamOnePlayerOneId ?? "";
      base.teamOnePlayerOneName = (d as any)?.teamOnePlayerOneName ?? "";
      base.teamOnePlayerOneCountry = (d as any)?.teamOnePlayerOneCountry ?? "";
      base.teamOnePlayerTwoId = (d as any)?.teamOnePlayerTwoId ?? "";
      base.teamOnePlayerTwoName = (d as any)?.teamOnePlayerTwoName ?? "";
      base.teamOnePlayerTwoCountry = (d as any)?.teamOnePlayerTwoCountry ?? "";
      base.teamTwoId = (d as any)?.teamTwoId ?? "";
      base.teamTwoVictory = (d as any)?.teamTwoVictory ?? "";
      base.teamTwoFinalHealth = (d as any)?.teamTwoFinalHealth ?? "";
      base.teamTwoStartRating = (d as any)?.teamTwoStartRating ?? "";
      base.teamTwoEndRating = (d as any)?.teamTwoEndRating ?? "";
      base.teamTwoPlayerOneId = (d as any)?.teamTwoPlayerOneId ?? "";
      base.teamTwoPlayerOneName = (d as any)?.teamTwoPlayerOneName ?? "";
      base.teamTwoPlayerOneCountry = (d as any)?.teamTwoPlayerOneCountry ?? "";
      base.teamTwoPlayerTwoId = (d as any)?.teamTwoPlayerTwoId ?? "";
      base.teamTwoPlayerTwoName = (d as any)?.teamTwoPlayerTwoName ?? "";
      base.teamTwoPlayerTwoCountry = (d as any)?.teamTwoPlayerTwoCountry ?? "";
      base.totalRounds = d?.totalRounds ?? "";
      base.damageMultiplierRounds = Array.isArray(d?.damageMultiplierRounds) ? `[${d?.damageMultiplierRounds.join(", ")}]` : "[]";
      base.healingRounds = Array.isArray(d?.healingRounds) ? `[${d?.healingRounds.join(", ")}]` : "[]";
    }
    gamesByMode.get(mode)!.push(base);
  }

  const roundsByMode = new Map<string, any[]>();
  for (const r of rounds) {
    const g = gameById.get(r.gameId);
    const mode = exportModeSheetKey(g?.gameMode || g?.mode, g?.modeFamily);
    if (!roundsByMode.has(mode)) roundsByMode.set(mode, []);
    const p1Lat = r.p1_guessLat ?? r.guessLat;
    const p1Lng = r.p1_guessLng ?? r.guessLng;
    const p1Country = await resolveGuessCountryForExport(r.p1_guessCountry, p1Lat, p1Lng);
    const p2Country = await resolveGuessCountryForExport(r.p2_guessCountry, r.p2_guessLat, r.p2_guessLng);
    const p3Country = await resolveGuessCountryForExport(r.p3_guessCountry, r.p3_guessLat, r.p3_guessLng);
    const p4Country = await resolveGuessCountryForExport(r.p4_guessCountry, r.p4_guessLat, r.p4_guessLng);
    const rowBase: any = {
      gameId: r.gameId,
      roundNumber: r.roundNumber,
      startTime: iso(r.startTime),
      endTime: iso(r.endTime),
      durationSeconds: r.durationSeconds ?? "",
      true_country: r.trueCountry ?? "",
      true_lat: r.trueLat ?? "",
      true_lng: r.trueLng ?? "",
      damage_multiplier: r.damageMultiplier ?? "",
      is_healing_round: r.isHealingRound ? 1 : 0,
      p1_playerId: r.p1_playerId ?? "",
      p1_guessLat: r.p1_guessLat ?? r.guessLat ?? "",
      p1_guessLng: r.p1_guessLng ?? r.guessLng ?? "",
      p1_guessCountry: p1Country,
      p1_distance_km: (r as any).p1_distanceKm ?? ((r.p1_distanceMeters ?? r.distanceMeters) !== undefined ? (r.p1_distanceMeters ?? r.distanceMeters)! / 1e3 : ""),
      p1_score: r.p1_score ?? r.score ?? "",
      p1_healthAfter: r.p1_healthAfter ?? "",
      p1_isBestGuess: r.p1_isBestGuess ? 1 : 0,
      p2_playerId: r.p2_playerId ?? "",
      p2_guessLat: r.p2_guessLat ?? "",
      p2_guessLng: r.p2_guessLng ?? "",
      p2_guessCountry: p2Country,
      p2_distance_km: (r as any).p2_distanceKm ?? (r.p2_distanceMeters !== undefined ? r.p2_distanceMeters / 1e3 : ""),
      p2_score: r.p2_score ?? "",
      p2_healthAfter: r.p2_healthAfter ?? "",
      p2_isBestGuess: r.p2_isBestGuess ? 1 : 0,
      healthDiffAfter: (r as any).healthDiffAfter ?? "",
      __sortTs: r.startTime ?? g?.playedAt ?? 0
    };
    const isTeamMode = (mode || "").toLowerCase().includes("team");
    if (isTeamMode) {
      rowBase.p1_teamId = r.p1_teamId ?? "";
      rowBase.p2_teamId = r.p2_teamId ?? "";
      rowBase.p3_playerId = r.p3_playerId ?? "";
      rowBase.p3_teamId = r.p3_teamId ?? "";
      rowBase.p3_guessLat = r.p3_guessLat ?? "";
      rowBase.p3_guessLng = r.p3_guessLng ?? "";
      rowBase.p3_guessCountry = p3Country;
      rowBase.p3_distance_km = (r as any).p3_distanceKm ?? (r.p3_distanceMeters !== undefined ? r.p3_distanceMeters / 1e3 : "");
      rowBase.p3_score = r.p3_score ?? "";
      rowBase.p3_healthAfter = r.p3_healthAfter ?? "";
      rowBase.p3_isBestGuess = r.p3_isBestGuess ? 1 : 0;
      rowBase.p4_playerId = r.p4_playerId ?? "";
      rowBase.p4_teamId = r.p4_teamId ?? "";
      rowBase.p4_guessLat = r.p4_guessLat ?? "";
      rowBase.p4_guessLng = r.p4_guessLng ?? "";
      rowBase.p4_guessCountry = p4Country;
      rowBase.p4_distance_km = (r as any).p4_distanceKm ?? (r.p4_distanceMeters !== undefined ? r.p4_distanceMeters / 1e3 : "");
      rowBase.p4_score = r.p4_score ?? "";
      rowBase.p4_healthAfter = r.p4_healthAfter ?? "";
      rowBase.p4_isBestGuess = r.p4_isBestGuess ? 1 : 0;
    }
    roundsByMode.get(mode)!.push(rowBase);
  }

  const gamesWb = XLSX.utils.book_new();
  for (const [mode, rows] of [...gamesByMode.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const modeRows = [...rows];
    if (modeRows.length > 0 && "__playedAt" in modeRows[0]) {
      modeRows.sort((a, b) => (a.__playedAt || 0) - (b.__playedAt || 0));
      for (let i = 0; i < modeRows.length; i++) modeRows[i].gameNumber = i + 1;
      modeRows.sort((a, b) => (b.__playedAt || 0) - (a.__playedAt || 0));
      for (const r of modeRows) delete r.__playedAt;
    }
    XLSX.utils.book_append_sheet(gamesWb, XLSX.utils.json_to_sheet(modeRows), sanitizeSheetName(mode));
  }

  const statsWb = XLSX.utils.book_new();
  for (const [mode, rows] of [...roundsByMode.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sortedRows = [...rows].sort((a: any, b: any) => {
      const ta = (typeof a.__sortTs === "number" && Number.isFinite(a.__sortTs))
        ? a.__sortTs
        : (toTsMaybe(a.startTime) ?? 0);
      const tb = (typeof b.__sortTs === "number" && Number.isFinite(b.__sortTs))
        ? b.__sortTs
        : (toTsMaybe(b.startTime) ?? 0);
      if (tb !== ta) return tb - ta; // newest first
      const ga = String(a.gameId || "");
      const gb = String(b.gameId || "");
      if (gb !== ga) return gb.localeCompare(ga);
      return Number(b.roundNumber || 0) - Number(a.roundNumber || 0);
    });
    for (const r of sortedRows) delete (r as any).__sortTs;
    XLSX.utils.book_append_sheet(statsWb, XLSX.utils.json_to_sheet(sortedRows), sanitizeSheetName(mode));
  }

  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;

  await downloadWorkbook(gamesWb, `geoguessr_games_${stamp}.xlsx`);
  await downloadWorkbook(statsWb, `geoguessr_stats_${stamp}.xlsx`);
  onStatus(`Export done: ${games.length} games, ${rounds.length} rounds (${gamesByMode.size} mode sheets).`);
}
