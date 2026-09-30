import type { DB } from "../db/database.js";
import type { GbdtModel } from "./gbdt.js";

export interface Calibration {
  /** predicted return = zHat * vol20 * sqrt(h) * magnitudeScale */
  magnitudeScale: number;
  /** P(up) = 1 / (1 + exp(-(a + b * zHat))) */
  a: number;
  b: number;
  /** 10th / 90th percentile of out-of-sample errors (z units) -> 80% likely range */
  q10?: number;
  q90?: number;
}

export interface FoldMetrics {
  label: string; // e.g. "2019" or "2025-Q2"
  testStart: number;
  testEnd: number;
  trainRows: number;
  testRows: number;
  hitRate: number; // sign agreement on test rows
  baselineHitRate: number; // "always predict up" on the same rows
  ic: number; // Spearman rank correlation, predicted vs actual
  maeReturnPct: number;
}

export interface ModelMetrics {
  folds: FoldMetrics[];
  overall: Omit<FoldMetrics, "label" | "testStart" | "testEnd" | "trainRows"> & { bandCoverage?: number };
  topFeatures: { name: string; importance: number }[];
  bySymbol: Record<string, { n: number; hitRate: number; baselineHitRate: number }>;
}

export interface StoredModel {
  version: string;
  createdAt: number;
  kind: "gbdt";
  /** forecast horizon in trading days (older models: undefined = 1) */
  horizon?: number;
  dataSource: string;
  trainStart: number;
  trainEnd: number;
  symbols: string[];
  features: string[];
  model: GbdtModel;
  calibration: Calibration;
  metrics: ModelMetrics;
}

/** Versioned model store; one active model per horizon. */
export class ModelRegistry {
  private cache = new Map<number, StoredModel | null>();

  constructor(private db: DB) {
    db.exec(`CREATE TABLE IF NOT EXISTS ml_models (
      version TEXT PRIMARY KEY, created_at INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL
    )`);
    const cols = db.prepare("PRAGMA table_info(ml_models)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "horizon")) db.exec("ALTER TABLE ml_models ADD COLUMN horizon INTEGER NOT NULL DEFAULT 1");
  }

  save(m: StoredModel, activate = true) {
    const h = m.horizon ?? 1;
    this.db.exec("BEGIN");
    try {
      if (activate) this.db.prepare("UPDATE ml_models SET active = 0 WHERE horizon = ?").run(h);
      this.db
        .prepare("INSERT OR REPLACE INTO ml_models (version, created_at, active, body, horizon) VALUES (?,?,?,?,?)")
        .run(m.version, m.createdAt, activate ? 1 : 0, JSON.stringify(m), h);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    if (activate) this.cache.set(h, m);
  }

  active(horizon = 1): StoredModel | null {
    if (this.cache.has(horizon)) return this.cache.get(horizon)!;
    const r = this.db.prepare("SELECT body FROM ml_models WHERE active = 1 AND horizon = ? LIMIT 1").get(horizon) as
      | { body: string }
      | undefined;
    const m = r ? (JSON.parse(r.body) as StoredModel) : null;
    this.cache.set(horizon, m);
    return m;
  }

  /** Metadata only (no trees) for listing. */
  list() {
    return (this.db.prepare("SELECT version, created_at, active, body FROM ml_models ORDER BY created_at DESC LIMIT 30").all() as any[]).map(
      (r) => {
        const m = JSON.parse(r.body) as StoredModel;
        return {
          version: m.version, horizon: m.horizon ?? 1, createdAt: m.createdAt, active: !!r.active, dataSource: m.dataSource,
          trainStart: m.trainStart, trainEnd: m.trainEnd, symbols: m.symbols.length, overall: m.metrics.overall,
        };
      },
    );
  }
}
