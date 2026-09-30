// Reference data used to link news to stocks/ETFs and to power search.
//
// ETF "referenceHoldings" are a static list of well-known large constituents,
// used ONLY to label "related through a holding" news. They carry no weights
// and may drift; when the fundamentals provider returns live holdings, those
// are shown in the UI instead and marked as provider data.

import type { AssetType } from "../domain/types.js";

export interface CompanyInfo {
  symbol: string;
  name: string;
  aliases: string[]; // lower-case names used for matching in headlines
  sector: string;
  type: "stock";
}

export interface EtfInfo {
  symbol: string;
  name: string;
  aliases: string[];
  type: "etf";
  /** Sectors this ETF is materially exposed to. "broad" = whole market. */
  exposure: string[];
  /** Sensitive to macro news (rates, inflation, jobs, Fed). */
  macroSensitive: boolean;
  referenceHoldings: string[];
  referenceHoldingsNote: string;
}

const C = (symbol: string, name: string, sector: string, aliases: string[] = []): CompanyInfo => ({
  symbol,
  name,
  sector,
  aliases: [name.toLowerCase(), ...aliases.map((a) => a.toLowerCase())],
  type: "stock",
});

export const COMPANIES: CompanyInfo[] = [
  C("AAPL", "Apple", "technology", ["apple inc", "iphone"]),
  C("MSFT", "Microsoft", "technology", ["azure"]),
  C("NVDA", "Nvidia", "semiconductors", ["nvidia corp"]),
  C("AMZN", "Amazon", "consumer", ["amazon.com", "aws"]),
  C("GOOGL", "Alphabet", "communication", ["google", "youtube"]),
  C("META", "Meta Platforms", "communication", ["meta", "facebook", "instagram"]),
  C("TSLA", "Tesla", "consumer", []),
  C("AVGO", "Broadcom", "semiconductors", []),
  C("AMD", "Advanced Micro Devices", "semiconductors", ["amd"]),
  C("INTC", "Intel", "semiconductors", []),
  C("TSM", "Taiwan Semiconductor", "semiconductors", ["tsmc"]),
  C("QCOM", "Qualcomm", "semiconductors", []),
  C("MU", "Micron", "semiconductors", ["micron technology"]),
  C("ASML", "ASML", "semiconductors", []),
  C("ORCL", "Oracle", "technology", []),
  C("CRM", "Salesforce", "technology", []),
  C("ADBE", "Adobe", "technology", []),
  C("NFLX", "Netflix", "communication", []),
  C("COST", "Costco", "consumer", ["costco wholesale"]),
  C("WMT", "Walmart", "consumer", []),
  C("PLTR", "Palantir", "technology", []),
  C("JPM", "JPMorgan Chase", "financials", ["jpmorgan", "jp morgan"]),
  C("GS", "Goldman Sachs", "financials", []),
  C("BAC", "Bank of America", "financials", []),
  C("BRK.B", "Berkshire Hathaway", "financials", ["berkshire"]),
  C("V", "Visa", "financials", []),
  C("MA", "Mastercard", "financials", []),
  C("XOM", "Exxon Mobil", "energy", ["exxon", "exxonmobil"]),
  C("CVX", "Chevron", "energy", []),
  C("UNH", "UnitedHealth", "healthcare", ["unitedhealth group"]),
  C("LLY", "Eli Lilly", "healthcare", ["lilly"]),
  C("JNJ", "Johnson & Johnson", "healthcare", []),
  C("PFE", "Pfizer", "healthcare", []),
  C("BA", "Boeing", "industrials", []),
  C("CAT", "Caterpillar", "industrials", []),
  C("HD", "Home Depot", "consumer", []),
  C("DIS", "Disney", "communication", ["walt disney"]),
];

const E = (e: Omit<EtfInfo, "type" | "aliases"> & { aliases?: string[] }): EtfInfo => ({
  ...e,
  type: "etf",
  aliases: [e.name.toLowerCase(), ...(e.aliases ?? []).map((a) => a.toLowerCase())],
});

const NOTE = "Reference list of large constituents (no weights). Not live data — verify with the issuer.";

