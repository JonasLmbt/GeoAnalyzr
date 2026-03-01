import Dexie, { type Table } from "dexie";

export type AdminLevelKey = string; // `${iso3}:${ADM}`

export type AdminGeoJsonCacheRow = {
  levelKey: AdminLevelKey;
  iso2: string;
  iso3: string;
  adm: string; // e.g. "ADM1"
  featureKey: string;
  geojson: any;
  byteSize: number;
  savedAt: number;
};

export type AdminRoundLabelCacheRow = {
  id: string; // `${levelKey}:${gameId}:${roundNumber}`
  levelKey: AdminLevelKey;
  gameId: string;
  roundNumber: number;
  trueUnit: string;
  guessUnit: string;
  updatedAt: number;
};

export class AdminCacheDB extends Dexie {
  geojson!: Table<AdminGeoJsonCacheRow, string>;
  labels!: Table<AdminRoundLabelCacheRow, string>;

  constructor() {
    super("gg_analyzer_admin_cache");
    this.version(1).stores({
      geojson: "levelKey, iso3, iso2, adm, savedAt",
      labels: "id, levelKey, gameId, roundNumber, updatedAt"
    });
  }
}

export const adminCacheDb = new AdminCacheDB();

