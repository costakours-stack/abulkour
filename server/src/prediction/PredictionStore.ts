import type { DB } from "../db/database.js";
import type { PredictionOutcome, PredictionRecord } from "../domain/types.js";

type Row = Record<string, any>;

function toRecord(r: Row): PredictionRecord {
  return {
    id: r.id,
    symbol: r.symbol,
    modelVersion: r.model_version,
    predictionTimestamp: r.prediction_timestamp,
    marketDataTimestamp: r.market_data_timestamp,
    latestNewsTimestamp: r.latest_news_timestamp,
    newsArticleIds: JSON.parse(r.news_article_ids),
    horizon: r.horizon,
    basePrice: r.base_price,
    predictedReturnPct: r.predicted_return_pct,
    probabilityUp: r.probability_up,
    confidence: r.confidence,
    features: JSON.parse(r.features),
    trigger: r.trigger_reason,
    outcome:
      r.resolved_at != null
        ? {
            predictionId: r.id,
            resolvedAt: r.resolved_at,
            actualPrice: r.actual_price,
            actualReturnPct: r.actual_return_pct,
            directionCorrect: !!r.direction_correct,
            absError: r.abs_error,
            priceTimestamp: r.price_timestamp,
          }
        : null,
  };
}

const SELECT = `SELECT p.*, o.resolved_at, o.actual_price, o.actual_return_pct, o.direction_correct, o.abs_error, o.price_timestamp
                FROM predictions p LEFT JOIN prediction_outcomes o ON o.prediction_id = p.id`;

/** Append-only store. The DB triggers reject UPDATE/DELETE on predictions. */
export class PredictionStore {
  constructor(private db: DB) {}

  insert(p: PredictionRecord) {
    this.db
      .prepare(
        `INSERT INTO predictions (id, symbol, model_version, prediction_timestamp, market_data_timestamp, latest_news_timestamp,
          news_article_ids, horizon, base_price, predicted_return_pct, probability_up, confidence, features, trigger_reason)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        p.id, p.symbol, p.modelVersion, p.predictionTimestamp, p.marketDataTimestamp, p.latestNewsTimestamp,
        JSON.stringify(p.newsArticleIds), p.horizon, p.basePrice, p.predictedReturnPct, p.probabilityUp, p.confidence,
        JSON.stringify(p.features), p.trigger,
      );
  }

  recordOutcome(o: PredictionOutcome) {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO prediction_outcomes (prediction_id, resolved_at, actual_price, actual_return_pct, direction_correct, abs_error, price_timestamp)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(o.predictionId, o.resolvedAt, o.actualPrice, o.actualReturnPct, o.directionCorrect ? 1 : 0, o.absError, o.priceTimestamp);
  }

  latest(symbol: string): PredictionRecord | null {
    const r = this.db.prepare(`${SELECT} WHERE p.symbol = ? ORDER BY p.prediction_timestamp DESC LIMIT 1`).get(symbol) as Row | undefined;
    return r ? toRecord(r) : null;
  }

  latestAny(): PredictionRecord | null {
    const r = this.db.prepare(`${SELECT} ORDER BY p.prediction_timestamp DESC LIMIT 1`).get() as Row | undefined;
    return r ? toRecord(r) : null;
  }

  history(symbol: string, limit = 100): PredictionRecord[] {
    return (this.db.prepare(`${SELECT} WHERE p.symbol = ? ORDER BY p.prediction_timestamp DESC LIMIT ?`).all(symbol, limit) as Row[]).map(toRecord);
  }

  get(id: string): PredictionRecord | null {
    const r = this.db.prepare(`${SELECT} WHERE p.id = ?`).get(id) as Row | undefined;
    return r ? toRecord(r) : null;
  }

  recent(limit = 20): PredictionRecord[] {
    return (this.db.prepare(`${SELECT} ORDER BY p.prediction_timestamp DESC LIMIT ?`).all(limit) as Row[]).map(toRecord);
  }

  unresolved(olderThan: number): PredictionRecord[] {
    return (
      this.db.prepare(`${SELECT} WHERE o.prediction_id IS NULL AND p.prediction_timestamp < ? ORDER BY p.prediction_timestamp LIMIT 200`).all(olderThan) as Row[]
    ).map(toRecord);
  }

  /** Live, genuinely out-of-sample performance: predictions made before their outcome was known. */
  performance(symbol?: string) {
    const rows = this.db
      .prepare(
        `SELECT p.model_version, COUNT(*) AS n, AVG(o.direction_correct) AS hit_rate, AVG(o.abs_error) AS mae,
                AVG(p.predicted_return_pct) AS avg_pred, AVG(o.actual_return_pct) AS avg_actual
         FROM predictions p JOIN prediction_outcomes o ON o.prediction_id = p.id
         ${symbol ? "WHERE p.symbol = ?" : ""}
         GROUP BY p.model_version`,
      )
      .all(...(symbol ? [symbol] : [])) as Row[];
    return rows.map((r) => ({
      modelVersion: r.model_version as string,
      resolvedCount: r.n as number,
      directionHitRate: r.hit_rate as number,
      meanAbsErrorPct: r.mae as number,
      avgPredictedPct: r.avg_pred as number,
      avgActualPct: r.avg_actual as number,
    }));
  }
}
