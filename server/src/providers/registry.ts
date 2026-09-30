// Builds the concrete providers from config. This is the only file that knows
// which vendors are in use.

import type { AppConfig } from "../config.js";
import type { Candle, CandleResolution, MarketStatusInfo, RawQuote } from "../domain/types.js";
import { FinnhubFundamentalsProvider } from "./finnhub/FinnhubFundamentalsProvider.js";
import { FinnhubMarketDataProvider } from "./finnhub/FinnhubMarketDataProvider.js";
import { FinnhubNewsProvider } from "./finnhub/FinnhubNewsProvider.js";
import { PolygonMarketDataProvider } from "./polygon/PolygonMarketDataProvider.js";
import { RssNewsProvider } from "./rss/RssNewsProvider.js";
import {
  ProviderNotSupportedError,
  type FundamentalsProvider,
  type MarketDataCapabilities,
  type MarketDataProvider,
  type NewsProvider,
  type TradeTick,
} from "./types.js";

/** Routes each call to the first provider that supports it. */
class CompositeMarketDataProvider implements MarketDataProvider {
  readonly name: string;
  readonly capabilities: MarketDataCapabilities;

  constructor(private quotes: MarketDataProvider | null, private history: MarketDataProvider | null) {
    this.name = [quotes?.name, history?.name].filter(Boolean).join("+") || "none";
    this.capabilities = {
      realtimeQuotes: quotes?.capabilities.realtimeQuotes ?? false,
      quoteDelayMinutes: quotes?.capabilities.quoteDelayMinutes ?? 0,
      bidAsk: quotes?.capabilities.bidAsk ?? false,
      streaming: quotes?.capabilities.streaming ?? false,
      candles: history?.capabilities.candles ?? quotes?.capabilities.candles ?? false,
    };
  }

  getQuote(symbol: string): Promise<RawQuote> {
    if (!this.quotes) return Promise.reject(new Error("No market data provider configured (set FINNHUB_API_KEY)."));
    return this.quotes.getQuote(symbol);
  }

  getCandles(symbol: string, r: CandleResolution, from: number, to: number): Promise<Candle[]> {
    const p = this.history?.capabilities.candles ? this.history : this.quotes?.capabilities.candles ? this.quotes : null;
    if (!p) throw new ProviderNotSupportedError("none", "historical candles (set POLYGON_API_KEY)");
    return p.getCandles(symbol, r, from, to);
  }

  getMarketStatus(): Promise<MarketStatusInfo> {
    if (!this.quotes) throw new ProviderNotSupportedError("none", "market status");
    return this.quotes.getMarketStatus();
  }

  async searchSymbols(q: string) {
    return this.quotes?.searchSymbols ? this.quotes.searchSymbols(q) : [];
  }

  streamTrades(symbols: string[], onTick: (t: TradeTick) => void) {
    if (!this.quotes?.streamTrades || !this.capabilities.streaming) return () => {};
    return this.quotes.streamTrades(symbols, onTick);
  }
}

export interface Providers {
  market: MarketDataProvider;
  news: NewsProvider[];
  fundamentals: FundamentalsProvider | null;
}

export function buildProviders(cfg: AppConfig): Providers {
  const finnhubMarket = cfg.finnhubApiKey
    ? new FinnhubMarketDataProvider(cfg.finnhubApiKey, cfg.finnhubQuoteDelayMinutes, cfg.finnhubStreaming)
    : null;
  const polygon = cfg.polygonApiKey ? new PolygonMarketDataProvider(cfg.polygonApiKey) : null;

  const news: NewsProvider[] = [];
  if (cfg.finnhubApiKey) news.push(new FinnhubNewsProvider(cfg.finnhubApiKey));
  for (const feed of cfg.rssFeeds) {
    try {
      news.push(new RssNewsProvider(feed));
    } catch {
      console.warn(`[providers] ignoring invalid RSS feed URL: ${feed}`);
    }
  }

  if (!finnhubMarket) console.warn("[providers] FINNHUB_API_KEY not set: quotes will show DATA UNAVAILABLE.");
  if (!polygon) console.warn("[providers] POLYGON_API_KEY not set: charts/historical data unavailable.");
  if (news.length === 0) console.warn("[providers] No news providers configured: news feed will be empty.");

  return {
    market: new CompositeMarketDataProvider(finnhubMarket, polygon),
    news,
    fundamentals: cfg.finnhubApiKey ? new FinnhubFundamentalsProvider(cfg.finnhubApiKey) : null,
  };
}
