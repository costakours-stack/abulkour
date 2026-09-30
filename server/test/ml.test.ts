import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "../src/db/database.js";
import type { Candle, StoredArticle } from "../src/domain/types.js";
import { HistoryStore } from "../src/history/HistoryStore.js";
import { explain, fit, predict } from "../src/ml/gbdt.js";
import { ModelRegistry } from "../src/ml/ModelRegistry.js";
import { buildFeatureRows, FEATURE_NAMES, WARMUP } from "../src/ml/technicalFeatures.js";
import { Trainer, inferTechnical } from "../src/ml/Trainer.js";
import { NewsImpactModel } from "../src/news/NewsImpactModel.js";
import { TopPicksScanner } from "../src/prediction/TopPicksScanner.js";

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Random-walk bars starting 2010-01-04 (weekdays only). */
function walk(n: number, seed: number, drift = 0): Candle[] {
  const r = seeded(seed);
  const out: Candle[] = [];
  let c = 100;
  let t = Date.UTC(2010, 0, 4, 5);
  while (out.length < n) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) {
      const ret = drift + (r() - 0.5) * 0.03;
      const o = c;
      c = c * (1 + ret);
      out.push({ t, o, h: Math.max(o, c) * 1.005, l: Math.min(o, c) * 0.995, c, v: 1e6 * (0.5 + r()) });
    }
    t += 86_400_000;
  }
  return out;
}

test("gbdt learns a simple nonlinear function", async () => {
  const r = seeded(1);
  const X: Float64Array[] = [];
  const y: number[] = [];
  for (let i = 0; i < 4000; i++) {
    const a = r() * 2 - 1, b = r() * 2 - 1;
    X.push(Float64Array.from([a, b, r()]));
    y.push((a > 0 ? 1 : -1) + 0.5 * b);
  }
  const m = await fit(X, Float64Array.from(y), { nTrees: 60, minLeaf: 20, learningRate: 0.2 });
  assert.ok(predict(m, [0.5, 0, 0.5]) > 0.6);
  assert.ok(predict(m, [-0.5, 0, 0.5]) < -0.6);
});

test("feature rows only use bars up to the row's own date", () => {
  const bars = walk(400, 3);
  const full = buildFeatureRows(bars, null);
  // recompute the row for day i with the future removed: must be identical
  const i = WARMUP + 50;
  const truncated = buildFeatureRows(bars.slice(0, i + 1), null, true)[0];
  const fromFull = full.find((r) => r.t === bars[i].t)!;
  assert.deepEqual(Array.from(truncated.x), Array.from(fromFull.x));
  assert.equal(fromFull.x.length, FEATURE_NAMES.length);
  assert.ok(Number.isNaN(buildFeatureRows(bars, null).at(-1)!.nextRet), "last row has no known target");
});

test("walk-forward folds never train on the test period", async () => {
  const db = openDatabase(":memory:");
  const history = new HistoryStore(db, null, null);
  history.importBars("SPY", walk(1400, 10, 0.0003), "test");
  for (let k = 0; k < 6; k++) history.importBars(`S${k}`, walk(1400, 20 + k), "test");
  const registry = new ModelRegistry(db);
  const trainer = new Trainer(history, registry);
  const m = await trainer.train(["SPY", "S0", "S1", "S2", "S3", "S4", "S5"], "test", { nTrees: 20, minLeaf: 50 });
  assert.ok(m.metrics.folds.length > 0);
  for (const f of m.metrics.folds) assert.ok(f.trainRows > 0 && f.testRows > 0);
  // Random walks are unpredictable: an honest evaluation must not show a big edge.
  assert.ok(Math.abs(m.metrics.overall.hitRate - 0.5) < 0.06, `hit rate ${m.metrics.overall.hitRate}`);
  assert.equal(registry.active()?.version, m.version);
  const row = buildFeatureRows(history.bars("S0"), null, true)[0];
  const out = inferTechnical(m, row);
  assert.ok(out.probabilityUp > 0 && out.probabilityUp < 1);
});

