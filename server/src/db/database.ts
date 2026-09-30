// SQLite via Node's built-in node:sqlite (no native build step).
// Swap for Postgres in production by re-implementing the storage services.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS articles (
  id               TEXT PRIMARY KEY,          -- hash of canonical URL
  cluster_id       TEXT NOT NULL,             -- same-event group across sources
  headline         TEXT NOT NULL,
  source           TEXT NOT NULL,
  url              TEXT NOT NULL,
  canonical_url    TEXT NOT NULL UNIQUE,
  published_at     INTEGER NOT NULL,
  retrieved_at     INTEGER NOT NULL,
  available_at     INTEGER NOT NULL,          -- point-in-time availability
  provider         TEXT NOT NULL,
  provider_snippet TEXT,
  image_url        TEXT,
  related_symbols  TEXT NOT NULL DEFAULT '[]',
  related_companies TEXT NOT NULL DEFAULT '[]',
  related_etfs     TEXT NOT NULL DEFAULT '[]',
  relations        TEXT NOT NULL DEFAULT '[]',
  sectors          TEXT NOT NULL DEFAULT '[]',
  analysis         TEXT                       -- JSON NewsAnalysis, null until analyzed
);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_available ON articles(available_at);
CREATE INDEX IF NOT EXISTS idx_articles_cluster ON articles(cluster_id);

-- one row per (article, symbol) so per-asset feeds are indexed lookups
CREATE TABLE IF NOT EXISTS article_symbols (
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  symbol     TEXT NOT NULL,
  relation   TEXT NOT NULL,                   -- direct | holding | sector | macro
  via        TEXT,
  label      TEXT NOT NULL,
  PRIMARY KEY (article_id, symbol)
);
CREATE INDEX IF NOT EXISTS idx_article_symbols_symbol ON article_symbols(symbol);

CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
  article_id UNINDEXED, headline, snippet, summary, symbols, companies
);

-- append-only: rows are never updated or deleted
CREATE TABLE IF NOT EXISTS predictions (
  id                    TEXT PRIMARY KEY,
  symbol                TEXT NOT NULL,
  model_version         TEXT NOT NULL,
  prediction_timestamp  INTEGER NOT NULL,
  market_data_timestamp INTEGER NOT NULL,
  latest_news_timestamp INTEGER,
  news_article_ids      TEXT NOT NULL,
  horizon               TEXT NOT NULL,
  base_price            REAL NOT NULL,
  predicted_return_pct  REAL NOT NULL,
  probability_up        REAL NOT NULL,
  confidence            REAL NOT NULL,
  features              TEXT NOT NULL,
  trigger_reason        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_predictions_symbol_time ON predictions(symbol, prediction_timestamp DESC);

CREATE TRIGGER IF NOT EXISTS predictions_no_update BEFORE UPDATE ON predictions
BEGIN SELECT RAISE(ABORT, 'predictions are append-only'); END;
CREATE TRIGGER IF NOT EXISTS predictions_no_delete BEFORE DELETE ON predictions
BEGIN SELECT RAISE(ABORT, 'predictions are append-only'); END;

-- actual results, written once the horizon has passed
CREATE TABLE IF NOT EXISTS prediction_outcomes (
  prediction_id     TEXT PRIMARY KEY REFERENCES predictions(id),
  resolved_at       INTEGER NOT NULL,
  actual_price      REAL NOT NULL,
  actual_return_pct REAL NOT NULL,
  direction_correct INTEGER NOT NULL,
  abs_error         REAL NOT NULL,
  price_timestamp   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_prefs (
  device_id          TEXT NOT NULL,
  symbol             TEXT NOT NULL,
  new_article        INTEGER NOT NULL DEFAULT 0,
  high_impact        INTEGER NOT NULL DEFAULT 1,
  unusual_sentiment  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (device_id, symbol)
);

CREATE TABLE IF NOT EXISTS devices (
  device_id          TEXT PRIMARY KEY,
  push_token         TEXT,
  notifications_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id         TEXT PRIMARY KEY,
  device_id  TEXT NOT NULL,
  symbol     TEXT NOT NULL,
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  article_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_device ON alerts(device_id, created_at DESC);

CREATE TABLE IF NOT EXISTS watchlists (
  device_id TEXT NOT NULL,
  symbol    TEXT NOT NULL,
  position  INTEGER NOT NULL,
  PRIMARY KEY (device_id, symbol)
);
`;

export type DB = DatabaseSync;

export function openDatabase(path: string): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

export function transaction<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
