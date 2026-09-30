# Abulkour

A live market dashboard, a financial news terminal, AI stock/ETF analysis and a traceable prediction system.

```
server/   Node.js + TypeScript API, WebSocket, news pipeline, predictions (SQLite)
mobile/   Expo React Native app (TypeScript)
```

## Quick start

```bash
cd server
cp .env.example .env        # add FINNHUB_API_KEY, optionally POLYGON_API_KEY and ANTHROPIC_API_KEY
npm install
npm run dev                 # http://localhost:4000/api , ws://localhost:4000/ws
npm test                    # point-in-time, dedup, classification, status and pipeline tests

cd ../mobile
cp .env.example .env        # EXPO_PUBLIC_API_URL = your computer's LAN IP when using a phone
npm install
npx expo start
```

Requires Node 22.13+ (uses the built-in `node:sqlite`).

## Data providers

The app never talks to a data vendor directly and holds **no API keys**; all keys live in `server/.env`.
Every vendor sits behind an interface in `server/src/providers/types.ts`:

| Interface | Implementations | Used for |
|---|---|---|
| `MarketDataProvider` | Finnhub (quotes, market status, trade WebSocket, symbol search), Polygon (historical candles) | Prices, charts, prediction features, outcome resolution |
| `NewsProvider` | Finnhub market + company news, any publisher RSS/Atom feed (`NEWS_RSS_FEEDS`) | News ingestion |
| `FundamentalsProvider` | Finnhub profile + metrics (+ ETF holdings on plans that include it) | Fundamentals tab, ETF holdings |

To change vendors, implement the interface and wire it up in `server/src/providers/registry.ts`. Nothing else changes.

What the free plans don't include is shown as unavailable, not faked: no bid/ask or volume in Finnhub's `/quote`
("Not provided by current data plan"), no index levels (the home screen uses SPY/QQQ/DIA/VIXY and labels them as ETF proxies),
and no ETF holdings (a reference list of major constituents is shown and labeled as not live).

## Data status: never show old data as live

Each quote carries `status` = `LIVE | DELAYED | MARKET_CLOSED | DATA_UNAVAILABLE`, a reason, and the provider's own data timestamp.

* Server (`market/LiveMarketService.ts#computeStatus`): LIVE only when the market is open, the plan is real-time
  (`FINNHUB_QUOTE_DELAY_MINUTES=0`) and the last trade is under 2 minutes old. A delayed plan always shows **DELAYED**
  and "Delayed market data."
* App (`mobile/src/hooks.ts#effectiveStatus`): can only *downgrade* the status. If the WebSocket drops or updates stop,
  a LIVE quote turns DELAYED on screen.
* The header shows `Last updated: 10:32:14` from the provider timestamp, not from when the app fetched it.

