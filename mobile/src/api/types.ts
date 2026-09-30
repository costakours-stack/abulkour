// Mirror of the backend's API types (server/src/domain/types.ts).

export type DataStatus = "LIVE" | "DELAYED" | "MARKET_CLOSED" | "DATA_UNAVAILABLE";

export interface Quote {
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
  dataTimestamp: number;
  provider: string;
  status: DataStatus;
  statusReason: string;
  session: string;
  delayMinutes: number;
  receivedAt: number;
}

export interface UnavailableQuote {
  symbol: string;
  status: "DATA_UNAVAILABLE";
  statusReason: string;
}

export type AnyQuote = Quote | UnavailableQuote;
export const hasPrice = (q: AnyQuote | null | undefined): q is Quote => !!q && "price" in q;

export type Sentiment = "positive" | "neutral" | "negative";
export type RelationType = "direct" | "holding" | "sector" | "macro";

export interface ArticleRelation {
  symbol: string;
  relation: RelationType;
  via?: string;
  label: string;
}

export interface NewsAnalysis {
  sentiment: Sentiment;
  sentimentScore: number;
  relevanceScore: number;
  impact: "low" | "medium" | "high";
  relatedSymbols: string[];
  summary: string;
  reason: string;
  category: string;
  symbolImpacts: { symbol: string; direction: Sentiment; confidence: number }[];
  analyzer: string;
  analyzedAt: number;
}

export interface Article {
  id: string;
  clusterId: string;
  headline: string;
  source: string;
  url: string;
  publishedAt: number;
  retrievedAt: number;
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
  alsoReportedBy?: { source: string; url: string }[];
  /** Model estimate of the next-session move each related symbol may see from this article. */
  priceImpact?: PriceImpact[];
}

export interface PriceImpact {
  symbol: string;
  estMovePct: number;
  lowPct: number;
  highPct: number;
  direction: "up" | "down" | "flat";
  method: string;
}

export interface NewsMomentum {
  articles24h: number;
  positive: number;
  negative: number;
  estMovePct: number;
}

export interface FoldMetrics {
  label: string;
  testRows: number;
  hitRate: number;
  baselineHitRate: number;
  ic: number;
  maeReturnPct: number;
}

export interface ModelRecord {
  version: string;
  dataSource: string;
  trainStart: number;
  trainEnd: number;
  symbol: { n: number; hitRate: number; baselineHitRate: number } | null;
  overall: { testRows: number; hitRate: number; baselineHitRate: number; ic: number; maeReturnPct: number };
  folds: FoldMetrics[];
  topFeatures: { name: string; importance: number }[];
}

export interface ImpactCalibration {
  k: number;
  kFitted: number | null;
  sampleSize: number;
  fittedAt: number;
}

export interface AnalystBrief {
  symbol: string;
  stance: "bullish" | "neutral" | "bearish";
  headline: string;
  summary: string;
  drivers: { title: string; detail: string; direction: Sentiment }[];
  risks: string[];
  watchNext: string[];
  confidence: number;
  generatedAt: number;
  model: string;
}

export interface PredictionOutcome {
  resolvedAt: number;
  actualPrice: number;
  actualReturnPct: number;
  directionCorrect: boolean;
  absError: number;
  priceTimestamp: number;
}

export interface Prediction {
  id: string;
  symbol: string;
  modelVersion: string;
  predictionTimestamp: number;
  marketDataTimestamp: number;
  latestNewsTimestamp: number | null;
  newsArticleIds: string[];
  horizon: string;
  basePrice: number;
  predictedReturnPct: number;
  probabilityUp: number;
  confidence: number;
  features: Record<string, number>;
  trigger: string;
  outcome: PredictionOutcome | null;
}

export interface PredictionTrace extends Prediction {
  newsUsed: { id: string; headline: string; source: string; url: string; publishedAt: number; availableAt: number; sentiment: Sentiment | null }[];
}

export interface Performance {
  modelVersion: string;
  resolvedCount: number;
  directionHitRate: number;
  meanAbsErrorPct: number;
  avgPredictedPct: number;
  avgActualPct: number;
}

