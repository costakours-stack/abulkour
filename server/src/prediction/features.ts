import type { Candle, StoredArticle } from "../domain/types.js";
import { assertNoLookahead } from "./PointInTime.js";

const H = 3600_000;

/**
 * News-derived features as of `asOf`. Articles must already come from
 * PointInTimeNewsView; this re-asserts it anyway.
 */
export function buildNewsFeatures(articles: StoredArticle[], asOf: number): Record<string, number> {
  assertNoLookahead(articles, (a) => a.availableAt, asOf, "article in feature window");
  const analyzed = articles.filter((a) => a.analysis);
  const within = (ms: number) => analyzed.filter((a) => asOf - a.availableAt <= ms);

  // relevance-weighted mean sentiment
  const sentiment = (xs: StoredArticle[]) => {
    let num = 0;
    let den = 0;
    for (const a of xs) {
      const w = Math.max(0.05, a.analysis!.relevanceScore);
      num += a.analysis!.sentimentScore * w;
      den += w;
    }
    return den ? num / den : 0;
  };

  const d7 = within(7 * 24 * H);
  const pos = d7.filter((a) => a.analysis!.sentiment === "positive").length;
  const neg = d7.filter((a) => a.analysis!.sentiment === "negative").length;

  return {
    news_sentiment_1h: sentiment(within(H)),
    news_sentiment_6h: sentiment(within(6 * H)),
    news_sentiment_24h: sentiment(within(24 * H)),
    news_sentiment_7d: sentiment(d7),
    news_volume_1h: articles.filter((a) => asOf - a.availableAt <= H).length,
    news_volume_24h: articles.filter((a) => asOf - a.availableAt <= 24 * H).length,
    high_impact_news_count: within(24 * H).filter((a) => a.analysis!.impact === "high").length,
    positive_news_ratio: d7.length ? pos / d7.length : 0,
    negative_news_ratio: d7.length ? neg / d7.length : 0,
  };
}

/** Price features from completed daily bars plus the price the prediction is measured from. */
export function buildPriceFeatures(daily: Candle[], basePrice: number): Record<string, number> {
  const closes = daily.map((c) => c.c);
  const n = closes.length;
  const ret = (k: number) => (n > k ? basePrice / closes[n - 1 - k] - 1 : 0);
  const dailyReturns = closes.slice(1).map((c, i) => c / closes[i] - 1).slice(-20);
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / (dailyReturns.length || 1);
  const vol = Math.sqrt(dailyReturns.reduce((a, r) => a + (r - mean) ** 2, 0) / (dailyReturns.length || 1));
  const ma20 = n >= 20 ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20 : basePrice;
  return {
    ret_1d: ret(0),
    ret_5d: ret(4),
    ret_20d: ret(19),
    volatility_20d: vol || 0.015,
    dist_ma20: ma20 ? basePrice / ma20 - 1 : 0,
    history_bars: n,
  };
}
