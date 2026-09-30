// Core domain types shared across the backend. The mobile app has a mirror of
// the API-facing subset in mobile/src/api/types.ts.

export type AssetType = "stock" | "etf" | "index_proxy";

/**
 * Data status shown in the UI. Never show old data as LIVE.
 *  LIVE             market open, provider is real-time, quote is fresh
 *  DELAYED          provider/plan is delayed, or the quote is stale during market hours
 *  MARKET_CLOSED    regular session is closed; value is the last available price
 *  DATA_UNAVAILABLE provider error / no data
 */
export type DataStatus = "LIVE" | "DELAYED" | "MARKET_CLOSED" | "DATA_UNAVAILABLE";

export type MarketSession = "pre-market" | "regular" | "post-market" | "closed";

export interface RawQuote {
  symbol: string;
  price: number;
  change: number | null;
  changePercent: number | null;
  previousClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  bid: number | null;
  ask: number | null;
  /** Timestamp of the price itself (last trade), epoch ms, from the provider. */
  dataTimestamp: number;
  provider: string;
}

export interface Quote extends RawQuote {
  status: DataStatus;
  statusReason: string;
  session: MarketSession;
  /** Minutes behind real time the provider says its data is. */
  delayMinutes: number;
  /** When our backend received this quote, epoch ms. */
  receivedAt: number;
}

export interface Candle {
  /** Bar start, epoch ms */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type CandleResolution = "5min" | "1hour" | "1day";

export interface MarketStatusInfo {
  isOpen: boolean;
  session: MarketSession;
  exchange: string;
  asOf: number;
  source: string;
}

// ------------------------------------------------------------------ news

export type Sentiment = "positive" | "neutral" | "negative";
export type Impact = "low" | "medium" | "high";
export type NewsCategory =
  | "earnings"
  | "m&a"
  | "analyst"
  | "regulatory"
  | "macro"
  | "product"
  | "company"
  | "market"
  | "other";

/** How an article relates to an asset. Shown to the user as a label. */
export type RelationType =
  | "direct" // article is about this asset itself
  | "holding" // related through a major ETF holding
  | "sector" // sector news that materially affects the asset
  | "macro"; // macro news that materially affects the asset

export interface ArticleRelation {
  symbol: string;
  relation: RelationType;
  /** Symbol the relation goes through (for holding), or sector name. */
  via?: string;
  /** Human-readable label, e.g. "Related through NVDA, one of QQQ's major holdings." */
  label: string;
}

/** What a provider hands us, before classification/analysis. */
export interface RawArticle {
  provider: string;
  providerArticleId?: string;
  headline: string;
  source: string;
  url: string;
  publishedAt: number;
  /** Short publisher-provided description/excerpt, if the API supplies one. */
  providerSnippet?: string;
  /** Tickers the provider itself tagged, if any. */
  providerSymbols?: string[];
  imageUrl?: string;
}

export interface SymbolImpact {
  symbol: string;
  direction: "positive" | "negative" | "neutral";
  /** 0..1 model confidence in the direction estimate. */
  confidence: number;
}

/** AI (or rule-based) interpretation. Always presented as analysis, not fact. */
export interface NewsAnalysis {
  sentiment: Sentiment;
  sentimentScore: number; // -1..+1
  relevanceScore: number; // 0..1
  impact: Impact;
  relatedSymbols: string[];
  summary: string;
  reason: string;
  category: NewsCategory;
  symbolImpacts: SymbolImpact[];
  analyzer: string; // e.g. "claude-opus-5" or "rules-v1"
  analyzedAt: number;
}

export interface StoredArticle {
  id: string;
  clusterId: string;
  headline: string;
  source: string;
  url: string;
  publishedAt: number;
  retrievedAt: number;
  /**
   * Earliest time the system could legitimately have known about this article.
   * Point-in-time queries (backtests, features) filter on this, never on retrievedAt alone.
   */
  availableAt: number;
  providerSnippet: string | null;
  provider: string;
  imageUrl: string | null;
  relatedSymbols: string[];
  relatedCompanies: string[];
  relatedEtfs: string[];
  relations: ArticleRelation[];
  sectors: string[];
  analysis: NewsAnalysis | null;
  /** Other sources reporting the same event (same clusterId). */
  alsoReportedBy?: { source: string; url: string }[];
}

// ------------------------------------------------------------------ predictions

export interface PredictionRecord {
  id: string;
  symbol: string;
  modelVersion: string;
  /** When the prediction was generated. */
  predictionTimestamp: number;
  /** Timestamp of the latest market data the model saw. */
  marketDataTimestamp: number;
  /** Availability timestamp of the newest article the model saw (null if none). */
  latestNewsTimestamp: number | null;
  /** IDs of every article that fed the features. */
  newsArticleIds: string[];
  horizon: "1d";
  /** Price the prediction is measured from. */
  basePrice: number;
  predictedReturnPct: number;
  probabilityUp: number;
  confidence: number;
  features: Record<string, number>;
  trigger: string;
  /** Filled in later in a separate table; never mutates the prediction row. */
  outcome?: PredictionOutcome | null;
}

export interface PredictionOutcome {
  predictionId: string;
  resolvedAt: number;
  actualPrice: number;
  actualReturnPct: number;
  directionCorrect: boolean;
  absError: number;
  priceTimestamp: number;
}

export interface AlertEvent {
  id: string;
  deviceId: string;
  symbol: string;
  kind: "new_article" | "high_impact" | "unusual_sentiment";
  title: string;
  body: string;
  articleId?: string;
  createdAt: number;
}
