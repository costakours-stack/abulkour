import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import {
  ETFS,
  MARKET_TILES,
  THEMES,
  COMPANIES,
  assetType,
  getCompany,
  getEtf,
  localSearch,
} from "../assets/assetRegistry.js";
import type { AlertService } from "../alerts/AlertService.js";
import type { Candle, CandleResolution, NewsCategory, Sentiment, StoredArticle } from "../domain/types.js";
import type { LiveMarketService } from "../market/LiveMarketService.js";
import type { NewsIngestionService } from "../news/NewsIngestionService.js";
import type { NewsFilter, NewsStorageService } from "../news/NewsStorageService.js";
import type { NewsSentimentService } from "../news/NewsSentimentService.js";
import type { AnalystService } from "../ai/AnalystService.js";
import type { HistoryStore } from "../history/HistoryStore.js";
import type { ModelRegistry } from "../ml/ModelRegistry.js";
import { HORIZONS, type Trainer } from "../ml/Trainer.js";
import type { Forecaster } from "../prediction/Forecaster.js";
import type { TopPicksScanner } from "../prediction/TopPicksScanner.js";
import type { NewsImpactModel } from "../news/NewsImpactModel.js";
import type { PredictionModel } from "../prediction/BaselineModel.js";
import type { PointInTimeNewsView } from "../prediction/PointInTime.js";
import type { PredictionService } from "../prediction/PredictionService.js";
import type { PredictionStore } from "../prediction/PredictionStore.js";
import type { Providers } from "../providers/registry.js";
import { ProviderNotSupportedError } from "../providers/types.js";
import type { WatchlistService } from "../watchlist/WatchlistService.js";

export interface ApiDeps {
  providers: Providers;
  market: LiveMarketService;
  news: NewsStorageService;
  ingestion: NewsIngestionService;
  analysis: NewsSentimentService;
  predictions: PredictionService;
  predictionStore: PredictionStore;
  model: PredictionModel;
  pitNews: PointInTimeNewsView;
  alerts: AlertService;
  watchlists: WatchlistService;
  history: HistoryStore;
  registry: ModelRegistry;
  trainer: Trainer;
  impact: NewsImpactModel;
  analyst: AnalystService;
  universe: () => string[];
  /** starts history sync + training in the background */
  retrain: () => Promise<void>;
  picks: TopPicksScanner;
  forecaster: Forecaster;
}

/** Aggregate every `step` daily bars into one OHLCV bar. */
function downsample(bars: Candle[], step: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < bars.length; i += step) {
    const g = bars.slice(i, i + step);
    out.push({
      t: g[0].t,
      o: g[0].o,
      h: Math.max(...g.map((b) => b.h)),
      l: Math.min(...g.map((b) => b.l)),
      c: g[g.length - 1].c,
      v: g.reduce((s, b) => s + b.v, 0),
    });
  }
  return out;
}

const SYMBOL = /^[A-Z][A-Z.]{0,5}$/;
const H = 3600_000;
const SINCE: Record<string, number> = { "1h": H, "6h": 6 * H, "24h": 24 * H, "7d": 7 * 24 * H, "30d": 30 * 24 * H };

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);

function symbolParam(req: Request): string {
  const s = String(req.params.symbol ?? "").toUpperCase();
  if (!SYMBOL.test(s)) throw Object.assign(new Error("Invalid symbol"), { status: 400 });
  return s;
}

function str(q: unknown): string | undefined {
  return typeof q === "string" && q.length > 0 ? q : undefined;
}

/** Common news filter query params: sentiment, category, since, source, sector, assetType, minRelevance, impact, sort. */
function parseNewsFilter(q: Request["query"]): NewsFilter {
  const since = str(q.since);
  return {
    symbol: str(q.symbol)?.toUpperCase(),
    sentiment: str(q.sentiment) as Sentiment | undefined,
    category: str(q.category) as NewsCategory | undefined,
    sinceMs: since && SINCE[since] ? Date.now() - SINCE[since] : undefined,
    source: str(q.source),
    sector: str(q.sector),
    assetType: str(q.assetType) as "stock" | "etf" | undefined,
    impact: str(q.impact) as "high" | "medium" | "low" | undefined,
    minRelevance: str(q.minRelevance) ? Number(q.minRelevance) : undefined,
    sort: q.sort === "relevance" ? "relevance" : "newest",
    before: str(q.before) ? Number(q.before) : undefined,
    limit: str(q.limit) ? Number(q.limit) : 40,
  };
}

