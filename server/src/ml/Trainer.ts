// Trains the technical models on daily history for a universe of stocks/ETFs,
// one model per forecast horizon (1, 5 and 20 trading days).
//
// Evaluation is walk-forward: for each test period, the model is trained ONLY on
// rows whose target (the close h days later) happened before the test period
// starts, then scored on that period. These out-of-sample scores are what the
// app shows. Calibration (size, probability, likely range) is fitted on those
// out-of-sample predictions only. The live model is then trained on all rows.

import type { Candle } from "../domain/types.js";
import type { HistoryStore } from "../history/HistoryStore.js";
import { explain, fit, predict, type GbdtParams } from "./gbdt.js";
import type { Calibration, FoldMetrics, ModelRegistry, StoredModel } from "./ModelRegistry.js";
import { FEATURE_NAMES, buildFeatureRows, marketSeries, type FeatureRow } from "./technicalFeatures.js";

const Z_CLIP = 4;
export const HORIZONS = [1, 5, 20] as const;
export type Horizon = (typeof HORIZONS)[number];

interface Row extends FeatureRow {
  symbol: string;
  fwdRet: number; // return over the horizon
  fwdT: number; // bar time of the horizon's close
  z: number; // target: fwdRet / (vol20 * sqrt(h)), clipped
}

export interface TrainProgress {
  running: boolean;
  stage: string;
  pct: number;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  lastVersion: string | null;
}

const yieldLoop = () => new Promise<void>((r) => setImmediate(r));

function spearman(a: number[], b: number[]): number {
  const rank = (v: number[]) => {
    const idx = v.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(v.length);
    idx.forEach(([, i], k) => (r[i] = k));
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  const ma = (n - 1) / 2;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - ma);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - ma) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (i - lo);
}

/** 1-D logistic regression by Newton's method: P(up) from predicted z. */
function fitLogistic(z: number[], up: number[]): { a: number; b: number } {
  let a = 0, b = 0;
  for (let it = 0; it < 25; it++) {
    let ga = 0, gb = 0, haa = 0, hab = 0, hbb = 0;
    for (let i = 0; i < z.length; i++) {
      const p = 1 / (1 + Math.exp(-(a + b * z[i])));
      const w = p * (1 - p) + 1e-9;
      ga += up[i] - p;
      gb += (up[i] - p) * z[i];
      haa += w;
      hab += w * z[i];
      hbb += w * z[i] * z[i];
    }
    hbb += 1e-3; // tiny ridge
    const det = haa * hbb - hab * hab;
    if (!det) break;
    a += (hbb * ga - hab * gb) / det;
    b += (haa * gb - hab * ga) / det;
  }
  return { a, b };
}

export class Trainer {
  progress: TrainProgress = { running: false, stage: "idle", pct: 0, startedAt: null, finishedAt: null, error: null, lastVersion: null };

  constructor(private history: HistoryStore, private registry: ModelRegistry) {}

  private buildRows(universe: string[], h: number): Row[] {
    const spy = this.history.bars("SPY");
    const market = spy.length > 300 ? marketSeries(spy) : null;
    const rows: Row[] = [];
    for (const symbol of universe) {
      const bars: Candle[] = this.history.bars(symbol);
      const idx = new Map(bars.map((b, i) => [b.t, i]));
      for (const r of buildFeatureRows(bars, market)) {
        const i = idx.get(r.t)!;
        if (i + h >= bars.length || r.x.some((v) => !Number.isFinite(v))) continue;
        const fwdRet = bars[i + h].c / bars[i].c - 1;
        const z = Math.max(-Z_CLIP, Math.min(Z_CLIP, fwdRet / (r.vol20 * Math.sqrt(h))));
        rows.push({ ...r, symbol, fwdRet, fwdT: bars[i + h].t, z });
      }
    }
    return rows.sort((a, b) => a.t - b.t);
  }

  /** Yearly test blocks when there is long history; otherwise 4 blocks over the second half. */
  private folds(rows: Row[]): { label: string; start: number; end: number }[] {
    const t0 = rows[0].t;
    const t1 = rows[rows.length - 1].t;
    const years = (t1 - t0) / (365.25 * 86_400_000);
    const out: { label: string; start: number; end: number }[] = [];
    if (years >= 8) {
      const firstYear = new Date(t0).getUTCFullYear() + 5;
      const lastYear = new Date(t1).getUTCFullYear();
      for (let y = firstYear; y <= lastYear; y++) out.push({ label: String(y), start: Date.UTC(y, 0, 1), end: Date.UTC(y + 1, 0, 1) });
    } else {
      const mid = t0 + (t1 - t0) / 2;
      const step = (t1 - mid) / 4;
      for (let k = 0; k < 4; k++) {
        const s = mid + k * step;
        out.push({ label: `${new Date(s).toISOString().slice(0, 7)}`, start: s, end: k === 3 ? t1 + 1 : s + step });
      }
    }
    return out;
  }

