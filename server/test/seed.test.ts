import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDatabase } from "../src/db/database.js";
import { exportSeed, importSeedIfEmpty } from "../src/db/seed.js";
import { HistoryStore } from "../src/history/HistoryStore.js";
import { ModelRegistry } from "../src/ml/ModelRegistry.js";

test("snapshot restores history and active models into an empty database, and only then", () => {
  const path = join(mkdtempSync(join(tmpdir(), "seed-")), "seed.json.gz");
  const a = openDatabase(":memory:");
  const ha = new HistoryStore(a, null, null);
  const ra = new ModelRegistry(a);
  ha.importBars("AAPL", [{ t: Date.UTC(2026, 0, 5, 5), o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }], "test");
  ra.save({ version: "m5", createdAt: 1, kind: "gbdt", horizon: 5, dataSource: "test", trainStart: 0, trainEnd: 1, symbols: [], features: [],
    model: { base: 0, learningRate: 0.1, trees: [], nFeatures: 0, importance: [] }, calibration: { magnitudeScale: 0, a: 0, b: 0 },
    metrics: { folds: [], overall: { testRows: 0, hitRate: 0, baselineHitRate: 0, ic: 0, maeReturnPct: 0 }, topFeatures: [], bySymbol: {} } });
  assert.deepEqual(exportSeed(a, path), { bars: 1, models: 1 });

  const b = openDatabase(":memory:");
  const hb = new HistoryStore(b, null, null);
  const rb = new ModelRegistry(b);
  assert.equal(importSeedIfEmpty(b, path)?.bars, 1);
  assert.equal(hb.bars("AAPL").length, 1);
  assert.equal(rb.active(5)?.version, "m5");
  assert.equal(importSeedIfEmpty(b, path), null, "never overwrites existing data");
});
