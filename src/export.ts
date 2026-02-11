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

function counterObjectToRows(
  category: string,
  counterLike: unknown
): Array<{ category: string; key: string; count: number }> {
  if (!counterLike || typeof counterLike !== "object") return [];
  return Object.entries(counterLike as Record<string, unknown>)
    .map(([key, value]) => ({ category, key, count: Number(value) || 0 }))
    .sort((a, b) => b.count - a.count);
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

function asFiniteNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function buildGoogleMapsUrl(lat?: number, lng?: number): string {
  if (!isLatLngInRange(lat, lng)) return "";
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function buildStreetViewUrl(lat?: number, lng?: number, heading?: number): string {
  if (!isLatLngInRange(lat, lng)) return "";
  const base = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
  if (typeof heading === "number" && Number.isFinite(heading)) {
    return `${base}&heading=${heading}`;
  }
  return base;
}

function exportModeSheetKey(gameMode: string | undefined, modeFamily: string | undefined): string {
  const family = String(modeFamily || "").toLowerCase();
  if (family === "standard") return "standard";
  if (family === "streak") return "streak";
  return gameMode || "unknown";
}

function isDetailsExpected(modeFamily?: string, gameMode?: string): boolean {
  const family = String(modeFamily || "").toLowerCase();
  if (family === "duels" || family === "teamduels") return true;
  const m = String(gameMode || "").toLowerCase();
  return m.includes("duel");
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

  const [games, rounds, details, metaRows] = await Promise.all([
    db.games.orderBy("playedAt").reverse().toArray(),
    db.rounds.toArray(),
    db.details.toArray(),
    db.meta.toArray()
  ]);

  if (games.length === 0) {
    onStatus("No games to export.");
    return;
  }

  const detailsByGame = new Map(details.map((d) => [d.gameId, d]));
  const gameById = new Map(games.map((g) => [g.gameId, g]));
  const metaByKey = new Map(metaRows.map((m) => [m.key, m.value as any]));
  const roundsByGameCount = new Map<string, number>();
  for (const r of rounds) roundsByGameCount.set(r.gameId, (roundsByGameCount.get(r.gameId) || 0) + 1);

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
      base.player_self_id = (d as any)?.player_self_id ?? (d as any)?.playerOneId ?? "";
      base.player_self_name = (d as any)?.player_self_name ?? (d as any)?.playerOneName ?? "";
      base.player_self_country = (d as any)?.player_self_country ?? (d as any)?.playerOneCountry ?? "";
      base.player_self_victory =
        (d as any)?.player_self_victory ?? ((d as any)?.playerOneVictory === undefined ? "" : (d as any)?.playerOneVictory);
      base.player_self_finalHealth = (d as any)?.player_self_finalHealth ?? (d as any)?.playerOneFinalHealth ?? "";
      base.player_self_startRating =
        (d as any)?.player_self_startRating ?? (d as any)?.playerOneStartRating ?? "";
      base.player_self_endRating =
        (d as any)?.player_self_endRating ?? (d as any)?.playerOneEndRating ?? "";
      base.player_opponent_id = (d as any)?.player_opponent_id ?? (d as any)?.playerTwoId ?? "";
      base.player_opponent_name = (d as any)?.player_opponent_name ?? (d as any)?.playerTwoName ?? "";
      base.player_opponent_country = (d as any)?.player_opponent_country ?? (d as any)?.playerTwoCountry ?? "";
      base.player_opponent_victory =
        (d as any)?.player_opponent_victory ?? ((d as any)?.playerTwoVictory === undefined ? "" : (d as any)?.playerTwoVictory);
      base.player_opponent_finalHealth = (d as any)?.player_opponent_finalHealth ?? (d as any)?.playerTwoFinalHealth ?? "";
      base.player_opponent_startRating =
        (d as any)?.player_opponent_startRating ?? (d as any)?.playerTwoStartRating ?? "";
      base.player_opponent_endRating =
        (d as any)?.player_opponent_endRating ?? (d as any)?.playerTwoEndRating ?? "";
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
      base.player_self_id = (d as any)?.player_self_id ?? (d as any)?.teamOnePlayerOneId ?? "";
      base.player_self_name = (d as any)?.player_self_name ?? (d as any)?.teamOnePlayerOneName ?? "";
      base.player_self_country = (d as any)?.player_self_country ?? (d as any)?.teamOnePlayerOneCountry ?? "";
      base.player_self_startRating = (d as any)?.player_self_startRating ?? "";
      base.player_self_endRating = (d as any)?.player_self_endRating ?? "";
      base.player_mate_id = (d as any)?.player_mate_id ?? (d as any)?.teamOnePlayerTwoId ?? "";
      base.player_mate_name = (d as any)?.player_mate_name ?? (d as any)?.teamOnePlayerTwoName ?? "";
      base.player_mate_country = (d as any)?.player_mate_country ?? (d as any)?.teamOnePlayerTwoCountry ?? "";
      base.player_mate_startRating = (d as any)?.player_mate_startRating ?? "";
      base.player_mate_endRating = (d as any)?.player_mate_endRating ?? "";
      base.player_opponent_id = (d as any)?.player_opponent_id ?? (d as any)?.teamTwoPlayerOneId ?? "";
      base.player_opponent_name = (d as any)?.player_opponent_name ?? (d as any)?.teamTwoPlayerOneName ?? "";
      base.player_opponent_country = (d as any)?.player_opponent_country ?? (d as any)?.teamTwoPlayerOneCountry ?? "";
      base.player_opponent_startRating = (d as any)?.player_opponent_startRating ?? "";
      base.player_opponent_endRating = (d as any)?.player_opponent_endRating ?? "";
      base.player_opponent_mate_id = (d as any)?.player_opponent_mate_id ?? (d as any)?.teamTwoPlayerTwoId ?? "";
      base.player_opponent_mate_name = (d as any)?.player_opponent_mate_name ?? (d as any)?.teamTwoPlayerTwoName ?? "";
      base.player_opponent_mate_country = (d as any)?.player_opponent_mate_country ?? (d as any)?.teamTwoPlayerTwoCountry ?? "";
      base.player_opponent_mate_startRating = (d as any)?.player_opponent_mate_startRating ?? "";
      base.player_opponent_mate_endRating = (d as any)?.player_opponent_mate_endRating ?? "";
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
    const selfLat = (r as any).player_self_guessLat;
    const selfLng = (r as any).player_self_guessLng;
    const selfCountry = await resolveGuessCountryForExport((r as any).player_self_guessCountry, selfLat, selfLng);
    const mateCountry = await resolveGuessCountryForExport((r as any).player_mate_guessCountry, (r as any).player_mate_guessLat, (r as any).player_mate_guessLng);
    const oppCountry = await resolveGuessCountryForExport((r as any).player_opponent_guessCountry, (r as any).player_opponent_guessLat, (r as any).player_opponent_guessLng);
    const oppMateCountry = await resolveGuessCountryForExport((r as any).player_opponent_mate_guessCountry, (r as any).player_opponent_mate_guessLat, (r as any).player_opponent_mate_guessLng);
    const trueHeading = asFiniteNumber(
      pickFirst((r as any).raw, [
        "panorama.heading",
        "panorama.bearing",
        "panorama.rotation",
        "heading",
        "bearing",
        "rotation"
      ])
    );
    const rowBase: any = {
      gameId: r.gameId,
      roundNumber: r.roundNumber,
      startTime: iso(r.startTime),
      endTime: iso(r.endTime),
      durationSeconds: r.durationSeconds ?? "",
      true_country: r.trueCountry ?? "",
      true_lat: r.trueLat ?? "",
      true_lng: r.trueLng ?? "",
      true_heading_deg: trueHeading ?? "",
      true_googleMaps_url: buildGoogleMapsUrl(r.trueLat, r.trueLng),
      true_streetView_url: buildStreetViewUrl(r.trueLat, r.trueLng, trueHeading),
      damage_multiplier: r.damageMultiplier ?? "",
      is_healing_round: r.isHealingRound ? 1 : 0,
      player_self_playerId: (r as any).player_self_playerId ?? "",
      player_self_guessLat: selfLat ?? "",
      player_self_guessLng: selfLng ?? "",
      player_self_googleMaps_url: buildGoogleMapsUrl(selfLat, selfLng),
      player_self_guessCountry: selfCountry,
      player_self_distance_km: (r as any).player_self_distanceKm ?? "",
      player_self_score: (r as any).player_self_score ?? "",
      player_self_healthAfter: (r as any).player_self_healthAfter ?? "",
      player_self_isBestGuess: (r as any).player_self_isBestGuess ? 1 : 0,
      player_opponent_playerId: (r as any).player_opponent_playerId ?? "",
      player_opponent_guessLat: (r as any).player_opponent_guessLat ?? "",
      player_opponent_guessLng: (r as any).player_opponent_guessLng ?? "",
      player_opponent_googleMaps_url: buildGoogleMapsUrl((r as any).player_opponent_guessLat, (r as any).player_opponent_guessLng),
      player_opponent_guessCountry: await resolveGuessCountryForExport(
        (r as any).player_opponent_guessCountry,
        (r as any).player_opponent_guessLat,
        (r as any).player_opponent_guessLng
      ),
      player_opponent_distance_km: (r as any).player_opponent_distanceKm ?? "",
      player_opponent_score: (r as any).player_opponent_score ?? "",
      player_opponent_healthAfter: (r as any).player_opponent_healthAfter ?? "",
      player_opponent_isBestGuess: (r as any).player_opponent_isBestGuess ? 1 : 0,
      healthDiffAfter: (r as any).healthDiffAfter ?? "",
      __sortTs: r.startTime ?? g?.playedAt ?? 0
    };
    const isTeamMode = (mode || "").toLowerCase().includes("team");
    if (isTeamMode) {
      rowBase.player_self_teamId = (r as any).player_self_teamId ?? "";
      rowBase.player_mate_playerId = (r as any).player_mate_playerId ?? "";
      rowBase.player_mate_teamId = (r as any).player_mate_teamId ?? "";
      rowBase.player_mate_guessLat = (r as any).player_mate_guessLat ?? "";
      rowBase.player_mate_guessLng = (r as any).player_mate_guessLng ?? "";
      rowBase.player_mate_googleMaps_url = buildGoogleMapsUrl((r as any).player_mate_guessLat, (r as any).player_mate_guessLng);
      rowBase.player_mate_guessCountry = mateCountry;
      rowBase.player_mate_distance_km = (r as any).player_mate_distanceKm ?? "";
      rowBase.player_mate_score = (r as any).player_mate_score ?? "";
      rowBase.player_mate_healthAfter = (r as any).player_mate_healthAfter ?? "";
      rowBase.player_mate_isBestGuess = (r as any).player_mate_isBestGuess ? 1 : 0;
      rowBase.player_opponent_playerId = (r as any).player_opponent_playerId ?? "";
      rowBase.player_opponent_teamId = (r as any).player_opponent_teamId ?? "";
      rowBase.player_opponent_guessLat = (r as any).player_opponent_guessLat ?? "";
      rowBase.player_opponent_guessLng = (r as any).player_opponent_guessLng ?? "";
      rowBase.player_opponent_googleMaps_url = buildGoogleMapsUrl((r as any).player_opponent_guessLat, (r as any).player_opponent_guessLng);
      rowBase.player_opponent_guessCountry = oppCountry;
      rowBase.player_opponent_distance_km = (r as any).player_opponent_distanceKm ?? "";
      rowBase.player_opponent_score = (r as any).player_opponent_score ?? "";
      rowBase.player_opponent_healthAfter = (r as any).player_opponent_healthAfter ?? "";
      rowBase.player_opponent_isBestGuess = (r as any).player_opponent_isBestGuess ? 1 : 0;
      rowBase.player_opponent_mate_playerId = (r as any).player_opponent_mate_playerId ?? "";
      rowBase.player_opponent_mate_teamId = (r as any).player_opponent_mate_teamId ?? "";
      rowBase.player_opponent_mate_guessLat = (r as any).player_opponent_mate_guessLat ?? "";
      rowBase.player_opponent_mate_guessLng = (r as any).player_opponent_mate_guessLng ?? "";
      rowBase.player_opponent_mate_googleMaps_url = buildGoogleMapsUrl((r as any).player_opponent_mate_guessLat, (r as any).player_opponent_mate_guessLng);
      rowBase.player_opponent_mate_guessCountry = oppMateCountry;
      rowBase.player_opponent_mate_distance_km = (r as any).player_opponent_mate_distanceKm ?? "";
      rowBase.player_opponent_mate_score = (r as any).player_opponent_mate_score ?? "";
      rowBase.player_opponent_mate_healthAfter = (r as any).player_opponent_mate_healthAfter ?? "";
      rowBase.player_opponent_mate_isBestGuess = (r as any).player_opponent_mate_isBestGuess ? 1 : 0;
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

  const modeFamilyCounts = new Map<string, number>();
  const exportModeCounts = new Map<string, number>();
  for (const g of games) {
    const family = String(g.modeFamily || "unknown");
    modeFamilyCounts.set(family, (modeFamilyCounts.get(family) || 0) + 1);
    const modeKey = exportModeSheetKey(g.gameMode || g.mode, g.modeFamily);
    exportModeCounts.set(modeKey, (exportModeCounts.get(modeKey) || 0) + 1);
  }
  const roundsByModeCounts = new Map<string, number>();
  for (const r of rounds) {
    const g = gameById.get(r.gameId);
    const mode = exportModeSheetKey(g?.gameMode || g?.mode, g?.modeFamily);
    roundsByModeCounts.set(mode, (roundsByModeCounts.get(mode) || 0) + 1);
  }
  const gamesWithoutDetails = games.filter((g) => !detailsByGame.has(g.gameId)).length;
  const expectedDetailGames = games.filter((g) => isDetailsExpected(g.modeFamily, g.gameMode || g.mode));
  const expectedWithDetails = expectedDetailGames.filter((g) => detailsByGame.has(g.gameId));
  const expectedWithoutDetails = expectedDetailGames.filter((g) => !detailsByGame.has(g.gameId));
  const expectedStatusCounts = { ok: 0, missing: 0, error: 0, no_row: 0 };
  for (const g of expectedDetailGames) {
    const d = detailsByGame.get(g.gameId);
    if (!d) {
      expectedStatusCounts.no_row++;
      continue;
    }
    if (d.status === "ok") expectedStatusCounts.ok++;
    else if (d.status === "missing") expectedStatusCounts.missing++;
    else if (d.status === "error") expectedStatusCounts.error++;
    else expectedStatusCounts.no_row++;
  }
  const roundsWithoutGame = rounds.filter((r) => !gameById.has(r.gameId)).length;
  const syncDebug = metaByKey.get("syncDebugLast") || {};
  const syncPageDiagnosticsRaw = Array.isArray(syncDebug.pageDiagnostics) ? syncDebug.pageDiagnostics : [];
  const syncDroppedSamplesRaw = Array.isArray(syncDebug.droppedEventSamples) ? syncDebug.droppedEventSamples : [];
  const syncPageDiagnostics = syncPageDiagnosticsRaw.map((p: any) => ({
    ...p,
    newestPlayedAtIso: iso(p?.newestPlayedAt),
    oldestPlayedAtIso: iso(p?.oldestPlayedAt)
  }));
  const syncDroppedSamples = syncDroppedSamplesRaw.map((r: any) => ({
    ...r,
    timeCandidateParsedIso: iso(toTsMaybe(r?.timeCandidate))
  }));
  const diagnosticsSyncCounters = [
    ...counterObjectToRows("sync_id_source", syncDebug.idSourceCounts),
    ...counterObjectToRows("sync_drop_reason", syncDebug.dropReasonCounts),
    ...counterObjectToRows("sync_drop_type", syncDebug.dropTypeCounts)
  ];

  const diagnosticsSummary = [
    { metric: "export_generated_at", value: new Date().toISOString() },
    { metric: "db_games_total", value: games.length },
    { metric: "db_rounds_total", value: rounds.length },
    { metric: "db_details_total", value: details.length },
    { metric: "games_without_details", value: gamesWithoutDetails },
    { metric: "details_expected_games", value: expectedDetailGames.length },
    { metric: "details_expected_with_row", value: expectedWithDetails.length },
    { metric: "details_expected_without_row", value: expectedWithoutDetails.length },
    { metric: "details_expected_status_ok", value: expectedStatusCounts.ok },
    { metric: "details_expected_status_missing", value: expectedStatusCounts.missing },
    { metric: "details_expected_status_error", value: expectedStatusCounts.error },
    { metric: "details_expected_status_no_row", value: expectedStatusCounts.no_row },
    { metric: "rounds_without_game_row", value: roundsWithoutGame },
    { metric: "export_mode_sheet_count", value: gamesByMode.size },
    { metric: "sync_break_reason", value: syncDebug.breakReason ?? "" },
    { metric: "sync_pages_fetched", value: syncDebug.pagesFetched ?? "" },
    { metric: "sync_max_pages", value: syncDebug.maxPages ?? "" },
    { metric: "sync_entries_seen", value: syncDebug.entriesSeen ?? "" },
    { metric: "sync_events_seen", value: syncDebug.eventsSeen ?? "" },
    { metric: "sync_rows_with_gameId", value: syncDebug.rowsWithGameId ?? "" },
    { metric: "sync_deduped_rows", value: syncDebug.dedupedRows ?? "" },
    { metric: "sync_inserted_rows", value: syncDebug.insertedRows ?? "" },
    { metric: "sync_total_games_after_sync", value: syncDebug.totalGamesAfterSync ?? "" },
    { metric: "sync_lastSeen_before_sync", value: syncDebug.lastSeenBeforeSync ?? "" },
    { metric: "sync_elapsed_ms", value: syncDebug.elapsedMs ?? "" },
    { metric: "sync_dropped_samples_exported", value: syncDroppedSamples.length },
    { metric: "sync_pages_diagnostics_exported", value: syncPageDiagnostics.length },
    {
      metric: "hint",
      value:
        "For missing games, inspect Diagnostics_SyncPages, Diagnostics_SyncCounters and Diagnostics_DroppedEvents."
    },
    {
      metric: "hint",
      value:
        "If duel/teamduel details are missing, inspect Diagnostics_DetailCoverage for per-game reason/error/endpoint."
    }
  ];
  const diagnosticsModeRows = [
    ...[...modeFamilyCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([modeFamily, count]) => ({ category: "mode_family", key: modeFamily, count })),
    ...[...exportModeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([mode, count]) => ({ category: "export_mode", key: mode, count })),
    ...[...roundsByModeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([mode, count]) => ({ category: "rounds_mode", key: mode, count }))
  ];
  XLSX.utils.book_append_sheet(gamesWb, XLSX.utils.json_to_sheet(diagnosticsSummary), sanitizeSheetName("Diagnostics"));
  XLSX.utils.book_append_sheet(gamesWb, XLSX.utils.json_to_sheet(diagnosticsModeRows), sanitizeSheetName("Diagnostics_Modes"));
  XLSX.utils.book_append_sheet(
    gamesWb,
    XLSX.utils.json_to_sheet(diagnosticsSyncCounters),
    sanitizeSheetName("Diagnostics_SyncCounters")
  );
  XLSX.utils.book_append_sheet(
    gamesWb,
    XLSX.utils.json_to_sheet(syncPageDiagnostics),
    sanitizeSheetName("Diagnostics_SyncPages")
  );
  XLSX.utils.book_append_sheet(
    gamesWb,
    XLSX.utils.json_to_sheet(syncDroppedSamples),
    sanitizeSheetName("Diagnostics_DroppedEvents")
  );

  const diagnosticsDetailCoverage = games
    .map((g) => {
      const d = detailsByGame.get(g.gameId);
      const expected = isDetailsExpected(g.modeFamily, g.gameMode || g.mode);
      const status = d?.status || "no_row";
      const reason = !expected
        ? "details_not_applicable_for_mode"
        : status === "ok"
          ? "ok"
          : status === "missing"
            ? "marked_missing_by_fetcher"
            : status === "error"
              ? "fetch_or_parse_error"
              : "details_row_not_created";
      return {
        gameId: g.gameId,
        playedAt: iso(g.playedAt),
        modeFamily: g.modeFamily || "",
        gameMode: g.gameMode || g.mode || "",
        detailsExpected: expected ? 1 : 0,
        detailsStatus: status,
        reason,
        detailsFetchedAt: iso(d?.fetchedAt),
        detailsEndpoint: d?.endpoint || "",
        detailsError: d?.error || "",
        roundsStored: roundsByGameCount.get(g.gameId) || 0
      };
    })
    .sort((a, b) => {
      if (a.detailsExpected !== b.detailsExpected) return b.detailsExpected - a.detailsExpected;
      if (a.detailsStatus !== b.detailsStatus) return a.detailsStatus.localeCompare(b.detailsStatus);
      return String(b.playedAt).localeCompare(String(a.playedAt));
    });
  XLSX.utils.book_append_sheet(
    gamesWb,
    XLSX.utils.json_to_sheet(diagnosticsDetailCoverage),
    sanitizeSheetName("Diagnostics_DetailCoverage")
  );

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
  XLSX.utils.book_append_sheet(statsWb, XLSX.utils.json_to_sheet(diagnosticsSummary), sanitizeSheetName("Diagnostics"));
  XLSX.utils.book_append_sheet(statsWb, XLSX.utils.json_to_sheet(diagnosticsModeRows), sanitizeSheetName("Diagnostics_Modes"));
  XLSX.utils.book_append_sheet(
    statsWb,
    XLSX.utils.json_to_sheet(diagnosticsSyncCounters),
    sanitizeSheetName("Diagnostics_SyncCounters")
  );
  XLSX.utils.book_append_sheet(
    statsWb,
    XLSX.utils.json_to_sheet(syncPageDiagnostics),
    sanitizeSheetName("Diagnostics_SyncPages")
  );
  XLSX.utils.book_append_sheet(
    statsWb,
    XLSX.utils.json_to_sheet(syncDroppedSamples),
    sanitizeSheetName("Diagnostics_DroppedEvents")
  );
  XLSX.utils.book_append_sheet(
    statsWb,
    XLSX.utils.json_to_sheet(diagnosticsDetailCoverage),
    sanitizeSheetName("Diagnostics_DetailCoverage")
  );

  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;

  await downloadWorkbook(gamesWb, `geoguessr_games_${stamp}.xlsx`);
  await downloadWorkbook(statsWb, `geoguessr_stats_${stamp}.xlsx`);
  onStatus(`Export done: ${games.length} games, ${rounds.length} rounds (${gamesByMode.size} mode sheets).`);
}