  /** Train all horizons in sequence. */
  async trainAll(universe: string[], dataSource: string, params: Partial<GbdtParams> = {}): Promise<StoredModel[]> {
    const out: StoredModel[] = [];
    for (const h of HORIZONS) out.push(await this.train(universe, dataSource, params, h));
    return out;
  }

  async train(universe: string[], dataSource: string, params: Partial<GbdtParams> = {}, horizon: Horizon = 1): Promise<StoredModel> {
    if (this.progress.running) throw new Error("Training already running");
    const hl = `${horizon}d`;
    this.progress = { ...this.progress, running: true, stage: `${hl}: building dataset`, pct: 0, startedAt: Date.now(), finishedAt: null, error: null };
    try {
      const rows = this.buildRows(universe, horizon);
      if (rows.length < 5000) throw new Error(`Not enough history to train (${rows.length} rows). Sync more price history first.`);
      const folds = this.folds(rows);
      const evalTrees = Math.round((params.nTrees ?? 250) * 0.6);
      const totalSteps = folds.length * evalTrees + (params.nTrees ?? 250);
      let step = 0;
      const tick = async () => {
        step++;
        if (step % 10 === 0) {
          this.progress.pct = Math.round((step / totalSteps) * 100);
          await yieldLoop();
        }
      };

      const oosZ: number[] = [], oosActualZ: number[] = [], oosRet: number[] = [], oosPredRetRaw: number[] = [];
      const oosSymbol: string[] = [];
      const foldMetrics: FoldMetrics[] = [];
      for (const f of folds) {
        this.progress.stage = `${hl}: walk-forward test ${f.label}`;
        // Training rows: target close strictly before the test period (no overlap with test outcomes).
        const train = rows.filter((r) => r.fwdT < f.start);
        const test = rows.filter((r) => r.t >= f.start && r.t < f.end);
        if (train.length < 3000 || test.length < 50) {
          step += evalTrees;
          continue;
        }
        const m = await fit(train.map((r) => r.x), Float64Array.from(train.map((r) => r.z)), { ...params, nTrees: evalTrees }, tick);
        const pz = test.map((r) => predict(m, r.x));
        const pr = test.map((r, i) => pz[i] * r.vol20 * Math.sqrt(horizon));
        const actual = test.map((r) => r.fwdRet);
        let hits = 0, ups = 0, nz = 0, mae = 0;
        for (let i = 0; i < test.length; i++) {
          if (actual[i] !== 0) {
            nz++;
            if (Math.sign(pr[i]) === Math.sign(actual[i])) hits++;
            if (actual[i] > 0) ups++;
          }
          mae += Math.abs(actual[i] - pr[i]);
        }
        foldMetrics.push({
          label: f.label, testStart: f.start, testEnd: f.end, trainRows: train.length, testRows: test.length,
          hitRate: hits / Math.max(1, nz), baselineHitRate: ups / Math.max(1, nz),
          ic: spearman(pr, actual), maeReturnPct: (mae / test.length) * 100,
        });
        oosZ.push(...pz);
        oosActualZ.push(...test.map((r) => r.z));
        oosRet.push(...actual);
        oosPredRetRaw.push(...pr);
        oosSymbol.push(...test.map((r) => r.symbol));
      }
      if (!foldMetrics.length) throw new Error("No walk-forward folds could be evaluated.");

      // Calibration from out-of-sample predictions only.
      let sxy = 0, sxx = 0;
      for (let i = 0; i < oosZ.length; i++) {
        sxy += oosZ[i] * oosActualZ[i];
        sxx += oosZ[i] * oosZ[i];
      }
      const magnitudeScale = Math.max(0, Math.min(1, sxx ? sxy / sxx : 0));
      const { a, b } = fitLogistic(oosZ, oosRet.map((r) => (r > 0 ? 1 : 0)));
      // Likely range: 10th/90th percentile of out-of-sample errors, in volatility units.
      const resid = oosZ.map((z, i) => oosActualZ[i] - z * magnitudeScale).sort((p, q) => p - q);
      const q10 = quantile(resid, 0.1);
      const q90 = quantile(resid, 0.9);
      const calibration: Calibration = { magnitudeScale, a, b, q10, q90 };

      let hits = 0, ups = 0, nz = 0, mae = 0, inBand = 0;
      for (let i = 0; i < oosRet.length; i++) {
        if (oosRet[i] !== 0) {
          nz++;
          if (Math.sign(oosPredRetRaw[i]) === Math.sign(oosRet[i])) hits++;
          if (oosRet[i] > 0) ups++;
        }
        mae += Math.abs(oosRet[i] - oosPredRetRaw[i] * magnitudeScale);
        const zc = oosZ[i] * magnitudeScale;
        if (oosActualZ[i] >= zc + q10 && oosActualZ[i] <= zc + q90) inBand++;
      }

      const bySymbol: Record<string, { n: number; hitRate: number; baselineHitRate: number }> = {};
      const acc = new Map<string, { n: number; hits: number; ups: number }>();
      for (let i = 0; i < oosRet.length; i++) {
        if (oosRet[i] === 0) continue;
        const s = acc.get(oosSymbol[i]) ?? { n: 0, hits: 0, ups: 0 };
        s.n++;
        if (Math.sign(oosPredRetRaw[i]) === Math.sign(oosRet[i])) s.hits++;
        if (oosRet[i] > 0) s.ups++;
        acc.set(oosSymbol[i], s);
      }
      for (const [s, v] of acc) bySymbol[s] = { n: v.n, hitRate: v.hits / v.n, baselineHitRate: v.ups / v.n };

      this.progress.stage = `${hl}: training final model on all data`;
      const finalModel = await fit(rows.map((r) => r.x), Float64Array.from(rows.map((r) => r.z)), params, tick);
      const totalImp = finalModel.importance.reduce((s, v) => s + v, 0) || 1;
      const topFeatures = finalModel.importance
        .map((v, i) => ({ name: FEATURE_NAMES[i], importance: v / totalImp }))
        .sort((p, q) => q.importance - p.importance)
        .slice(0, 10);

      const createdAt = Date.now();
      const stored: StoredModel = {
        version: `gbdt${horizon}d-${new Date(createdAt).toISOString().slice(0, 16).replace(/[-:T]/g, "")}`,
        createdAt,
        kind: "gbdt",
        horizon,
        dataSource,
        trainStart: rows[0].t,
        trainEnd: rows[rows.length - 1].t,
        symbols: [...new Set(rows.map((r) => r.symbol))],
        features: [...FEATURE_NAMES],
        model: finalModel,
        calibration,
        metrics: {
          folds: foldMetrics,
          overall: {
            testRows: oosRet.length,
            hitRate: hits / Math.max(1, nz),
            baselineHitRate: ups / Math.max(1, nz),
            ic: spearman(oosPredRetRaw, oosRet),
            maeReturnPct: (mae / oosRet.length) * 100,
            bandCoverage: inBand / Math.max(1, oosRet.length),
          },
          topFeatures,
          bySymbol,
        },
      };
      this.registry.save(stored, true);
      this.progress = { ...this.progress, running: false, stage: "done", pct: 100, finishedAt: Date.now(), lastVersion: stored.version };
      return stored;
    } catch (e) {
      this.progress = { ...this.progress, running: false, stage: "failed", error: (e as Error).message, finishedAt: Date.now() };
      throw e;
    }
  }
}

