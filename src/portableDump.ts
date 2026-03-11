import { gunzip, gzip, strFromU8, strToU8 } from "fflate";
import { db, type FeedGameRow, type GameAggRow, type GameRow, type MetaRow, type RoundRow } from "./db";

export type PortableDumpFormat = "geoanalyzr-portable";

export type PortableDumpV1 = {
  format: PortableDumpFormat;
  formatVersion: 1;
  createdAt: number;
  appVersion?: string;
  dbName: string;
  dbSchemaVersion: number;
  options: {
    compact: boolean;
    includeAggregates: boolean;
    includeMeta: boolean;
  };
  data: {
    games: FeedGameRow[];
    rounds: RoundRow[];
    details: GameRow[];
    gameAgg?: GameAggRow[];
    meta?: MetaRow[];
  };
};

type ExportOptions = {
  compact: boolean;
  includeAggregates: boolean;
  includeMeta: boolean;
};

type SerializeOptions = {
  gzip: boolean;
};

const DB_NAME = "gg_analyzer_db";
const DB_SCHEMA_VERSION = 5;

const COMPACT_DROP_KEYS = new Set<string>([
  "raw",
  "trueLocationKey",
  "trueLocationRepeat",
  "trueState",
  "trueDistrict",
  "trueUsState",
  "trueCaProvince",
  "trueIdProvince",
  "trueIdKabupaten",
  "truePhProvince",
  "trueVnProvince"
]);

function compactRecord<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === undefined) continue;
    if (COMPACT_DROP_KEYS.has(key)) continue;
    if (key.endsWith("_guessCountry")) continue;
    out[key] = value;
  }
  return out as T;
}

function getUserscriptVersion(): string | undefined {
  const anyGlobal = globalThis as any;
  const info = anyGlobal?.GM_info;
  const v = info?.script?.version;
  return typeof v === "string" ? v : undefined;
}

function chunkArray<T>(arr: T[], chunkSize: number): T[][] {
  if (arr.length === 0) return [];
  const size = Math.max(1, chunkSize | 0);
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

export async function buildPortableDump(opts: ExportOptions): Promise<PortableDumpV1> {
  const [games, rounds, details, gameAgg, meta] = await Promise.all([
    db.games.toArray(),
    db.rounds.toArray(),
    db.details.toArray(),
    opts.includeAggregates ? db.gameAgg.toArray() : Promise.resolve([] as GameAggRow[]),
    opts.includeMeta ? db.meta.toArray() : Promise.resolve([] as MetaRow[])
  ]);

  const dump: PortableDumpV1 = {
    format: "geoanalyzr-portable",
    formatVersion: 1,
    createdAt: Date.now(),
    appVersion: getUserscriptVersion(),
    dbName: DB_NAME,
    dbSchemaVersion: DB_SCHEMA_VERSION,
    options: {
      compact: opts.compact,
      includeAggregates: opts.includeAggregates,
      includeMeta: opts.includeMeta
    },
    data: {
      games: opts.compact ? games.map(compactRecord) : games,
      rounds: opts.compact ? rounds.map(compactRecord) : rounds,
      details: opts.compact ? details.map(compactRecord) : details,
      ...(opts.includeAggregates ? { gameAgg: opts.compact ? gameAgg.map(compactRecord) : gameAgg } : {}),
      ...(opts.includeMeta ? { meta: opts.compact ? meta.map(compactRecord) : meta } : {})
    }
  };

  return dump;
}

export async function serializePortableDump(
  dump: PortableDumpV1,
  opts: SerializeOptions
): Promise<{ bytes: Uint8Array; mime: string; ext: string }> {
  const json = JSON.stringify(dump);
  if (!opts.gzip) {
    return { bytes: strToU8(json), mime: "application/json", ext: "json" };
  }
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    gzip(strToU8(json), { level: 6 }, (err, out) => {
      if (err) reject(err);
      else resolve(out);
    });
  });
  return { bytes, mime: "application/gzip", ext: "json.gz" };
}

export async function parsePortableDumpBytes(bytes: Uint8Array): Promise<PortableDumpV1> {
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  const raw = isGzip
    ? await new Promise<Uint8Array>((resolve, reject) => {
        gunzip(bytes, (err, out) => {
          if (err) reject(err);
          else resolve(out);
        });
      })
    : bytes;
  const text = strFromU8(raw);
  const parsed = JSON.parse(text) as PortableDumpV1;
  if (!parsed || parsed.format !== "geoanalyzr-portable" || parsed.formatVersion !== 1) {
    throw new Error("Unsupported dump file (expected GeoAnalyzr portable dump v1).");
  }
  return parsed;
}

export async function replaceDatabaseFromPortableDump(dump: PortableDumpV1): Promise<void> {
  if (dump.format !== "geoanalyzr-portable" || dump.formatVersion !== 1) {
    throw new Error("Unsupported dump file.");
  }

  // Drop any open connections first, then delete the DB.
  try {
    db.close();
  } catch {
    // ignore
  }
  await db.delete();
  await db.open();

  const games = dump.data.games ?? [];
  const rounds = dump.data.rounds ?? [];
  const details = dump.data.details ?? [];
  const gameAgg = dump.data.gameAgg ?? [];
  const meta = dump.data.meta ?? [];

  const fetchRanKey = "fetch_data_ran_v1";
  const hasFetchRan = meta.some((m) => m?.key === fetchRanKey);
  const metaWithFetchRan = hasFetchRan
    ? meta
    : meta.concat([{ key: fetchRanKey, value: { doneAt: Date.now(), inferred: true }, updatedAt: Date.now() } as MetaRow]);

  await db.transaction("rw", db.games, db.rounds, db.details, db.gameAgg, db.meta, async () => {
    // Insert in chunks to keep transactions responsive on large datasets.
    for (const chunk of chunkArray(games, 2000)) await db.games.bulkPut(chunk);
    for (const chunk of chunkArray(rounds, 2000)) await db.rounds.bulkPut(chunk);
    for (const chunk of chunkArray(details, 2000)) await db.details.bulkPut(chunk);
    for (const chunk of chunkArray(gameAgg, 2000)) await db.gameAgg.bulkPut(chunk);
    for (const chunk of chunkArray(metaWithFetchRan, 2000)) await db.meta.bulkPut(chunk);
  });
}

