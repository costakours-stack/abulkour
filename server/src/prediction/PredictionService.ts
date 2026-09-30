// Live prediction updates:
//  1. receive a market/news event
//  2. update features (point-in-time)
//  3. decide whether to recalculate
//  4. generate a new prediction = technical models (1/5/20d) + news impact component
//  5. store it (append-only)
//  6. push it with its timestamps

import { randomUUID } from "node:crypto";
import type { EventBus } from "../events.js";
import type { PredictionOutcome, PredictionRecord, Quote, StoredArticle } from "../domain/types.js";
import type { HistoryStore } from "../history/HistoryStore.js";
import type { LiveMarketService } from "../market/LiveMarketService.js";
import type { Forecaster } from "./Forecaster.js";
import { candleAvailableAt } from "./PointInTime.js";
import type { PredictionStore } from "./PredictionStore.js";

const MIN = 60_000;

export interface RecalcPolicy {
  newsCooldownMs: number;
  priceCooldownMs: number;
  priceMovePct: number;
  scheduledMs: number;
}

export const DEFAULT_POLICY: RecalcPolicy = {
  newsCooldownMs: 5 * MIN,
  priceCooldownMs: 15 * MIN,
  priceMovePct: 1.0,
  scheduledMs: 60 * MIN,
};

export class PredictionService {
  private inflight = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private forecaster: Forecaster,
    private history: HistoryStore,
    private store: PredictionStore,
    private market: LiveMarketService,
    private bus: EventBus,
    private watchlist: () => string[],
    private policy: RecalcPolicy = DEFAULT_POLICY,
  ) {}

  get modelVersion() {
    return this.store.latestAny()?.modelVersion ?? "not yet run";
  }

  start() {
    this.bus.on("article:analyzed", (a) => this.onArticle(a));
    this.bus.on("quote", (q) => this.onQuote(q));
    const scheduled = async () => {
      await this.resolveOutcomes().catch((e) => console.warn("[prediction] outcome resolution failed:", e.message));
      if (!this.market.marketStatus.isOpen) return;
      for (const s of this.watchlist()) {
        const last = this.store.latest(s);
        if (!last || Date.now() - last.predictionTimestamp >= this.policy.scheduledMs)
          await this.generate(s, "scheduled refresh").catch(() => {});
      }
    };
    setTimeout(scheduled, 15_000);
    this.timer = setInterval(scheduled, 10 * MIN);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---- step 3: should we recalculate?

  private onArticle(a: StoredArticle) {
    const an = a.analysis;
    if (!an || an.impact === "low" || an.relevanceScore < 0.5) return;
    // Only genuinely new information triggers a recalculation, not the initial backlog load.
    if (Date.now() - a.publishedAt > 2 * 3600_000) return;
    const symbols = a.relations.filter((r) => r.relation === "direct" || r.relation === "holding").map((r) => r.symbol);
    for (const s of symbols) {
      if (!this.watchlist().includes(s) || this.inflight.has(s)) continue;
      const last = this.store.latest(s);
      if (last && Date.now() - last.predictionTimestamp < this.policy.newsCooldownMs) continue;
      void this.generate(s, `${an.impact}-impact news: "${a.headline.slice(0, 80)}"`).catch((e) =>
        console.warn(`[prediction] ${s}: ${e.message}`),
      );
    }
  }

  private onQuote(q: Quote) {
    if (q.status !== "LIVE" && q.status !== "DELAYED") return;
    if (!this.watchlist().includes(q.symbol) || this.inflight.has(q.symbol)) return;
    const last = this.store.latest(q.symbol);
    if (!last) return;
    if (Date.now() - last.predictionTimestamp < this.policy.priceCooldownMs) return;
    const movePct = ((q.price - last.basePrice) / last.basePrice) * 100;
    if (Math.abs(movePct) >= this.policy.priceMovePct)
      void this.generate(q.symbol, `price moved ${movePct.toFixed(2)}% since last prediction`).catch(() => {});
  }

  // ---- steps 2, 4, 5, 6

  async generate(symbolIn: string, trigger: string): Promise<PredictionRecord> {
    const symbol = symbolIn.toUpperCase();
    if (this.inflight.has(symbol)) throw new Error(`Prediction for ${symbol} already in progress`);
    this.inflight.add(symbol);
    try {
      const quote = await this.market.getQuoteFresh(symbol);
      if (!("price" in quote))
        throw Object.assign(new Error(`Cannot predict ${symbol}: ${quote.statusReason}`), { status: 503 });
      // asOf is fixed BEFORE any data is read; nothing newer may be used.
      const f = this.forecaster.forecast(symbol, quote, Date.now());
      if (!f) throw Object.assign(new Error(`Not enough data to forecast ${symbol}`), { status: 503 });
      const h1 = f.horizons[0];
      const record: PredictionRecord = {
        id: randomUUID(),
        symbol,
        modelVersion: f.modelVersion,
        predictionTimestamp: f.asOf,
        marketDataTimestamp: f.marketDataTimestamp,
        latestNewsTimestamp: f.latestNewsTimestamp,
        newsArticleIds: f.articleIds,
        horizon: "1d",
        basePrice: f.basePrice,
        predictedReturnPct: Math.round(h1.totalPct * 100) / 100,
        probabilityUp: Math.round(h1.probabilityUp * 1000) / 1000,
        confidence: Math.round(Math.min(0.95, Math.abs(h1.probabilityUp - 0.5) * 2 + 0.05) * 100) / 100,
        features: f.features,
        trigger,
      };
      this.store.insert(record);
      this.bus.emit("prediction", record);
      return record;
    } finally {
      this.inflight.delete(symbol);
    }
  }

  // ---- outcomes: the "eventual actual result" for traceability

  /** Horizon "1d" = the first regular-session close strictly after the prediction. */
  async resolveOutcomes(): Promise<number> {
    const pending = this.store.unresolved(Date.now() - 60 * MIN);
    let resolved = 0;
    for (const p of pending) {
      const bars = this.history.bars(p.symbol, p.predictionTimestamp - 3 * 86_400_000);
      const bar = bars.find((b) => candleAvailableAt(b, "1day") > p.predictionTimestamp && candleAvailableAt(b, "1day") <= Date.now());
      if (!bar) continue;
      const actualReturnPct = (bar.c / p.basePrice - 1) * 100;
      const outcome: PredictionOutcome = {
        predictionId: p.id,
        resolvedAt: Date.now(),
        actualPrice: bar.c,
        actualReturnPct: Math.round(actualReturnPct * 100) / 100,
        directionCorrect: Math.sign(actualReturnPct) === Math.sign(p.predictedReturnPct),
        absError: Math.round(Math.abs(actualReturnPct - p.predictedReturnPct) * 100) / 100,
        priceTimestamp: candleAvailableAt(bar, "1day"),
      };
      this.store.recordOutcome(outcome);
      resolved++;
    }
    return resolved;
  }
}