export const ETFS: EtfInfo[] = [
  E({
    symbol: "SPY", name: "SPDR S&P 500 ETF", aliases: ["s&p 500", "s&p500"], exposure: ["broad"], macroSensitive: true,
    referenceHoldings: ["NVDA", "MSFT", "AAPL", "AMZN", "META", "AVGO", "GOOGL", "TSLA", "BRK.B", "JPM"],
    referenceHoldingsNote: NOTE,
  }),
  E({
    symbol: "VOO", name: "Vanguard S&P 500 ETF", exposure: ["broad"], macroSensitive: true,
    referenceHoldings: ["NVDA", "MSFT", "AAPL", "AMZN", "META", "AVGO", "GOOGL", "TSLA", "BRK.B", "JPM"],
    referenceHoldingsNote: NOTE,
  }),
  E({
    symbol: "QQQ", name: "Invesco QQQ Trust", aliases: ["nasdaq-100", "nasdaq 100"],
    exposure: ["technology", "semiconductors", "communication"], macroSensitive: true,
    referenceHoldings: ["NVDA", "MSFT", "AAPL", "AMZN", "AVGO", "META", "GOOGL", "TSLA", "NFLX", "COST"],
    referenceHoldingsNote: NOTE,
  }),
  E({
    symbol: "JEPQ", name: "JPMorgan Nasdaq Equity Premium Income ETF",
    exposure: ["technology", "semiconductors", "communication"], macroSensitive: true,
    referenceHoldings: ["NVDA", "MSFT", "AAPL", "AMZN", "AVGO", "META", "GOOGL", "TSLA"],
    referenceHoldingsNote: NOTE + " JEPQ also holds equity-linked notes (options overlay).",
  }),
  E({
    symbol: "DIA", name: "SPDR Dow Jones Industrial Average ETF", aliases: ["dow jones", "the dow"],
    exposure: ["broad"], macroSensitive: true,
    referenceHoldings: ["GS", "MSFT", "HD", "CAT", "UNH", "V", "AAPL", "JPM"],
    referenceHoldingsNote: NOTE,
  }),
  E({
    symbol: "SMH", name: "VanEck Semiconductor ETF", exposure: ["semiconductors"], macroSensitive: false,
    referenceHoldings: ["NVDA", "TSM", "AVGO", "AMD", "ASML", "QCOM", "MU", "INTC"], referenceHoldingsNote: NOTE,
  }),
  E({
    symbol: "XLK", name: "Technology Select Sector SPDR", exposure: ["technology", "semiconductors"], macroSensitive: false,
    referenceHoldings: ["NVDA", "MSFT", "AAPL", "AVGO", "ORCL", "CRM", "AMD", "ADBE"], referenceHoldingsNote: NOTE,
  }),
  E({
    symbol: "XLE", name: "Energy Select Sector SPDR", exposure: ["energy"], macroSensitive: false,
    referenceHoldings: ["XOM", "CVX"], referenceHoldingsNote: NOTE,
  }),
  E({
    symbol: "XLF", name: "Financial Select Sector SPDR", exposure: ["financials"], macroSensitive: true,
    referenceHoldings: ["BRK.B", "JPM", "V", "MA", "BAC", "GS"], referenceHoldingsNote: NOTE,
  }),
  E({
    symbol: "TLT", name: "iShares 20+ Year Treasury Bond ETF", aliases: ["treasury bonds"], exposure: ["rates"],
    macroSensitive: true, referenceHoldings: [], referenceHoldingsNote: "Holds long-dated US Treasuries.",
  }),
  E({
    symbol: "USO", name: "United States Oil Fund", aliases: ["crude oil fund"], exposure: ["energy"],
    macroSensitive: false, referenceHoldings: [], referenceHoldingsNote: "Holds oil futures.",
  }),
  E({
    symbol: "VIXY", name: "ProShares VIX Short-Term Futures ETF", exposure: ["volatility"], macroSensitive: true,
    referenceHoldings: [], referenceHoldingsNote: "Holds VIX futures.",
  }),
];

