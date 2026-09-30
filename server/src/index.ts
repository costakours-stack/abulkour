import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { config } from "./config.js";
import { openDatabase } from "./db/database.js";
import { EventBus } from "./events.js";
import { buildProviders } from "./providers/registry.js";
import { LiveMarketService } from "./market/LiveMarketService.js";
import { NewsAggregator } from "./news/NewsAggregator.js";
import { NewsClassifier } from "./news/NewsClassifier.js";
import { NewsDeduplicationService } from "./news/NewsDeduplicationService.js";
import { NewsIngestionService } from "./news/NewsIngestionService.js";
import { ClaudeNewsAnalyzer, NewsSentimentService } from "./news/NewsSentimentService.js";
import { NewsStorageService } from "./news/NewsStorageService.js";
import { BaselineModel } from "./prediction/BaselineModel.js";
import { PointInTimeNewsView } from "./prediction/PointInTime.js";
import { HistoryStore } from "./history/HistoryStore.js";
import { TiingoHistoryProvider } from "./providers/tiingo/TiingoHistoryProvider.js";
import { ModelRegistry } from "./ml/ModelRegistry.js";
import { HORIZONS, Trainer } from "./ml/Trainer.js";
import { Forecaster } from "./prediction/Forecaster.js";
import { TopPicksScanner } from "./prediction/TopPicksScanner.js";
import { PaperTrader } from "./trading/PaperTrader.js";
import { nyMinutes, nyTimeOn } from "./util/time.js";
import { NewsImpactModel } from "./news/NewsImpactModel.js";
import { AnalystService } from "./ai/AnalystService.js";
import { importSeedIfEmpty } from "./db/seed.js";
import { PredictionService } from "./prediction/PredictionService.js";
import { PredictionStore } from "./prediction/PredictionStore.js";
import { AlertService } from "./alerts/AlertService.js";
import { WatchlistService } from "./watchlist/WatchlistService.js";
import { WebSocketHub } from "./realtime/WebSocketHub.js";
import { buildRoutes } from "./api/routes.js";

const db = openDatabase(config.databasePath);
const bus = new EventBus();
bus.setMaxListeners(50);
const providers = buildProviders(config);

const watchlists = new WatchlistService(db, config.defaultWatchlist);
const market = new LiveMarketService(providers.market, bus, config);

const newsStorage = new NewsStorageService(db);
const analysis = new NewsSentimentService(
  config.anthropicApiKey ? new ClaudeNewsAnalyzer(config.anthropicApiKey, config.anthropicModel) : null,
);
const ingestion = new NewsIngestionService(
  new NewsAggregator(providers.news),
  new NewsDeduplicationService(),
  new NewsClassifier(),
  analysis,
  newsStorage,
  bus,
  () => watchlists.all(),
  config.newsPollIntervalMs,
);

const model = new BaselineModel();
const predictionStore = new PredictionStore(db);
const pitNews = new PointInTimeNewsView(newsStorage);

const history = new HistoryStore(
  db,
  config.tiingoApiKey ? new TiingoHistoryProvider(config.tiingoApiKey) : null,
  config.polygonApiKey ? providers.market : null,
);
const registry = new ModelRegistry(db);
const seeded = importSeedIfEmpty(db, config.seedPath);
if (seeded) {
  console.log(`[seed] loaded ${seeded.bars} daily bars and ${seeded.models} models from snapshot (${new Date(seeded.snapshotAt).toISOString().slice(0, 10)})`);
}
const trainer = new Trainer(history, registry);
const impact = new NewsImpactModel(history);
const analyst = new AnalystService(config.anthropicApiKey, config.anthropicModel);
const universe = () => [...new Set(["SPY", ...config.trainingUniverse, ...watchlists.all()])];

const forecaster = new Forecaster(model, registry, history, impact, pitNews, () => market.marketStatus.isOpen);
const predictions = new PredictionService(forecaster, history, predictionStore, market, bus, () => watchlists.all());
const picks = new TopPicksScanner(db, forecaster, history, market, universe);
const trader = new PaperTrader(db, forecaster, market, universe);

