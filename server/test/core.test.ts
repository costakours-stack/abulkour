import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "../src/db/database.js";
import type { StoredArticle } from "../src/domain/types.js";
import { computeStatus } from "../src/market/LiveMarketService.js";
import { NewsClassifier } from "../src/news/NewsClassifier.js";
import { NewsDeduplicationService } from "../src/news/NewsDeduplicationService.js";
import { NewsStorageService } from "../src/news/NewsStorageService.js";
import { buildNewsFeatures } from "../src/prediction/features.js";
import {
  LookaheadViolationError,
  PointInTimeCandles,
  PointInTimeNewsView,
  candleAvailableAt,
} from "../src/prediction/PointInTime.js";
import { PredictionStore } from "../src/prediction/PredictionStore.js";

const H = 3600_000;
const T0 = Date.UTC(2026, 8, 21, 14, 0); // fixed "prediction time"

function article(id: string, availableAt: number, over: Partial<StoredArticle> = {}): StoredArticle {
  return {
    id,
    clusterId: id,
    headline: `Headline ${id}`,
    source: "Test",
    url: `https://example.com/${id}`,
    publishedAt: availableAt - 60_000,
    retrievedAt: availableAt,
    availableAt,
    providerSnippet: null,
    provider: "test",
    imageUrl: null,
    relatedSymbols: ["AAPL"],
    relatedCompanies: ["Apple"],
    relatedEtfs: [],
    relations: [{ symbol: "AAPL", relation: "direct", label: "News about AAPL." }],
    sectors: ["technology"],
    analysis: {
      sentiment: "positive", sentimentScore: 0.8, relevanceScore: 0.9, impact: "high", relatedSymbols: ["AAPL"],
      summary: "s", reason: "r", category: "company", symbolImpacts: [], analyzer: "test", analyzedAt: availableAt,
    },
    ...over,
  };
}

// ------------------------------------------------------------ point in time

test("point-in-time news view never returns articles available after asOf", () => {
  const db = openDatabase(":memory:");
  const store = new NewsStorageService(db);
  store.insert(article("past", T0 - 2 * H), "https://example.com/past");
  store.insert(article("future", T0 + 1 * H), "https://example.com/future");
  const view = new PointInTimeNewsView(store);
  const got = view.articles("AAPL", T0, 7 * 24 * H);
  assert.deepEqual(got.map((a) => a.id), ["past"]);
});

test("point-in-time view throws if the underlying query leaks future articles", () => {
  const leaky = { listAvailableAt: () => [article("leak", T0 + 5 * 60_000)] };
  const view = new PointInTimeNewsView(leaky as any);
  assert.throws(() => view.articles("AAPL", T0, 24 * H), LookaheadViolationError);
});

test("an article published before asOf but retrieved after it is excluded", () => {
  const db = openDatabase(":memory:");
  const store = new NewsStorageService(db);
  // published 1h before T0, but our system only fetched it 30 min after T0
  store.insert(article("late", T0 + 30 * 60_000, { publishedAt: T0 - H }), "https://example.com/late");
  assert.equal(new PointInTimeNewsView(store).articles("AAPL", T0, 24 * H).length, 0);
});

test("feature builder rejects future articles", () => {
  assert.throws(() => buildNewsFeatures([article("f", T0 + 1)], T0), LookaheadViolationError);
  const f = buildNewsFeatures([article("p", T0 - H / 2)], T0);
  assert.equal(f.news_volume_1h, 1);
  assert.equal(f.high_impact_news_count, 1);
});

test("daily candle is not usable until the session close", async () => {
  const dayStartNY = Date.UTC(2026, 8, 21, 4, 0); // 00:00 New York (EDT)
  const bar = { t: dayStartNY, o: 1, h: 1, l: 1, c: 1, v: 1 };
  assert.equal(candleAvailableAt(bar, "1day"), dayStartNY + 16 * H);
  const pit = new PointInTimeCandles({ getCandles: async () => [bar] });
  assert.equal((await pit.candles("AAPL", "1day", dayStartNY + 15 * H, 10 * 24 * H)).length, 0); // 15:00 NY
  assert.equal((await pit.candles("AAPL", "1day", dayStartNY + 16 * H, 10 * 24 * H)).length, 1);
});