test("news impact: positive high-impact news gives a positive estimate, scaled by volatility", () => {
  const db = openDatabase(":memory:");
  const history = new HistoryStore(db, null, null);
  history.importBars("AAPL", walk(60, 5), "test");
  const model = new NewsImpactModel(history);
  const a = {
    id: "x", relations: [{ symbol: "AAPL", relation: "direct", label: "" }],
    analysis: {
      sentiment: "positive", sentimentScore: 0.8, relevanceScore: 0.9, impact: "high", relatedSymbols: ["AAPL"], summary: "",
      reason: "", category: "earnings", symbolImpacts: [{ symbol: "AAPL", direction: "positive", confidence: 0.7 }], analyzer: "t", analyzedAt: 0,
    },
  } as unknown as StoredArticle;
  const e = model.estimate(a, "AAPL")!;
  assert.equal(e.direction, "up");
  assert.ok(e.estMovePct > 0 && e.lowPct < e.estMovePct && e.highPct > e.estMovePct);
  const neg = { ...a, analysis: { ...a.analysis!, sentimentScore: -0.8, symbolImpacts: [{ symbol: "AAPL", direction: "negative", confidence: 0.7 }] } } as StoredArticle;
  assert.ok(model.estimate(neg, "AAPL")!.estMovePct < 0);

  // 50 outlets covering the same event count once; many distinct events are capped
  const single = model.estimate(a, "AAPL")!.estMovePct;
  const sameEvent = Array.from({ length: 50 }, (_, i) => ({ ...a, id: `s${i}`, clusterId: "c1" }) as StoredArticle);
  assert.equal(model.aggregate("AAPL", sameEvent).pct, single);
  const manyEvents = Array.from({ length: 50 }, (_, i) => ({ ...a, id: `m${i}`, clusterId: `c${i}` }) as StoredArticle);
  assert.ok(model.aggregate("AAPL", manyEvents).pct <= model.vol20("AAPL") * 100 * 1.5 + 0.005);
});

test("explanations add up exactly to the prediction", async () => {
  const r = seeded(9);
  const X: Float64Array[] = [];
  const y: number[] = [];
  for (let i = 0; i < 2000; i++) {
    const a = r(), b = r();
    X.push(Float64Array.from([a, b]));
    y.push(a * 2 - b);
  }
  const m = await fit(X, Float64Array.from(y), { nTrees: 30, minLeaf: 20 });
  const x = [0.3, 0.8];
  const e = explain(m, x);
  assert.ok(Math.abs(e.base + e.perFeature.reduce((s, v) => s + v, 0) - predict(m, x)) < 1e-9);
});

test("5-day model trains with non-overlapping train/test targets and gives a likely range", async () => {
  const db = openDatabase(":memory:");
  const history = new HistoryStore(db, null, null);
  history.importBars("SPY", walk(1400, 10, 0.0003), "test");
  for (let k = 0; k < 6; k++) history.importBars(`S${k}`, walk(1400, 40 + k), "test");
  const registry = new ModelRegistry(db);
  const m = await new Trainer(history, registry).train(["SPY", "S0", "S1", "S2", "S3", "S4", "S5"], "test", { nTrees: 15, minLeaf: 50 }, 5);
  assert.equal(m.horizon, 5);
  assert.equal(registry.active(5)?.version, m.version);
  assert.equal(registry.active(1), null, "horizons are stored separately");
  const out = inferTechnical(m, buildFeatureRows(history.bars("S0"), null, true)[0]);
  assert.ok(out.lowPct < out.predictedReturnPct && out.highPct > out.predictedReturnPct);
  // 80% range should cover roughly 80% of out-of-sample outcomes
  assert.ok(Math.abs((m.metrics.overall.bandCoverage ?? 0) - 0.8) < 0.08);
});

test("top picks: ranked by estimate, positive only, scans are append-only", async () => {
  const db = openDatabase(":memory:");
  const history = new HistoryStore(db, null, null);
  const syms = ["SPY", "A1", "A2", "A3"];
  syms.forEach((s, i) => history.importBars(s, walk(400, 70 + i), "test"));
  const est: Record<string, number> = { SPY: 0.2, A1: 0.9, A2: -0.4, A3: 0.5 };
  const fakeForecaster = {
    forecast: (s: string) => ({
      symbol: s, asOf: Date.now(), basePrice: 100, marketDataTimestamp: Date.now(), latestNewsTimestamp: null, articleIds: [],
      newsArticlesSinceClose: 0, drivers: [], features: {}, modelVersion: "t",
      horizons: [{ horizon: 1, technicalPct: est[s], newsPct: 0, totalPct: est[s], lowPct: -1, highPct: 1, probabilityUp: 0.55, modelVersion: "t" }],
    }),
  };
  const market = { getQuote: (s: string) => ({ symbol: s, status: "DATA_UNAVAILABLE", statusReason: "" }), marketStatus: { isOpen: false } };
  const scanner = new TopPicksScanner(db, fakeForecaster as any, history, market as any, () => syms);
  const scan = await scanner.scan();
  assert.deepEqual(scan.picks.map((p) => p.symbol), ["A1", "A3", "SPY"]);
  assert.equal(scan.picks[0].rank, 1);
  assert.throws(() => db.prepare("DELETE FROM scans").run(), /append-only/);
});