/** Sync price history, recalibrate the news-impact model, and retrain when needed. */
async function retrain(force = true) {
  await history.sync(universe());
  impact.recalibrate(newsStorage.list({ limit: 200, sinceMs: Date.now() - 180 * 24 * 3600_000, groupClusters: false }));
  const stale = HORIZONS.some((h) => {
    const m = registry.active(h);
    return !m || Date.now() - m.createdAt > 7 * 24 * 3600_000 || m.dataSource !== history.source;
  });
  if (force || stale) {
    console.log(`[ml] training 1d/5d/20d models on ${history.source} history...`);
    for (const m of await trainer.trainAll(universe(), history.source)) {
      console.log(
        `[ml] ${m.version}: out-of-sample hit rate ${(m.metrics.overall.hitRate * 100).toFixed(1)}% ` +
          `(always-up ${(m.metrics.overall.baselineHitRate * 100).toFixed(1)}%), IC ${m.metrics.overall.ic.toFixed(3)}, ` +
          `80% range coverage ${((m.metrics.overall.bandCoverage ?? 0) * 100).toFixed(0)}%`,
      );
    }
    await picks.scan().catch(() => {});
  }
}
const alerts = new AlertService(db, bus, newsStorage, config.expoPushEnabled);

const app = express();
app.use(express.json({ limit: "100kb" }));
// Native apps don't need CORS; the Expo web build does. Only allowed origins get the header.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && config.corsOrigins.some((o) => o === "*" || o === origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-token");
  }
  if (req.method === "OPTIONS") return void res.sendStatus(204);
  next();
});
// Access code: only the Abulkour app may use this server (and its data-provider quotas).
app.use("/api", (req, res, next) => {
  if (!config.appAccessToken || req.path === "/health") return next();
  if (req.header("x-app-token") === config.appAccessToken) return next();
  res.status(401).json({ error: "Missing or wrong app access code. Check Alerts → Server address in the app." });
});
app.use(
  "/api",
  buildRoutes({
    providers, market, news: newsStorage, ingestion, analysis, predictions, predictionStore, model, pitNews, alerts, watchlists,
    history, registry, trainer, impact, analyst, universe, retrain: () => retrain(true), picks, forecaster, trader,
  }),
);

// Phone download page + APK (server/public/marketpulse.apk), so the app can be installed over Wi-Fi.
const publicDir = fileURLToPath(new URL("../public", import.meta.url));
app.get("/download", (_req, res) => res.sendFile(join(publicDir, "download.html")));
app.use("/download", express.static(publicDir, { setHeaders: (res, path) => {
  if (path.endsWith(".apk")) res.setHeader("Content-Type", "application/vnd.android.package-archive");
} }));

const server = createServer(app);
new WebSocketHub(server, bus, market, config.appAccessToken);

server.listen(config.port, () => {
  console.log(`Abulkour API on http://localhost:${config.port}/api  (WebSocket: ws://localhost:${config.port}/ws)`);
  console.log(`  market data: ${providers.market.name} | news: ${providers.news.map((p) => p.name).join(", ") || "none"} | analyzer: ${analysis.analyzerName} | fallback model: ${model.version}`);
  market.start([...new Set([...watchlists.all(), "SPY", "QQQ", "DIA", "VIXY"])]);
  ingestion.start();
  predictions.start();
  alerts.start();
  picks.start();
  trader.start();
  // On hosts that sleep when idle (Render free), keep the server awake during US market hours
  // so the AI paper trader can run from open to close. Render sets RENDER_EXTERNAL_URL.
  const publicUrl = process.env.RENDER_EXTERNAL_URL;
  if (publicUrl && process.env.KEEP_AWAKE_MARKET_HOURS !== "false") {
    setInterval(() => {
      const now = Date.now();
      const m = nyMinutes(now);
      const weekday = new Date(nyTimeOn(now, 12)).getUTCDay();
      if (weekday >= 1 && weekday <= 5 && m >= 9 * 60 + 10 && m <= 16 * 60 + 10)
        fetch(`${publicUrl}/api/health`).catch(() => {});
    }, 10 * 60_000);
  }
  // Background: history sync + (re)training. Re-checked every 6 hours; retrains weekly
  // or when the history source changes (e.g. a Tiingo key is added).
  const background = () => retrain(false).catch((e) => console.warn("[ml]", e.message));
  setTimeout(background, 5_000);
  setInterval(background, 6 * 3600_000);
});

const shutdown = () => {
  market.stop();
  ingestion.stop();
  predictions.stop();
  trader.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
