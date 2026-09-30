// Provider interfaces. The rest of the app only depends on these, so a
// provider (Finnhub, Polygon, an RSS feed, ...) can be swapped in config.

import type {
  Candle,
  CandleResolution,
  MarketStatusInfo,
  RawArticle,
  RawQuote,
} from "../domain/types.js";

export class ProviderNotSupportedError extends Error {
  constructor(provider: string, feature: string) {
    super(`${provider} does not support ${feature} on the configured plan`);
    this.name = "ProviderNotSupportedError";
  }
}

export interface MarketDataCapabilities {
  realtimeQuotes: boolean;
  /** Minutes behind real time for quotes on this plan. */
  quoteDelayMinutes: number;
  bidAsk: boolean;
  streaming: boolean;
  candles: boolean;
}

export interface TradeTick {
  symbol: string;
  price: number;
  volume: number;
  timestamp: number;
}

export interface MarketDataProvider {
  readonly name: string;
  readonly capabilities: MarketDataCapabilities;
  getQuote(symbol: string): Promise<RawQuote>;
  getCandles(symbol: string, resolution: CandleResolution, from: number, to: number): Promise<Candle[]>;
  getMarketStatus(): Promise<MarketStatusInfo>;
  searchSymbols?(query: string): Promise<{ symbol: string; name: string; type: string }[]>;
  /** Start streaming trades. Returns an unsubscribe function. */
  streamTrades?(symbols: string[], onTick: (tick: TradeTick) => void): () => void;
}

export interface NewsQueryWindow {
  from: number;
  to: number;
}

export interface NewsProvider {
  readonly name: string;
  /** General market / financial news, newest first. */
  fetchLatest(): Promise<RawArticle[]>;
  /** News for one symbol, if the provider supports company-specific queries. */
  fetchForSymbol?(symbol: string, window: NewsQueryWindow): Promise<RawArticle[]>;
}

export interface CompanyProfile {
  symbol: string;
  name: string;
  exchange: string | null;
  industry: string | null;
  country: string | null;
  marketCap: number | null;
  logo: string | null;
  weburl: string | null;
  ipo: string | null;
}

export interface FundamentalMetrics {
  symbol: string;
  peTTM: number | null;
  epsTTM: number | null;
  dividendYield: number | null;
  beta: number | null;
  week52High: number | null;
  week52Low: number | null;
  revenueGrowthTTM: number | null;
  netMarginTTM: number | null;
  asOf: number;
}

export interface EtfHolding {
  symbol: string;
  name: string;
  weightPct: number | null;
}

export interface FundamentalsProvider {
  readonly name: string;
  getProfile(symbol: string): Promise<CompanyProfile | null>;
  getMetrics(symbol: string): Promise<FundamentalMetrics | null>;
  getEtfHoldings?(symbol: string): Promise<EtfHolding[] | null>;
}
