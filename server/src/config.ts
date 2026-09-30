import "dotenv/config";

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Env var ${name} must be a number, got "${raw}"`);
  return n;
}

function list(name: string, fallback: string[] = []): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export const config = {
  port: num("PORT", 4000),
  databasePath: process.env.DATABASE_PATH || "./data/marketpulse.db",

  finnhubApiKey: process.env.FINNHUB_API_KEY || "",
  finnhubQuoteDelayMinutes: num("FINNHUB_QUOTE_DELAY_MINUTES", 0),
  finnhubStreaming: (process.env.FINNHUB_STREAMING ?? "true") === "true",
  quotePollIntervalMs: num("QUOTE_POLL_INTERVAL_MS", 20_000),

  polygonApiKey: process.env.POLYGON_API_KEY || "",
  tiingoApiKey: process.env.TIINGO_API_KEY || "",

  /** Symbols whose daily history trains the model (SPY is always included for market features). */
  trainingUniverse: list("TRAINING_UNIVERSE", [
    "SPY", "QQQ", "DIA", "IWM", "XLK", "XLF", "XLE", "XLV", "XLY", "XLI", "SMH", "TLT",
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "AMD", "INTC", "ORCL", "CRM", "ADBE",
    "JPM", "BAC", "GS", "V", "MA", "XOM", "CVX", "UNH", "JNJ", "LLY", "PFE", "WMT", "COST", "HD", "DIS", "BA", "CAT",
  ]),

  rssFeeds: list("NEWS_RSS_FEEDS"),
  newsPollIntervalMs: num("NEWS_POLL_INTERVAL_MS", 60_000),

  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-opus-5",

  defaultWatchlist: list("DEFAULT_WATCHLIST", ["AAPL", "NVDA", "MSFT", "SPY", "QQQ", "JEPQ"]),

  expoPushEnabled: process.env.EXPO_PUSH_ENABLED === "true",

  /**
   * Shared access code the app must send (header x-app-token, or ?token= for the WebSocket).
   * Empty = no check (fine on a home network; set it when the server is on the internet).
   */
  appAccessToken: process.env.APP_ACCESS_TOKEN || "",
  seedPath: process.env.SEED_PATH || "./seed/seed.json.gz",

  /** Browser origins allowed to call the API (the Expo web build). Native apps are unaffected. */
  corsOrigins: list("CORS_ORIGINS", ["http://localhost:8081", "http://localhost:19006"]),

  /** A quote older than this during regular hours is not shown as LIVE. */
  liveStalenessMs: 2 * 60_000,
};

export type AppConfig = typeof config;
