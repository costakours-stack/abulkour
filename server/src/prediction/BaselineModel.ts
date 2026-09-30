// A deliberately simple, transparent baseline so the full pipeline
// (features -> prediction -> storage -> outcome -> performance) works end to end.
// Replace with a trained model by implementing PredictionModel and bumping `version`.
// Weights are fixed (not fitted), so backtests with it involve no training-set leakage.

export interface ModelOutput {
  predictedReturnPct: number;
  probabilityUp: number;
  confidence: number;
}

export interface PredictionModel {
  readonly version: string;
  predict(features: Record<string, number>): ModelOutput;
}

const logistic = (x: number) => 1 / (1 + Math.exp(-x));

export class BaselineModel implements PredictionModel {
  readonly version = "baseline-linear-0.1";

  predict(f: Record<string, number>): ModelOutput {
    const vol = Math.max(0.005, f.volatility_20d ?? 0.015);
    // short-term mean reversion + medium-term momentum + news tone
    const z =
      -0.15 * ((f.ret_1d ?? 0) / vol) +
      0.1 * ((f.ret_20d ?? 0) / (vol * Math.sqrt(20))) +
      0.35 * (f.news_sentiment_24h ?? 0) +
      0.15 * (f.news_sentiment_6h ?? 0) +
      0.1 * ((f.positive_news_ratio ?? 0) - (f.negative_news_ratio ?? 0)) +
      0.05 * Math.sign(f.news_sentiment_24h ?? 0) * Math.min(f.high_impact_news_count ?? 0, 3);

    const expected = Math.max(-3, Math.min(3, z * vol * 100 * 0.5)); // % move, capped
    const probabilityUp = logistic(z * 0.8);
    const dataCompleteness = Math.min(1, (f.history_bars ?? 0) / 20) * (f.news_volume_24h > 0 ? 1 : 0.8);
    const confidence = Math.round(Math.min(0.9, Math.abs(probabilityUp - 0.5) * 2 * dataCompleteness + 0.1) * 100) / 100;

    return {
      predictedReturnPct: Math.round(expected * 100) / 100,
      probabilityUp: Math.round(probabilityUp * 1000) / 1000,
      confidence,
    };
  }
}