Refresh rate: polling every `QUOTE_POLL_INTERVAL_MS` (set it from your plan's rate limit) plus Finnhub's trade stream
when `FINNHUB_STREAMING=true`, throttled to one push per symbol per second.

## News pipeline

```
providers -> NewsAggregator -> NewsDeduplicationService -> NewsClassifier -> NewsStorageService
          -> NewsSentimentService (AI analysis) -> storage -> EventBus -> WebSocket / alerts / prediction triggers
```

* **Deduplication:** canonical URLs (tracking parameters stripped) drop exact duplicates. Near-identical headlines are
  treated as the same syndicated story. Similar headlines within 36h share a `clusterId`, and the feed shows one card with
  "Also reported by …".
* **Classification:** ticker/company/ETF matching, then relations per asset: `direct`, `holding`
  ("Related through NVDA, one of QQQ's major holdings."), `sector`, `macro`. Holding news is never labeled as direct ETF news.
* **AI analysis:** Claude (`claude-opus-5`, low effort, structured output) returns sentiment, a −1..+1 score, relevance,
  impact, category, related symbols, a short summary in its own words, a reason, and a potential impact per symbol with a
  confidence. It only sees the headline, source, time and the publisher's short excerpt; articles are never scraped.
  Without `ANTHROPIC_API_KEY`, or if a call fails or is refused, a keyword analyzer runs instead and is labeled `rules-v1`.
* **In the app:** **FACT** (headline, source, times, publisher excerpt, link to the original) is kept separate from
  **AI ANALYSIS**, which is labeled "model interpretation, not fact". Impact is worded as
  "Model estimates a positive potential impact", never as a forecast.
* **Live updates:** new articles are pushed over WebSocket (`news:all`, `news:<SYMBOL>`, `news:high-impact`) and appear
  without a manual refresh.

## Predictions and point-in-time safety

* Every prediction stores `predictionTimestamp`, `marketDataTimestamp`, `latestNewsTimestamp`, `modelVersion`, the IDs of
  every article it used, its features and what triggered it. `GET /api/predictions/:id` returns the whole record,
  including the news it saw.
* **Append-only:** SQLite triggers reject `UPDATE`/`DELETE` on `predictions`. Actual results go in a separate
  `prediction_outcomes` table once the target close has happened.
* **No look-ahead:** each article has an `availableAt` field (retrieval time for live ingestion; publication time + 5 min
  for backfilled history). Features and backtests read news and candles only through `prediction/PointInTime.ts`, which
  filters on `asOf` and then runs `assertNoLookahead` on every item, throwing `LookaheadViolationError`. A daily bar
  can't be used until 16:00 New York that day. Tests in `server/test/core.test.ts` cover this.
* **Recalculation triggers:** medium/high-impact relevant news (5-min cooldown), a price move of 1% or more since the last
  prediction (15-min cooldown), and an hourly refresh while the market is open. The app shows each new version live, with
  the change from the previous one.
* **Performance:** the AI Prediction tab shows live out-of-sample stats (only predictions resolved after they were made)
  and a separately labeled walk-forward backtest.

### The prediction = technical model + news impact

**Technical model** (`server/src/ml/`): gradient-boosted regression trees (dependency-free, `gbdt.ts`) trained on
35 point-in-time features (returns over 1–250 days, volatility, RSI, moving-average gaps, MACD, 52-week range,
volume z-score, market/SPY context, calendar) pooled across ~40 large stocks and ETFs. The target is the next-day
return in volatility units.

* **Daily history back to 2000** comes from Tiingo (`TIINGO_API_KEY`, free). Without it the model trains on
  Polygon's 2-year free window. Bars are stored in SQLite (`daily_bars`) and synced incrementally.
* **Walk-forward evaluation:** yearly test periods (quarterly with short history). Each period is predicted by a model
  trained only on rows whose target closed before the period began. The app shows these out-of-sample results next
  to an "always up" baseline, overall and per stock.
* **Calibration from out-of-sample data only:** predicted size is scaled by the out-of-sample slope, clipped to [0, 1].
  A model with no demonstrated edge therefore outputs values near zero instead of confident noise. P(up) comes from
  a logistic fit on out-of-sample predictions.
* The model retrains weekly, when the history source changes, or from the app (AI Model tab → *Sync data & retrain*).
  Every version is kept in `ml_models`.

**News impact** (`server/src/news/NewsImpactModel.ts`): each article's direction × sentiment × relevance × impact
weight becomes an estimated next-session abnormal move for each related stock, in units of that stock's daily
volatility. The coefficient starts from a conservative prior and is re-fitted by an event study on stored articles
whose price reaction is known. When articles are combined: coverage of the same event counts once, low-impact
articles are left out, distinct events combine as sum/√n, and the total is capped at 1.5× daily volatility.
A prediction's news component uses only articles that appeared after the last close. Every news card shows the
per-stock estimate, e.g. "AAPL ▲ +0.42%", labelled as a model estimate.

**AI Analyst** (`server/src/ai/AnalystService.ts`): Claude (`claude-opus-5`, adaptive thinking, structured output)
reads the quote, technical snapshot, the model estimate with its track record, and recent news. It writes a stance,
summary, drivers, risks and what to watch next. It needs `ANTHROPIC_API_KEY`.

Honest expectations: daily stock direction is close to a coin flip. On 2 years of free data the technical model
showed no edge over "always up" out-of-sample (hit rate 49.4% vs 52.2%), and the app says so. Longer history (Tiingo)
and real AI news analysis (Anthropic key) give it the best chance, but treat every number as an estimate.

> Backtest caveat: an LLM's sentiment on *old* articles can reflect things the model learned after the article came out.
> For strict research backtests, use the `rules-v1` analyzer or an LLM whose training cutoff is before the test period.

## Alerts

Per watchlist asset: high-impact news, unusual sentiment (24h vs 7-day baseline, at least 3 articles), or every new article.
Alerts are pushed over WebSocket and shown as local notifications. For push while the app is closed, set
`EXPO_PUSH_ENABLED=true` and configure an EAS project ID. The master switch in the Alerts tab turns everything off.

## API overview

```
GET  /api/status                         providers, market status, analyzer, model version
GET  /api/dashboard?deviceId=            markets, watchlist, AI signals, latest + high-impact news
GET  /api/assets/search?q=
GET  /api/assets/:symbol                 overview + quote + ETF holdings
GET  /api/assets/:symbol/candles?range=1D|5D|1M|6M|1Y|5Y
GET  /api/assets/:symbol/fundamentals
GET  /api/assets/:symbol/news?tab=latest|positive|negative|analyst|earnings|company&sort=newest|relevance&relation=
GET  /api/assets/:symbol/predictions     latest, full history, out-of-sample performance
POST /api/assets/:symbol/predictions     generate now
GET  /api/assets/:symbol/backtest?days=
GET  /api/predictions/:id                full trace
GET  /api/news?symbol&assetType&sector&source&sentiment&since=1h|24h|7d&category&impact&minRelevance&sort
GET  /api/news/search?q=                 full-text + symbol/theme expansion ("AI stocks", "oil", "Federal Reserve")
GET  /api/news/:id
GET|PUT /api/watchlist, POST /api/devices, GET|PUT /api/alerts/prefs, GET /api/alerts/history
WS   /ws  {"type":"subscribe","channels":["quotes:AAPL","news:all","news:AAPL","predictions:AAPL","alerts"]}
```

Nothing in this app is financial advice. Predictions are model estimates with uncertain accuracy.
