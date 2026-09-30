// POINT-IN-TIME DATA ACCESS — the only way the prediction code reads news and
// candles. Every read takes an `asOf` timestamp and every returned item is
// re-checked, so a bug in a query (or a backfilled article) can never leak
// information from after the prediction timestamp into the features.

import type { Candle, CandleResolution, StoredArticle } from "../domain/types.js";
import type { NewsStorageService } from "../news/NewsStorageService.js";
import type { MarketDataProvider } from "../providers/types.js";

export class LookaheadViolationError extends Error {
  constructor(what: string, itemTime: number, asOf: number) {
    super(
      `Look-ahead violation: ${what} available at ${new Date(itemTime).toISOString()} ` +
        `used for prediction as of ${new Date(asOf).toISOString()}`,
    );
    this.name = "LookaheadViolationError";
  }
}

/** Throws if any item was not available at asOf. Call on every dataset fed to a model. */
export function assertNoLookahead<T>(items: T[], availableAt: (x: T) => number, asOf: number, what: string): T[] {
  for (const x of items) {
    const t = availableAt(x);
    if (!(t <= asOf)) throw new LookaheadViolationError(what, t, asOf);
  }
  return items;
}

const BAR_MS: Record<CandleResolution, number> = { "5min": 5 * 60_000, "1hour": 3600_000, "1day": 24 * 3600_000 };

/**
 * When a bar's values were final. For daily bars (timestamped at 00:00 New York)
 * this is 16:00 New York the same day — the regular-session close.
 */
export function candleAvailableAt(c: Candle, r: CandleResolution): number {
  return r === "1day" ? c.t + 16 * 3600_000 : c.t + BAR_MS[r];
}

export class PointInTimeNewsView {
  constructor(private storage: Pick<NewsStorageService, "listAvailableAt">) {}

  /** Articles related to `symbol` that were published AND available at or before `asOf`. */
  articles(symbol: string, asOf: number, lookbackMs: number): StoredArticle[] {
    const rows = this.storage.listAvailableAt(symbol, asOf, lookbackMs);
    // Both conditions, independently of how the query was written.
    assertNoLookahead(rows, (a) => a.availableAt, asOf, `article ${rows.find((a) => a.availableAt > asOf)?.id}`);
    assertNoLookahead(rows, (a) => a.publishedAt, asOf, "article (published)");
    return rows;
  }
}

export class PointInTimeCandles {
  constructor(private provider: Pick<MarketDataProvider, "getCandles">) {}

  /** Only bars that were complete at `asOf`. */
  async candles(symbol: string, r: CandleResolution, asOf: number, lookbackMs: number): Promise<Candle[]> {
    const all = await this.provider.getCandles(symbol, r, asOf - lookbackMs, asOf);
    const complete = all.filter((c) => candleAvailableAt(c, r) <= asOf);
    return assertNoLookahead(complete, (c) => candleAvailableAt(c, r), asOf, `${symbol} ${r} candle`);
  }
}
