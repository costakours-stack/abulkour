import type { Candle, CandleResolution, MarketStatusInfo, RawQuote } from "../../domain/types.js";
import { getJson, RateLimiter } from "../http.js";
import { ProviderNotSupportedError, type MarketDataCapabilities, type MarketDataProvider } from "../types.js";

const BASE = "https://api.polygon.io";
const limiter = new RateLimiter(12_500); // free plan: 5 calls/min

/**
 * Used for historical candles (charts, prediction features, outcome resolution).
 * Quotes come from the primary provider.
 */
export class PolygonMarketDataProvider implements MarketDataProvider {
  readonly name = "polygon";
  readonly capabilities: MarketDataCapabilities = {
    realtimeQuotes: false,
    quoteDelayMinutes: 15,
    bidAsk: false,
    streaming: false,
    candles: true,
  };
  private cache = new Map<string, { at: number; data: Candle[] }>();

  constructor(private apiKey: string) {}

  async getQuote(_symbol: string): Promise<RawQuote> {
    throw new ProviderNotSupportedError(this.name, "quotes");
  }

  async getMarketStatus(): Promise<MarketStatusInfo> {
    throw new ProviderNotSupportedError(this.name, "market status");
  }

  async getCandles(symbol: string, resolution: CandleResolution, from: number, to: number): Promise<Candle[]> {
    const [mult, span] = resolution === "5min" ? [5, "minute"] : resolution === "1hour" ? [1, "hour"] : [1, "day"];
    const key = `${symbol}:${resolution}:${Math.floor(from / 3.6e6)}:${Math.floor(to / 3.6e6)}`;
    const cached = this.cache.get(key);
    const ttl = resolution === "1day" ? 30 * 60_000 : 5 * 60_000;
    if (cached && Date.now() - cached.at < ttl) return cached.data;

    const qs = new URLSearchParams({ adjusted: "true", sort: "asc", limit: "50000", apiKey: this.apiKey });
    const url = `${BASE}/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/${mult}/${span}/${from}/${to}?${qs}`;
    const r = await getJson<{ results?: { t: number; o: number; h: number; l: number; c: number; v: number }[] }>(
      url,
      { limiter },
    );
    const data = (r.results ?? []).map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
    this.cache.set(key, { at: Date.now(), data });
    return data;
  }
}
