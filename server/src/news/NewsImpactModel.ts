// Estimates how much an article may move a related stock's price.
//
// Signal s = direction x |sentiment| x relevance x impact weight (from the analysis).
// Expected next-session ABNORMAL move (vs SPY), in units of the stock's daily
// volatility: zMove = k * s. The coefficient k starts from a conservative prior
// and is re-fitted (event study) on stored articles whose outcome is known,
// shrunk toward the prior while the sample is small. Everything here is a model
// estimate and is labeled as such in the API and UI.

import type { Candle, StoredArticle } from "../domain/types.js";
import type { HistoryStore } from "../history/HistoryStore.js";
import { candleAvailableAt } from "../prediction/PointInTime.js";

const IMPACT_WEIGHT = { low: 0.3, medium: 0.7, high: 1.5 } as const;
const PRIOR_K = 0.35;
const PRIOR_STRENGTH = 30;
const H = 3600_000;

export interface PriceImpactEstimate {
  symbol: string;
  estMovePct: number; // central estimate, next session, vs market
  lowPct: number;
  highPct: number;
  direction: "up" | "down" | "flat";
  method: string;
}

export interface ImpactCalibration {
  k: number;
  kFitted: number | null;
  sampleSize: number;
  fittedAt: number;
}

export class NewsImpactModel {
  private volCache = new Map<string, { at: number; vol: number }>();
  calibration: ImpactCalibration = { k: PRIOR_K, kFitted: null, sampleSize: 0, fittedAt: 0 };

  constructor(private history: HistoryStore) {}