// ------------------------------------------------------------ prediction history

test("predictions are append-only", () => {
  const db = openDatabase(":memory:");
  const store = new PredictionStore(db);
  const base = {
    symbol: "AAPL", modelVersion: "m", marketDataTimestamp: T0, latestNewsTimestamp: null, newsArticleIds: [],
    horizon: "1d" as const, basePrice: 100, probabilityUp: 0.6, confidence: 0.3, features: {}, trigger: "t",
  };
  store.insert({ ...base, id: "p1", predictionTimestamp: T0, predictedReturnPct: 1.2 });
  store.insert({ ...base, id: "p2", predictionTimestamp: T0 + H, predictedReturnPct: 2.1 });
  assert.equal(store.history("AAPL").length, 2);
  assert.throws(() => db.prepare("UPDATE predictions SET predicted_return_pct = 9 WHERE id = 'p1'").run(), /append-only/);
  assert.throws(() => db.prepare("DELETE FROM predictions").run(), /append-only/);
});

// ------------------------------------------------------------ market status

test("market status never reports stale or delayed data as LIVE", () => {
  const open = { isOpen: true, session: "regular" as const, exchange: "US", asOf: T0, source: "t" };
  const closed = { ...open, isOpen: false, session: "closed" as const };
  assert.equal(computeStatus({ dataTimestamp: T0 - 10_000 }, open, 0, T0, 120_000).status, "LIVE");
  assert.equal(computeStatus({ dataTimestamp: T0 - 10 * 60_000 }, open, 0, T0, 120_000).status, "DELAYED");
  assert.equal(computeStatus({ dataTimestamp: T0 }, open, 15, T0, 120_000).status, "DELAYED");
  assert.equal(computeStatus({ dataTimestamp: T0 }, closed, 0, T0, 120_000).status, "MARKET_CLOSED");
});

// ------------------------------------------------------------ news

test("dedup canonicalizes tracking params and clusters same-event headlines", () => {
  const d = new NewsDeduplicationService();
  assert.equal(
    d.canonicalizeUrl("https://www.Example.com/story/?utm_source=x&id=5#top"),
    d.canonicalizeUrl("https://example.com/story?id=5"),
  );
  const existing = [{ id: "a", clusterId: "c1", headline: "Apple beats estimates as iPhone sales surge", publishedAt: T0, symbols: ["AAPL"] }];
  const same = d.match({ id: "b", headline: "Apple beats estimates as iPhone sales surge", publishedAt: T0 + H, symbols: ["AAPL"] }, existing);
  assert.equal(same.duplicateOf, "a");
  const event = d.match({ id: "c", headline: "iPhone sales surge lifts Apple past estimates", publishedAt: T0 + H, symbols: ["AAPL"] }, existing);
  assert.equal(event.duplicateOf, undefined);
  assert.equal(event.clusterId, "c1");
});

test("NVDA news is direct for NVDA but only a holding relation for QQQ", () => {
  const c = new NewsClassifier();
  const r = c.classify({ provider: "t", headline: "Nvidia unveils new data center GPU", source: "t", url: "u", publishedAt: T0 });
  const nvda = r.relations.find((x) => x.symbol === "NVDA");
  const qqq = r.relations.find((x) => x.symbol === "QQQ");
  assert.equal(nvda?.relation, "direct");
  assert.equal(qqq?.relation, "holding");
  assert.equal(qqq?.label, "Related through NVDA, one of QQQ's major holdings.");
  assert.ok(!r.directSymbols.includes("QQQ"));
});

test("Fed news is macro-related to broad ETFs, not direct", () => {
  const c = new NewsClassifier();
  const r = c.classify({ provider: "t", headline: "Federal Reserve holds interest rates steady, signals cuts later", source: "t", url: "u", publishedAt: T0 });
  assert.equal(r.category, "macro");
  assert.equal(r.relations.find((x) => x.symbol === "SPY")?.relation, "macro");
  assert.equal(r.directSymbols.length, 0);
});

test("full-text search finds stored articles", () => {
  const db = openDatabase(":memory:");
  const store = new NewsStorageService(db);
  store.insert(article("x", T0, { headline: "Semiconductor stocks rally on AI demand" }), "https://example.com/x");
  assert.equal(store.search("semiconductor").length, 1);
});
