import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import type { RawArticle, RawQuote } from "../src/domain/types.js";
import { EventBus } from "../src/events.js";
import { LiveMarketService } from "../src/market/LiveMarketService.js";
import { NewsAggregator } from "../src/news/NewsAggregator.js";
import { NewsClassifier } from "../src/news/NewsClassifier.js";
import { NewsDeduplicationService } from "../src/news/NewsDeduplicationService.js";
import { NewsIngestionService } from "../src/news/NewsIngestionService.js";
import { NewsSentimentService } from "../src/news/NewsSentimentService.js";
import { NewsStorageService } from "../src/news/NewsStorageService.js";
import { BaselineModel } from "../src/prediction/BaselineModel.js";
import { PointInTimeNewsView } from "../src/prediction/PointInTime.js";
import { HistoryStore } from "../src/history/HistoryStore.js";
import { ModelRegistry } from "../src/ml/ModelRegistry.js";
import { NewsImpactModel } from "../src/news/NewsImpactModel.js";
import { PredictionService } from "../src/prediction/PredictionService.js";
import { Forecaster } from "../src/prediction/Forecaster.js";
import { PredictionStore } from "../src/prediction/PredictionStore.js";
import type { MarketDataProvider } from "../src/providers/types.js";

test("ingest -> classify -> analyze -> store -> predict, with full traceability", async () => {
  const db = openDatabase(":memory:");
  const bus = new EventBus();
  const storage = new NewsStorageService(db);
  const now = Date.now();

  const raw: RawArticle[] = [
    { provider: "stub", headline: "Nvidia beats estimates as data center revenue surges", source: "Reuters", url: "https://example.com/a?utm_source=x", publishedAt: now - 60_000, providerSnippet: "Nvidia reported record quarterly revenue." },
    { provider: "stub2", headline: "Nvidia beats estimates as data center revenue surges", source: "Reuters", url: "https://example.com/a", publishedAt: now - 60_000 },
    { provider: "stub", headline: "Nvidia tops estimates on surging data center revenue", source: "Bloomberg", url: "https://example.org/b", publishedAt: now - 30_000 },
  ];
  const ingestion = new NewsIngestionService(
    new NewsAggregator([]), new NewsDeduplicationService(), new NewsClassifier(), new NewsSentimentService(null), storage, bus, () => [], 60_000,
  );
  const analyzed: string[] = [];
  bus.on("article:analyzed", (a) => analyzed.push(a.id));
  assert.equal(await ingestion.ingest(raw, { backfill: false }), 2, "exact URL duplicate dropped, other outlet kept");
  assert.equal(analyzed.length, 2);

  const nvda = storage.list({ symbol: "NVDA" });
  assert.equal(nvda.length, 1, "same event from two outlets grouped into one card");
  assert.equal(nvda[0].alsoReportedBy?.length, 1);
  assert.equal(nvda[0].analysis?.sentiment, "positive");
  assert.equal(nvda[0].analysis?.analyzer, "rules-v1");

  const qqq = storage.list({ symbol: "QQQ" });
  assert.equal(qqq[0].relations.find((r) => r.symbol === "QQQ")?.relation, "holding");

  // prediction using a stub market provider
  const quote: RawQuote = {
    symbol: "NVDA", price: 100, change: 1, changePercent: 1, previousClose: 99, open: 99, high: 101, low: 98, volume: null,
    bid: null, ask: null, dataTimestamp: now - 5_000, provider: "stub",
  };
  const provider: MarketDataProvider = {
    name: "stub",
    capabilities: { realtimeQuotes: true, quoteDelayMinutes: 0, bidAsk: false, streaming: false, candles: true },
    getQuote: async () => quote,
    getCandles: async () => Array.from({ length: 30 }, (_, i) => ({ t: now - (31 - i) * 86_400_000, o: 90 + i / 3, h: 91 + i / 3, l: 89 + i / 3, c: 90 + i / 3, v: 1e6 })),
    getMarketStatus: async () => ({ isOpen: true, session: "regular", exchange: "US", asOf: now, source: "stub" }),
  };
  const market = new LiveMarketService(provider, bus, config);
  const store = new PredictionStore(db);
  const history = new HistoryStore(db, null, null);
  history.importBars("NVDA", await provider.getCandles("NVDA", "1day", 0, now), "test");
  const forecaster = new Forecaster(
    new BaselineModel(), new ModelRegistry(db), history, new NewsImpactModel(history), new PointInTimeNewsView(storage), () => true,
  );
  const svc = new PredictionService(forecaster, history, store, market, bus, () => ["NVDA"]);

  const p1 = await svc.generate("NVDA", "test");
  assert.equal(p1.modelVersion, "baseline-linear-0.1+news-impact");
  assert.ok("component_technical_pct" in p1.features && "component_news_pct" in p1.features);
  assert.equal(p1.newsArticleIds.length, 2);
  assert.ok(p1.latestNewsTimestamp! <= p1.predictionTimestamp);
  assert.ok(p1.marketDataTimestamp <= p1.predictionTimestamp);
  assert.ok(p1.features.news_sentiment_24h > 0);

  const p2 = await svc.generate("NVDA", "test again");
  assert.equal(store.history("NVDA").length, 2, "old prediction kept");
  assert.notEqual(p1.id, p2.id);
});
