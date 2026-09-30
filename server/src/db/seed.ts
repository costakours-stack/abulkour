// Snapshot of the slow-to-rebuild state: daily price history and the active
// trained models. Hosts with a temporary disk (e.g. Render's free plan) start
// from this snapshot instead of re-downloading history and retraining.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import type { DB } from "./database.js";

interface Seed {
  createdAt: number;
  dailyBars: unknown[];
  historySync: unknown[];
  models: unknown[];
}

export function exportSeed(db: DB, path: string) {
  const seed: Seed = {
    createdAt: Date.now(),
    dailyBars: db.prepare("SELECT symbol, date, t, o, h, l, c, v, source FROM daily_bars").all(),
    historySync: db.prepare("SELECT symbol, source, synced_at FROM history_sync").all(),
    models: db.prepare("SELECT version, created_at, active, body, horizon FROM ml_models WHERE active = 1").all(),
  };
  writeFileSync(path, gzipSync(JSON.stringify(seed)));
  return { bars: seed.dailyBars.length, models: seed.models.length };
}

/** Loads the snapshot only into an empty database. Returns what was loaded, or null. */
export function importSeedIfEmpty(db: DB, path: string) {
  if (!existsSync(path)) return null;
  const has = (db.prepare("SELECT COUNT(*) AS n FROM daily_bars").get() as { n: number }).n;
  if (has > 0) return null;
  const seed = JSON.parse(gunzipSync(readFileSync(path)).toString()) as Seed;
  db.exec("BEGIN");
  try {
    const bar = db.prepare("INSERT OR REPLACE INTO daily_bars (symbol, date, t, o, h, l, c, v, source) VALUES (?,?,?,?,?,?,?,?,?)");
    for (const b of seed.dailyBars as any[]) bar.run(b.symbol, b.date, b.t, b.o, b.h, b.l, b.c, b.v, b.source);
    const hs = db.prepare("INSERT OR REPLACE INTO history_sync (symbol, source, synced_at) VALUES (?,?,?)");
    for (const s of seed.historySync as any[]) hs.run(s.symbol, s.source, s.synced_at);
    const m = db.prepare("INSERT OR REPLACE INTO ml_models (version, created_at, active, body, horizon) VALUES (?,?,?,?,?)");
    for (const x of seed.models as any[]) m.run(x.version, x.created_at, x.active, x.body, x.horizon);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { bars: seed.dailyBars.length, models: seed.models.length, snapshotAt: seed.createdAt };
}