/**
 * Home-screen market tiles. Index levels usually need a paid data plan, so
 * these use ETF proxies and the UI labels them as such.
 */
export const MARKET_TILES = [
  { label: "S&P 500", symbol: "SPY", note: "via SPY (ETF proxy)" },
  { label: "NASDAQ", symbol: "QQQ", note: "via QQQ (ETF proxy, Nasdaq-100)" },
  { label: "Dow Jones", symbol: "DIA", note: "via DIA (ETF proxy)" },
  { label: "VIX", symbol: "VIXY", note: "via VIXY (VIX futures ETF — not the VIX index)" },
];

/** Search themes -> related symbols + keywords. */
export const THEMES: Record<string, { symbols: string[]; keywords: string[]; sectors?: string[] }> = {
  "ai stocks": {
    symbols: ["NVDA", "MSFT", "GOOGL", "META", "AMD", "AVGO", "PLTR", "SMH", "QQQ"],
    keywords: ["artificial intelligence", "ai", "generative", "llm", "data center", "gpu", "openai", "anthropic"],
  },
  semiconductors: {
    symbols: ["NVDA", "AMD", "AVGO", "TSM", "INTC", "QCOM", "MU", "ASML", "SMH"],
    keywords: ["chip", "chips", "semiconductor", "semiconductors", "foundry", "wafer"],
    sectors: ["semiconductors"],
  },
  oil: {
    symbols: ["XOM", "CVX", "XLE", "USO"],
    keywords: ["oil", "crude", "opec", "brent", "wti", "barrel", "gasoline"],
    sectors: ["energy"],
  },
  "federal reserve": {
    symbols: ["SPY", "QQQ", "TLT", "XLF"],
    keywords: ["federal reserve", "fed", "powell", "fomc", "interest rate", "rate cut", "rate hike", "monetary policy"],
  },
  banks: { symbols: ["JPM", "GS", "BAC", "XLF"], keywords: ["bank", "banks", "lender"], sectors: ["financials"] },
};

export const MACRO_KEYWORDS = [
  "federal reserve", "fed ", "fomc", "powell", "interest rate", "rate cut", "rate hike", "inflation", "cpi", "pce",
  "jobs report", "nonfarm", "payrolls", "unemployment", "gdp", "recession", "treasury yield", "bond yields", "tariff",
];

export const SECTOR_KEYWORDS: Record<string, string[]> = {
  semiconductors: ["chip", "chips", "semiconductor", "chipmaker", "foundry", "export controls on chips"],
  energy: ["oil", "crude", "opec", "natural gas", "refiner"],
  financials: ["bank", "banks", "lender", "credit card", "capital requirements"],
  technology: ["software", "cloud computing", "cybersecurity", "tech stocks"],
  healthcare: ["fda", "drugmaker", "pharma", "biotech"],
  rates: ["treasury", "bond yields", "10-year yield"],
};

const companyBySymbol = new Map(COMPANIES.map((c) => [c.symbol, c]));
const etfBySymbol = new Map(ETFS.map((e) => [e.symbol, e]));

export function getCompany(symbol: string) {
  return companyBySymbol.get(symbol.toUpperCase());
}
export function getEtf(symbol: string) {
  return etfBySymbol.get(symbol.toUpperCase());
}
export function assetType(symbol: string): AssetType | null {
  if (etfBySymbol.has(symbol.toUpperCase())) return "etf";
  if (companyBySymbol.has(symbol.toUpperCase())) return "stock";
  return null;
}
export function isKnownEtf(symbol: string) {
  return etfBySymbol.has(symbol.toUpperCase());
}

export function localSearch(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results: { symbol: string; name: string; type: string }[] = [];
  for (const c of COMPANIES)
    if (c.symbol.toLowerCase().startsWith(q) || c.aliases.some((a) => a.includes(q)))
      results.push({ symbol: c.symbol, name: c.name, type: "stock" });
  for (const e of ETFS)
    if (e.symbol.toLowerCase().startsWith(q) || e.aliases.some((a) => a.includes(q)))
      results.push({ symbol: e.symbol, name: e.name, type: "etf" });
  return results;
}