const RANGES: Record<string, { res: CandleResolution; ms: number }> = {
  "1D": { res: "5min", ms: 1 * 24 * H },
  "5D": { res: "1hour", ms: 7 * 24 * H },
  "1M": { res: "1day", ms: 31 * 24 * H },
  "6M": { res: "1day", ms: 183 * 24 * H },
  "1Y": { res: "1day", ms: 366 * 24 * H },
  "5Y": { res: "1day", ms: 5 * 366 * 24 * H },
  MAX: { res: "1day", ms: 40 * 366 * 24 * H },
};

export function buildRoutes(d: ApiDeps): Router {
  const r = Router();
  /** Every news response carries per-symbol estimated price impact (model estimate). */
  const annotate = (articles: StoredArticle[], focus?: string) => d.impact.annotate(articles, focus);

  /** Sum of estimated moves from the last 24h of news for a symbol, plus counts. */
  const newsMomentum = (symbol: string) => {
    const now = Date.now();
    // direct news published in the last 24h (publication time, not when we fetched it)
    const arts = d.pitNews
      .articles(symbol, now, 7 * 24 * H)
      .filter((a) => now - a.publishedAt <= 24 * H && a.relations.some((r) => r.symbol === symbol && r.relation === "direct"));
    let pos = 0, neg = 0;
    for (const a of arts) {
      if (a.analysis?.sentiment === "positive") pos++;
      if (a.analysis?.sentiment === "negative") neg++;
    }
    const agg = d.impact.aggregate(symbol, arts);
    return { articles24h: arts.length, events: agg.events, positive: pos, negative: neg, estMovePct: agg.pct };
  };

  r.get("/health", (_req, res) => res.json({ ok: true, time: Date.now() }));

  r.get("/status", (_req, res) => {
    res.json({
      marketData: d.market.providerInfo,
      marketStatus: d.market.marketStatus,
      newsProviders: d.providers.news.map((p) => p.name),
      newsLastRunAt: d.ingestion.lastRunAt,
      newsLastError: d.ingestion.lastError,
      newsAnalyzer: d.analysis.analyzerName,
      fundamentals: d.providers.fundamentals?.name ?? null,
      modelVersion: d.predictions.modelVersion,
      historySource: d.history.source,
      aiAnalyst: d.analyst.available,
    });
  });

  // ------------------------------------------------------------ model

  const modelSummary = (h: number) => {
    const m = d.registry.active(h);
    return m
      ? {
          version: m.version, horizon: h, createdAt: m.createdAt, dataSource: m.dataSource, trainStart: m.trainStart,
          trainEnd: m.trainEnd, symbols: m.symbols, metrics: m.metrics, calibration: m.calibration,
        }
      : null;
  };

  r.get("/model", (_req, res) => {
    res.json({
      active: modelSummary(1),
      horizons: HORIZONS.map((h) => modelSummary(h)).filter(Boolean),
      fallback: d.model.version,
      training: d.trainer.progress,
      history: { source: d.history.source, syncing: d.history.isSyncing, progress: d.history.progress, symbols: d.history.status() },
      newsImpact: d.impact.calibration,
      versions: d.registry.list(),
    });
  });

  r.post("/model/train", (_req, res) => {
    if (d.trainer.progress.running || d.history.isSyncing) return res.status(409).json({ error: "Sync or training already running" });
    void d.retrain().catch(() => {});
    res.status(202).json({ started: true });
  });

  // ------------------------------------------------------------ top picks

  /** Latest scan of the universe ranked by estimated return to the next close, with live quotes and track record. */
  r.get(
    "/top-picks",
    wrap(async (_req, res) => {
      let scan = d.picks.latest();
      if (!scan || Date.now() - scan.createdAt > 6 * H) scan = await d.picks.scan().catch(() => scan);
      const m = d.registry.active(1);
      res.json({
        scan: scan
          ? {
              ...scan,
              all: undefined,
              picks: scan.picks.map((p) => ({ ...p, quote: d.market.getQuote(p.symbol), spark: d.history.lastCloses(p.symbol, 30) })),
            }
          : null,
        track: d.picks.track(45),
        model: m
          ? { version: m.version, hitRate: m.metrics.overall.hitRate, baselineHitRate: m.metrics.overall.baselineHitRate, ic: m.metrics.overall.ic, dataSource: m.dataSource }
          : null,
        disclaimer:
          "Ranked by model-estimated return to the next close. These are statistical estimates with wide uncertainty, not recommendations.",
      });
    }),
  );

  r.post(
    "/top-picks/scan",
    wrap(async (_req, res) => res.status(201).json(await d.picks.scan())),
  );

  /** Last 30 daily closes per symbol, for list sparklines. */
  r.get("/sparklines", (req, res) => {
    const symbols = (str(req.query.symbols) ?? "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => SYMBOL.test(s)).slice(0, 60);
    res.json(Object.fromEntries(symbols.map((s) => [s, d.history.lastCloses(s, 30)])));
  });

  // ------------------------------------------------------------ dashboard

  r.get(
    "/dashboard",
    wrap(async (req, res) => {
      const deviceId = str(req.query.deviceId) ?? "anonymous";
      const watchlist = d.watchlists.get(deviceId);
      res.json({
        marketStatus: d.market.marketStatus,
        markets: MARKET_TILES.map((t) => ({ ...t, quote: d.market.getQuote(t.symbol) })),
        watchlist: watchlist.map((s) => ({ symbol: s, name: getCompany(s)?.name ?? getEtf(s)?.name ?? s, quote: d.market.getQuote(s) })),
        aiSignals: d.predictionStore.recent(10),
        latestNews: annotate(d.news.list({ limit: 15, sinceMs: Date.now() - 2 * 24 * H })),
        highImpact: annotate(d.news.list({ impact: "high", limit: 10, sinceMs: Date.now() - 3 * 24 * H })),
        sparklines: Object.fromEntries(
          [...new Set([...MARKET_TILES.map((t) => t.symbol), ...watchlist])].map((s) => [s, d.history.lastCloses(s, 30)]),
        ),
        newsMomentum: Object.fromEntries(watchlist.map((s) => [s, newsMomentum(s)])),
      });
    }),
  );

  r.get("/quotes", (req, res) => {
    const symbols = (str(req.query.symbols) ?? "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => SYMBOL.test(s)).slice(0, 50);
    res.json(symbols.map((s) => d.market.getQuote(s)));
  });

  // ------------------------------------------------------------ assets

  r.get(
    "/assets/search",
    wrap(async (req, res) => {
      const q = (str(req.query.q) ?? "").trim();
      if (!q) return res.json([]);
      const local = localSearch(q);
      let remote: { symbol: string; name: string; type: string }[] = [];
      try {
        remote = (await d.providers.market.searchSymbols?.(q)) ?? [];
      } catch {
        /* provider search is best-effort */
      }
      const seen = new Set<string>();
      const out = [...local, ...remote.map((x) => ({ ...x, type: /etf|etp/i.test(x.type) ? "etf" : "stock" }))].filter((x) =>
        seen.has(x.symbol) ? false : (seen.add(x.symbol), true),
      );
      res.json(out.slice(0, 25));
    }),
  );

  r.get(
    "/assets/:symbol",
    wrap(async (req, res) => {
      const symbol = symbolParam(req);
      const etf = getEtf(symbol);
      let profile = null;
      try {
        profile = etf ? null : await d.providers.fundamentals?.getProfile(symbol) ?? null;
      } catch {
        /* optional */
      }
      let holdings: { source: "provider" | "reference"; note: string; items: { symbol: string; name: string; weightPct: number | null }[] } | null = null;
      if (etf || assetType(symbol) === null) {
        const live = await d.providers.fundamentals?.getEtfHoldings?.(symbol).catch(() => null);
        if (live?.length) holdings = { source: "provider", note: `Holdings from ${d.providers.fundamentals!.name}.`, items: live };
        else if (etf)
          holdings = {
            source: "reference",
            note: etf.referenceHoldingsNote,
            items: etf.referenceHoldings.map((s) => ({ symbol: s, name: getCompany(s)?.name ?? s, weightPct: null })),
          };
      }
      res.json({
        symbol,
        type: etf ? "etf" : assetType(symbol) ?? (profile ? "stock" : "unknown"),
        name: etf?.name ?? getCompany(symbol)?.name ?? profile?.name ?? symbol,
        sector: getCompany(symbol)?.sector ?? null,
        quote: await d.market.getQuoteFresh(symbol),
        profile,
        holdings,
      });
    }),
  );

  r.get(
    "/assets/:symbol/candles",
    wrap(async (req, res) => {
      const symbol = symbolParam(req);
      const range = RANGES[str(req.query.range) ?? "1M"] ?? RANGES["1M"];
      const now = Date.now();
      const displayFrom = now - range.ms;
      // Daily ranges come from the local history store (back to 2000 with Tiingo). `warmup` extra
      // bars before the range let the app compute indicators (SMA200, RSI...) from the first visible bar.
      if (range.res === "1day") {
        const warmupBars = Math.min(260, Math.max(0, Number(req.query.warmup) || 0));
        const all = d.history.bars(symbol);
        const firstIdx = all.findIndex((b) => b.t >= displayFrom);
        if (firstIdx >= 0 && all.length - firstIdx > 1) {
          // very long ranges use multi-day bars to keep payloads and rendering light
          const step = Math.max(1, Math.floor((all.length - firstIdx) / 700));
          const from = Math.max(0, firstIdx - warmupBars * step);
          const candles = step === 1 ? all.slice(from) : downsample(all.slice(from), step);
          return res.json({ symbol, resolution: step === 1 ? "1day" : `${step}day`, candles, displayFrom, provider: d.history.source, available: true });
        }
      }
      try {
        const from = range.res === "1day" ? displayFrom : now - range.ms * 3; // intraday warmup
        const candles = await d.providers.market.getCandles(symbol, range.res, from, now);
        res.json({ symbol, resolution: range.res, candles, displayFrom, provider: d.providers.market.name, available: true });
      } catch (e) {
        res.json({
          symbol,
          resolution: range.res,
          candles: [],
          available: false,
          reason: e instanceof ProviderNotSupportedError ? e.message : `Historical data unavailable: ${(e as Error).message}`,
        });
      }
    }),
  );

  r.get(
    "/assets/:symbol/fundamentals",
    wrap(async (req, res) => {
      const symbol = symbolParam(req);
      const f = d.providers.fundamentals;
      if (!f) return res.json({ available: false, reason: "No fundamentals provider configured." });
      const [profile, metrics] = await Promise.all([f.getProfile(symbol).catch(() => null), f.getMetrics(symbol).catch(() => null)]);
      res.json({ available: !!(profile || metrics), provider: f.name, profile, metrics });
    }),
  );

  /**
   * Asset news. tab = latest|positive|negative|analyst|earnings|company.
   * For ETFs includes direct + holding + sector + macro news, each labeled with its relation.
   */
  r.get("/assets/:symbol/news", (req, res) => {
    const symbol = symbolParam(req);
    const f = parseNewsFilter(req.query);
    const tab = str(req.query.tab) ?? "latest";
    const tabFilter: Partial<NewsFilter> =
      tab === "positive" ? { sentiment: "positive" }
      : tab === "negative" ? { sentiment: "negative" }
      : tab === "analyst" ? { category: "analyst" }
      : tab === "earnings" ? { category: "earnings" }
      : tab === "company" ? { relations: ["direct"] }
      : {};
    const relation = str(req.query.relation);
    const relations = relation ? (relation.split(",") as NewsFilter["relations"]) : getEtf(symbol) ? undefined : ["direct" as const];
    res.json(annotate(d.news.list({ ...f, relations, ...tabFilter, symbol }), symbol));
  });

  r.get("/assets/:symbol/news-momentum", (req, res) => res.json(newsMomentum(symbolParam(req))));

  r.get("/assets/:symbol/predictions", (req, res) => {
    const symbol = symbolParam(req);
    const m = d.registry.active(1);
    const records = HORIZONS.map((h) => d.registry.active(h))
      .filter((x): x is NonNullable<typeof x> => !!x)
      .map((x) => ({ horizon: x.horizon ?? 1, version: x.version, symbol: x.metrics.bySymbol?.[symbol] ?? null, overall: x.metrics.overall }));
    res.json({
      modelRecords: records,
      symbol,
      latest: d.predictionStore.latest(symbol),
      history: d.predictionStore.history(symbol, 200),
      performance: d.predictionStore.performance(symbol),
      /** Walk-forward (out-of-sample) record of the active technical model, on this symbol and overall. */
      modelRecord: m
        ? {
            version: m.version,
            dataSource: m.dataSource,
            trainStart: m.trainStart,
            trainEnd: m.trainEnd,
            symbol: m.metrics.bySymbol?.[symbol] ?? null,
            overall: m.metrics.overall,
            folds: m.metrics.folds,
            topFeatures: m.metrics.topFeatures,
          }
        : null,
      newsImpact: d.impact.calibration,
      disclaimer:
        "Model estimates, not financial advice. Past out-of-sample performance does not guarantee future results.",
    });
  });

  r.post(
    "/assets/:symbol/predictions",
    wrap(async (req, res) => {
      const symbol = symbolParam(req);
      res.status(201).json(await d.predictions.generate(symbol, "requested by user"));
    }),
  );

  /** AI Analyst brief (Claude). ?force=1 regenerates. */
  r.get(
    "/assets/:symbol/brief",
    wrap(async (req, res) => {
      const symbol = symbolParam(req);
      if (!d.analyst.available) return res.json({ available: false, reason: "Add ANTHROPIC_API_KEY on the server to enable the AI Analyst." });
      const quote = await d.market.getQuoteFresh(symbol);
      const prediction = d.predictionStore.latest(symbol);
      const m = d.registry.active();
      const rec = m?.metrics.bySymbol?.[symbol];
      const articles = annotate(d.news.list({ symbol, limit: 20, sinceMs: Date.now() - 7 * 24 * H, groupClusters: true }), symbol);
      const technical = prediction
        ? Object.fromEntries(Object.entries(prediction.features).filter(([k]) => k.startsWith("tech_")))
        : null;
      const brief = await d.analyst.brief({
        symbol,
        name: getCompany(symbol)?.name ?? getEtf(symbol)?.name ?? symbol,
        type: getEtf(symbol) ? "ETF" : "stock",
        quote: "price" in quote ? quote : null,
        technical: technical && Object.keys(technical).length ? technical : null,
        prediction,
        trackRecord: rec ? { hitRate: rec.hitRate, baselineHitRate: rec.baselineHitRate, n: rec.n } : null,
        articles,
        force: req.query.force === "1",
      });
      res.json({ available: true, brief });
    }),
  );

  /** Full traceability for one prediction: model, timestamps, exact news it saw, and the actual result. */
  r.get("/predictions/:id", (req, res) => {
    const p = d.predictionStore.get(String(req.params.id));
    if (!p) return res.status(404).json({ error: "Not found" });
    const articles = p.newsArticleIds.map((id) => d.news.get(id)).filter((a): a is StoredArticle => !!a);
    res.json({
      ...p,
      newsUsed: articles.map((a) => ({
        id: a.id,
        headline: a.headline,
        source: a.source,
        url: a.url,
        publishedAt: a.publishedAt,
        availableAt: a.availableAt,
        sentiment: a.analysis?.sentiment ?? null,
      })),
    });
  });

  r.get("/predictions", (req, res) => res.json(d.predictionStore.recent(Math.min(100, Number(req.query.limit) || 20))));

  // ------------------------------------------------------------ news

  r.get("/news", (req, res) => {
    const f = parseNewsFilter(req.query);
    res.json(annotate(d.news.list(f), f.symbol));
  });

  r.get("/news/meta", (_req, res) => {
    res.json({
      sources: d.news.sources(),
      sectors: ["technology", "semiconductors", "communication", "consumer", "financials", "energy", "healthcare", "industrials"],
      categories: ["earnings", "m&a", "analyst", "regulatory", "macro", "product", "company", "market", "other"],
      since: Object.keys(SINCE),
      etfs: ETFS.map((e) => e.symbol),
    });
  });

  /**
   * Search: "Apple", "AAPL", "AI stocks", "semiconductors", "oil", "Federal Reserve".
   * Combines full-text search with symbol and theme expansion, and returns the related assets.
   */
  r.get("/news/search", (req, res) => {
    const q = (str(req.query.q) ?? "").trim();
    if (!q) return res.json({ query: q, relatedAssets: [], articles: [] });
    const lower = q.toLowerCase();
    const f = parseNewsFilter(req.query);

    const related = new Set<string>();
    if (SYMBOL.test(q.toUpperCase()) && (getCompany(q) || getEtf(q))) related.add(q.toUpperCase());
    for (const c of COMPANIES) if (c.aliases.some((a) => a === lower || lower.includes(a))) related.add(c.symbol);
    for (const e of ETFS) if (e.aliases.some((a) => lower.includes(a))) related.add(e.symbol);
    let terms = q;
    for (const [name, theme] of Object.entries(THEMES)) {
      if (lower.includes(name) || name.includes(lower) || theme.keywords.includes(lower)) {
        theme.symbols.forEach((s) => related.add(s));
        terms += " " + theme.keywords.join(" ");
      }
    }

    const byId = new Map<string, { a: StoredArticle; score: number }>();
    d.news.search(terms, f).forEach((a, i) => byId.set(a.id, { a, score: 100 - i }));
    for (const s of related) {
      for (const a of d.news.list({ symbol: s, relations: ["direct"], limit: 30, sinceMs: f.sinceMs, groupClusters: false })) {
        const prev = byId.get(a.id);
        byId.set(a.id, { a, score: (prev?.score ?? 0) + 40 });
      }
    }
    let articles = [...byId.values()];
    if (f.sentiment) articles = articles.filter((x) => x.a.analysis?.sentiment === f.sentiment);
    if (f.category) articles = articles.filter((x) => x.a.analysis?.category === f.category);
    articles.sort((x, y) => (f.sort === "newest" ? y.a.publishedAt - x.a.publishedAt : y.score - x.score || y.a.publishedAt - x.a.publishedAt));

    res.json({
      query: q,
      relatedAssets: [...related].map((s) => ({ symbol: s, name: getCompany(s)?.name ?? getEtf(s)?.name ?? s, type: assetType(s) })),
      articles: annotate(articles.slice(0, 60).map((x) => x.a)),
    });
  });

  r.get("/news/:id", (req, res) => {
    const a = d.news.get(String(req.params.id));
    if (!a) return res.status(404).json({ error: "Not found" });
    res.json({ ...annotate([a])[0], impactCalibration: d.impact.calibration });
  });

  // ------------------------------------------------------------ watchlist & alerts

  r.get("/watchlist", (req, res) => res.json(d.watchlists.get(str(req.query.deviceId) ?? "anonymous")));

  r.put("/watchlist", (req, res) => {
    const body = z.object({ deviceId: z.string().min(1).max(100), symbols: z.array(z.string()).max(50) }).parse(req.body);
    const symbols = d.watchlists.set(body.deviceId, body.symbols);
    symbols.forEach((s) => d.market.subscribe(s));
    res.json(symbols);
  });

  r.post("/devices", (req, res) => {
    const body = z
      .object({ deviceId: z.string().min(1).max(100), pushToken: z.string().max(300).nullable().optional(), notificationsEnabled: z.boolean() })
      .parse(req.body);
    d.alerts.registerDevice(body.deviceId, body.pushToken ?? null, body.notificationsEnabled);
    res.json(d.alerts.getDevice(body.deviceId));
  });

  r.get("/alerts/prefs", (req, res) => {
    const deviceId = str(req.query.deviceId) ?? "";
    res.json({ device: d.alerts.getDevice(deviceId), prefs: d.alerts.getPrefs(deviceId) });
  });

  r.put("/alerts/prefs", (req, res) => {
    const body = z
      .object({
        deviceId: z.string().min(1).max(100),
        symbol: z.string().regex(/^[A-Za-z.]{1,6}$/),
        newArticle: z.boolean(),
        highImpact: z.boolean(),
        unusualSentiment: z.boolean(),
      })
      .parse(req.body);
    d.alerts.setPrefs(body.deviceId, body);
    res.json(d.alerts.getPrefs(body.deviceId));
  });

  r.delete("/alerts/prefs/:symbol", (req, res) => {
    d.alerts.deletePrefs(str(req.query.deviceId) ?? "", symbolParam(req));
    res.status(204).end();
  });

  r.get("/alerts/history", (req, res) => res.json(d.alerts.history(str(req.query.deviceId) ?? "")));

  // ------------------------------------------------------------ errors

  r.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) return res.status(400).json({ error: "Invalid request", details: err.issues });
    const status = err.status ?? 500;
    if (status >= 500) console.error("[api]", err);
    res.status(status).json({ error: err.message ?? "Internal error" });
  });

  return r;
}
