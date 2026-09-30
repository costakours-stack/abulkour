// One point-in-time forecast for a symbol: technical models for 1/5/20 trading
// days + the news-impact component, with likely ranges and "why" drivers.
// Shared by live predictions (PredictionService) and the Top Picks scanner.

import type { Candle, Quote, StoredArticle } from "../domain/types.js";
import type { HistoryStore } from "../history/HistoryStore.js";
import type { ModelRegistry } from "../ml/ModelRegistry.js";
import { buildFeatureRows, marketSeries, WARMUP } from "../ml/technicalFeatures.js";
import { HORIZONS, inferTechnical } from "../ml/Trainer.js";
import type { NewsImpactModel } from "../news/NewsImpactModel.js";
import { nyDate, nyMidnight } from "../util/time.js";
import type { PredictionModel } from "./BaselineModel.js";
import { buildNewsFeatures, buildPriceFeatures } from "./features.js";
import { assertNoLookahead, candleAvailableAt, type PointInTimeNewsView } from "./PointInTime.js";

const NEWS_LOOKBACK = 7 * 24 * 3600_000;

export interface HorizonForecast {
  horizon: number;
  technicalPct: number;
  newsPct: number;
  totalPct: number;
  lowPct: number;
  highPct: number;
  probabilityUp: number;
  modelVersion: string;
}

export interface Forecast {
  symbol: string;
  asOf: number;
  basePrice: number;
  marketDataTimestamp: number;
  latestNewsTimestamp: number | null;
  articleIds: string[];
  newsArticlesSinceClose: number;
  horizons: HorizonForecast[]; // 1d first
  drivers: { feature: string; value: number; contributionPct: number }[];
  features: Record<string, number>;
  modelVersion: string;
}

export class Forecaster {
  constructor(
    private fallbackModel: PredictionModel,
    private registry: ModelRegistry,
    private history: HistoryStore,
    private impact: NewsImpactModel,
    private news: PointInTimeNewsView,
    private isMarketOpen: () => boolean,
  ) {}

  /** Completed daily bars at asOf, plus a provisional bar for today's session built from the live quote. */
  private barsAsOf(symbol: string, asOf: number, quote: Quote | null) {
    const complete = assertNoLookahead(
      this.history.bars(symbol).filter((b) => candleAvailableAt(b, "1day") <= asOf),
      (b) => candleAvailableAt(b, "1day"),
      asOf,
      `${symbol} daily bar`,
    );
    const last = complete[complete.length - 1];
    const lastCloseAt = last ? candleAvailableAt(last, "1day") : 0;
    if (quote && last && nyDate(quote.dataTimestamp) > nyDate(last.t + 12 * 3600_000) && quote.dataTimestamp <= asOf) {
      const avgV = complete.slice(-20).reduce((s, b) => s + b.v, 0) / Math.min(20, complete.length);
      const bar: Candle = {
        t: nyMidnight(nyDate(quote.dataTimestamp)),
        o: quote.open ?? quote.price,
        h: Math.max(quote.high ?? quote.price, quote.price),
        l: Math.min(quote.low ?? quote.price, quote.price),
        c: quote.price,
        v: quote.volume ?? avgV,
      };
      return { bars: [...complete, bar], lastCloseAt, provisional: true };
    }
    return { bars: complete, lastCloseAt, provisional: false };
  }

  /**
   * @param quote live quote if available; otherwise the forecast is made from the
   *              last completed close (e.g. when scanning many symbols).
   */
  forecast(symbol: string, quote: Quote | null, asOf = Date.now()): Forecast | null {
    const articles = this.news.articles(symbol, asOf, NEWS_LOOKBACK);
    const { bars, lastCloseAt, provisional } = this.barsAsOf(symbol, asOf, quote);
    const last = bars[bars.length - 1];
    const basePrice = quote?.price ?? last?.c;
    if (!basePrice) return null;
    const marketDataTimestamp = quote ? Math.min(quote.dataTimestamp, asOf) : lastCloseAt;

    const openSince = provisional || (this.isMarketOpen() && lastCloseAt > 0);
    const news = this.impact.newsComponent(symbol, articles, asOf, lastCloseAt, openSince);
    const vol = this.impact.vol20(symbol) * 100;

    const spy = this.history.bars("SPY").filter((b) => candleAvailableAt(b, "1day") <= asOf);
    const row = bars.length > WARMUP ? buildFeatureRows(bars, spy.length > 300 ? marketSeries(spy) : null, true)[0] : null;

    const features: Record<string, number> = {};
    const horizons: HorizonForecast[] = [];
    let drivers: Forecast["drivers"] = [];
    let modelVersion = this.fallbackModel.version;

    for (const h of HORIZONS) {
      const m = this.registry.active(h);
      // news effect is a next-session estimate; it is not extrapolated to longer horizons
      const newsPct = h === 1 ? news.pct : 0;
      let techPct: number, pUp: number, lo: number, hi: number, version: string;
      if (m && row) {
        const out = inferTechnical(m, row);
        techPct = out.predictedReturnPct;
        pUp = out.probabilityUp;
        lo = out.lowPct;
        hi = out.highPct;
        version = m.version;
        if (h === 1) {
          drivers = out.drivers;
          modelVersion = m.version;
          m.features.forEach((f, i) => (features[`tech_${f}`] = row.x[i]));
          for (const d of out.drivers) features[`why_${d.feature}`] = d.contributionPct;
        }
      } else if (h === 1) {
        const f = { ...buildPriceFeatures(bars, basePrice), ...buildNewsFeatures(articles, asOf) };
        const out = this.fallbackModel.predict(f);
        techPct = out.predictedReturnPct;
        pUp = out.probabilityUp;
        lo = techPct - 1.28 * vol;
        hi = techPct + 1.28 * vol;
        version = this.fallbackModel.version;
      } else {
        continue;
      }
      // shift P(up) by the news component, in volatility units
      const pAdj = 1 / (1 + Math.exp(-(Math.log(pUp / (1 - pUp)) + (1.6 * newsPct) / (vol * Math.sqrt(h)))));
      horizons.push({
        horizon: h, technicalPct: techPct, newsPct, totalPct: techPct + newsPct,
        lowPct: lo + newsPct, highPct: hi + newsPct, probabilityUp: pAdj, modelVersion: version,
      });
    }
    if (!horizons.length) return null;

    const r4 = (x: number) => Math.round(x * 10000) / 10000;
    const h1 = horizons[0];
    Object.assign(features, {
      component_technical_pct: h1.technicalPct,
      component_news_pct: h1.newsPct,
      interval_lo_pct: h1.lowPct,
      interval_hi_pct: h1.highPct,
      news_articles_since_close: news.articleIds.length,
      news_impact_k: this.impact.calibration.k,
      ...buildNewsFeatures(articles, asOf),
    });
    for (const f of horizons.slice(1)) {
      features[`fc${f.horizon}_pct`] = f.totalPct;
      features[`fc${f.horizon}_lo`] = f.lowPct;
      features[`fc${f.horizon}_hi`] = f.highPct;
      features[`fc${f.horizon}_pup`] = f.probabilityUp;
    }
    return {
      symbol,
      asOf,
      basePrice,
      marketDataTimestamp,
      latestNewsTimestamp: articles.length ? Math.max(...articles.map((a) => a.availableAt)) : null,
      articleIds: articles.map((a: StoredArticle) => a.id),
      newsArticlesSinceClose: news.articleIds.length,
      horizons,
      drivers,
      features: Object.fromEntries(Object.entries(features).map(([k, v]) => [k, r4(v)])),
      modelVersion: `${modelVersion}+news-impact`,
    };
  }
}