  /** Daily log-return volatility over the last 20 sessions (fallback 1.8%). */
  vol20(symbol: string): number {
    const c = this.volCache.get(symbol);
    if (c && Date.now() - c.at < 6 * H) return c.vol;
    const closes = this.history.lastCloses(symbol, 21);
    let vol = 0.018;
    if (closes.length >= 10) {
      const r = closes.slice(1).map((x, i) => Math.log(x / closes[i]));
      const m = r.reduce((s, x) => s + x, 0) / r.length;
      vol = Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / (r.length - 1)) || vol;
    }
    this.volCache.set(symbol, { at: Date.now(), vol });
    return vol;
  }

  /** Signed signal for one article and symbol, roughly in [-1.5, 1.5]. */
  signal(a: StoredArticle, symbol: string): number {
    const an = a.analysis;
    if (!an) return 0;
    const rel = a.relations.find((r) => r.symbol === symbol);
    if (!rel) return 0;
    const si = an.symbolImpacts.find((i) => i.symbol === symbol);
    const dir = si ? (si.direction === "positive" ? 1 : si.direction === "negative" ? -1 : 0) : Math.sign(an.sentimentScore);
    const strength = si ? Math.max(Math.abs(an.sentimentScore), si.confidence) : Math.abs(an.sentimentScore);
    // indirect relations (via holding / sector / macro) carry less of the effect
    const relW = rel.relation === "direct" ? 1 : rel.relation === "holding" ? 0.35 : 0.25;
    return dir * strength * Math.max(0.2, an.relevanceScore) * IMPACT_WEIGHT[an.impact] * relW;
  }

  estimate(a: StoredArticle, symbol: string): PriceImpactEstimate | null {
    const s = this.signal(a, symbol);
    if (!a.analysis) return null;
    const vol = this.vol20(symbol);
    const est = this.calibration.k * s * vol * 100;
    const band = vol * 100 * 0.8; // honest uncertainty: most single-day noise is not news
    const r2 = (x: number) => Math.round(x * 100) / 100;
    return {
      symbol,
      estMovePct: r2(est),
      lowPct: r2(est - band),
      highPct: r2(est + band),
      direction: Math.abs(est) < 0.05 ? "flat" : est > 0 ? "up" : "down",
      method:
        this.calibration.kFitted === null
          ? "prior (not enough resolved news yet)"
          : `event study, n=${this.calibration.sampleSize}`,
    };
  }

  /** Attach estimates for the article's directly related symbols (and the focus symbol, if given). */
  annotate<T extends StoredArticle>(articles: T[], focusSymbol?: string): (T & { priceImpact: PriceImpactEstimate[] })[] {
    return articles.map((a) => {
      const syms = new Set(a.relations.filter((r) => r.relation === "direct").map((r) => r.symbol));
      if (focusSymbol && a.relations.some((r) => r.symbol === focusSymbol)) syms.add(focusSymbol);
      const priceImpact = [...syms]
        .slice(0, 6)
        .map((s) => this.estimate(a, s))
        .filter((x): x is PriceImpactEstimate => !!x);
      return { ...a, priceImpact };
    });
  }

  /**
   * News component for a prediction made at `asOf`: articles that became
   * available after the last completed close (not yet in any closing price).
   * If the market has been open since, half the effect is assumed priced in.
   */
  newsComponent(symbol: string, articles: StoredArticle[], asOf: number, lastCloseAt: number, marketOpenSince: boolean) {
    const fresh = articles.filter((a) => a.availableAt > lastCloseAt && a.availableAt <= asOf && a.analysis);
    const agg = this.aggregate(symbol, fresh);
    return { pct: marketOpenSince ? agg.pct * 0.5 : agg.pct, articleIds: fresh.map((a) => a.id), events: agg.events };
  }

  /**
   * Combined estimate from many articles:
   *  - several outlets covering the same event (same cluster) count once, using the strongest estimate;
   *  - low-impact articles are left out (routine coverage rarely moves prices);
   *  - distinct events combine with diminishing returns (sum / sqrt(n)), since much of a day's
   *    coverage restates the same underlying story;
   *  - the total is capped at 1.5x the stock's daily volatility.
   */
  aggregate(symbol: string, articles: StoredArticle[]): { pct: number; events: number } {
    const byCluster = new Map<string, number>();
    for (const a of articles) {
      if (!a.analysis || a.analysis.impact === "low") continue;
      const e = this.estimate(a, symbol)?.estMovePct ?? 0;
      const prev = byCluster.get(a.clusterId);
      if (prev === undefined || Math.abs(e) > Math.abs(prev)) byCluster.set(a.clusterId, e);
    }
    const vals = [...byCluster.values()].filter((v) => v !== 0);
    const sum = vals.reduce((s, v) => s + v, 0);
    const pct = vals.length ? sum / Math.sqrt(vals.length) : 0;
    const cap = this.vol20(symbol) * 100 * 1.5;
    return { pct: Math.round(Math.max(-cap, Math.min(cap, pct)) * 100) / 100, events: vals.length };
  }

  /**
   * Event study: for each resolved (article, directly-related symbol) pair,
   * abnormal next-session return / vol vs the signal. Least squares through the
   * origin, shrunk toward the prior.
   */
  recalibrate(articles: StoredArticle[]) {
    const spy = this.history.bars("SPY", Date.now() - 400 * 24 * H);
    const barsCache = new Map<string, Candle[]>();
    let sxy = 0, sxx = 0, n = 0;
    for (const a of articles) {
      if (!a.analysis) continue;
      for (const rel of a.relations) {
        if (rel.relation !== "direct") continue;
        let bars = barsCache.get(rel.symbol);
        if (!bars) {
          bars = this.history.bars(rel.symbol, Date.now() - 400 * 24 * H);
          barsCache.set(rel.symbol, bars);
        }
        const k = bars.findIndex((b) => candleAvailableAt(b, "1day") > a.availableAt);
        if (k <= 0 || candleAvailableAt(bars[k], "1day") > Date.now()) continue;
        const ret = bars[k].c / bars[k - 1].c - 1;
        const sk = spy.findIndex((b) => b.t === bars[k].t);
        const mret = sk > 0 ? spy[sk].c / spy[sk - 1].c - 1 : 0;
        const vol = this.vol20(rel.symbol);
        const s = this.signal(a, rel.symbol);
        if (s === 0) continue;
        const zAbn = Math.max(-5, Math.min(5, (ret - mret) / vol));
        sxy += s * zAbn;
        sxx += s * s;
        n++;
      }
    }
    const kFitted = sxx > 0 ? sxy / sxx : null;
    const k = kFitted === null ? PRIOR_K : (n * kFitted + PRIOR_STRENGTH * PRIOR_K) / (n + PRIOR_STRENGTH);
    this.calibration = { k: Math.max(0, Math.min(1, k)), kFitted: n >= 20 ? kFitted : null, sampleSize: n, fittedAt: Date.now() };
    return this.calibration;
  }
}