export interface MarketStatus {
  isOpen: boolean;
  session: string;
  exchange: string;
  asOf: number;
  source: string;
}

export interface Dashboard {
  marketStatus: MarketStatus;
  markets: { label: string; symbol: string; note: string; quote: AnyQuote }[];
  watchlist: { symbol: string; name: string; quote: AnyQuote }[];
  aiSignals: Prediction[];
  latestNews: Article[];
  highImpact: Article[];
  sparklines: Record<string, number[]>;
  newsMomentum: Record<string, NewsMomentum>;
}

export interface AssetOverview {
  symbol: string;
  type: "stock" | "etf" | "unknown";
  name: string;
  sector: string | null;
  quote: AnyQuote;
  profile: { name: string; exchange: string | null; industry: string | null; marketCap: number | null; weburl: string | null } | null;
  holdings: { source: "provider" | "reference"; note: string; items: { symbol: string; name: string; weightPct: number | null }[] } | null;
}

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface AlertEvent {
  id: string;
  symbol: string;
  kind: "new_article" | "high_impact" | "unusual_sentiment";
  title: string;
  body: string;
  articleId?: string;
  createdAt: number;
}

export interface AlertPrefs {
  symbol: string;
  newArticle: boolean;
  highImpact: boolean;
  unusualSentiment: boolean;
}

export interface TopPick {
  rank: number;
  symbol: string;
  name: string;
  type: "stock" | "etf";
  basePrice: number;
  marketDataTimestamp: number;
  estPct: number;
  technicalPct: number;
  newsPct: number;
  lowPct: number;
  highPct: number;
  probabilityUp: number;
  fc5Pct: number | null;
  fc20Pct: number | null;
  newsEvents: number;
  drivers: { feature: string; contributionPct: number }[];
  quote: AnyQuote;
  spark: number[];
}

export interface TopPicksResponse {
  scan: { id: string; createdAt: number; modelVersion: string; universeSize: number; picks: TopPick[] } | null;
  track: {
    scans: { scanId: string; createdAt: number; picks: number; picksAvgPct: number; universeAvgPct: number; picksUpShare: number }[];
    summary: { days: number; picksAvgPct: number; universeAvgPct: number; beatUniverseShare: number } | null;
  };
  model: { version: string; hitRate: number; baselineHitRate: number; ic: number; dataSource: string } | null;
  disclaimer: string;
}

export interface PaperTrade {
  id: string;
  at: number;
  side: "BUY" | "SELL";
  symbol: string;
  qty: number;
  price: number;
  value: number;
  reason: string;
  estPct: number | null;
  probUp: number | null;
  realizedPnl: number | null;
  realizedPct: number | null;
}

export interface PaperSession {
  date: string;
  status: "trading" | "closed";
  startedAt: number;
  endedAt: number | null;
  startEquity: number;
  equity: number;
  cash: number;
  pnl: number;
  pnlPct: number;
  spyPct: number | null;
  trades: number;
  closedTrades: number;
  winRate: number | null;
  best: number | null;
  worst: number | null;
  slippageCost: number;
  positions: { symbol: string; name: string; qty: number; entryPrice: number; price: number; value: number; pnl: number; pnlPct: number; entryAt: number; estAtEntry: number }[];
  tradeLog: PaperTrade[];
  equityCurve: { t: number; equity: number; spyEquity: number | null }[];
}

export interface PaperSnapshot {
  simulated: true;
  now: number;
  marketOpen: boolean;
  tradingWindow: boolean;
  lastRunAt: number | null;
  lastError: string | null;
  rules: {
    startingCash: number; maxPositions: number; cashReserve: number; minEstPct: number; minProbUp: number;
    stopLossPct: number; takeProfitPct: number; slippage: number; intervalMs: number;
  };
  current: PaperSession | null;
  history: { date: string; pnl: number; pnlPct: number; spyPct: number | null; trades: number; winRate: number | null }[];
}