/**
 * Live inference with a stored model: calibrated expected return, P(up), an 80%
 * likely range, and per-feature contributions (in return %) explaining the estimate.
 */
export function inferTechnical(m: StoredModel, row: FeatureRow) {
  const h = m.horizon ?? 1;
  const unit = row.vol20 * Math.sqrt(h) * 100; // 1 z-unit in return %
  const z = predict(m.model, row.x);
  const scale = m.calibration.magnitudeScale;
  const predictedReturnPct = z * scale * unit;
  const probabilityUp = 1 / (1 + Math.exp(-(m.calibration.a + m.calibration.b * z)));
  const lowPct = predictedReturnPct + (m.calibration.q10 ?? -1.28) * unit;
  const highPct = predictedReturnPct + (m.calibration.q90 ?? 1.28) * unit;
  const contrib = explain(m.model, row.x);
  const drivers = contrib.perFeature
    .map((c, i) => ({ feature: m.features[i], value: row.x[i], contributionPct: c * scale * unit }))
    .filter((d) => Math.abs(d.contributionPct) > 1e-6)
    .sort((p, q) => Math.abs(q.contributionPct) - Math.abs(p.contributionPct))
    .slice(0, 6);
  return { z, predictedReturnPct, probabilityUp, lowPct, highPct, drivers, horizon: h };
}
