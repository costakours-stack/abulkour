// Technical features for the trained model. Row i uses ONLY bars[0..i] (and
// the market's bars up to the same date), i.e. what was known at the close of
// day i. The target is the NEXT day's return, which the features never see.

import type { Candle } from "../domain/types.js";

export const FEATURE_NAMES = [
  "r1", "r2", "r5", "r10", "r20", "r60", "r120", "r250",
  "r1z", "r5z", "r20z",
  "vol5", "vol20", "vol60", "volRatio",
  "rsi14", "dma20", "dma50", "dma200", "ma50_200",
  "macd", "macdHist", "bbPos", "hi252", "lo252",
  "volumeZ20", "gap", "range",
  "spy_r1", "spy_r5", "spy_r20", "spy_vol20", "rel20",
  "dow", "month",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];
export const WARMUP = 252;

export interface FeatureRow {
  t: number; // bar time of day i (00:00 NY)
  x: Float64Array; // FEATURE_NAMES order
  vol20: number;
  close: number;
  /** next-day simple return; NaN for the last bar (unknown yet) */
  nextRet: number;
  nextT: number | null;
}

function ema(values: number[], span: number): number[] {
  const k = 2 / (span + 1);
  const out = new Array<number>(values.length);
  let e = values[0];
  for (let i = 0; i < values.length; i++) {
    e = i === 0 ? values[0] : values[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

function mean(a: number[], from: number, to: number) {
  let s = 0;
  for (let i = from; i <= to; i++) s += a[i];
  return s / (to - from + 1);
}

function std(a: number[], from: number, to: number) {
  const m = mean(a, from, to);
  let s = 0;
  for (let i = from; i <= to; i++) s += (a[i] - m) ** 2;
  return Math.sqrt(s / Math.max(1, to - from));
}

/** Market context series keyed by bar time. */
export interface MarketSeries {
  byT: Map<number, number>; // t -> index in closes
  closes: number[];
  logRet: number[];
}

export function marketSeries(spy: Candle[]): MarketSeries {
  const closes = spy.map((b) => b.c);
  const logRet = closes.map((c, i) => (i ? Math.log(c / closes[i - 1]) : 0));
  return { byT: new Map(spy.map((b, i) => [b.t, i])), closes, logRet };
}

/**
 * Feature rows for every bar after the warm-up. Pass `onlyLast` to compute
 * just the final row (live prediction).
 */
export function buildFeatureRows(bars: Candle[], market: MarketSeries | null, onlyLast = false): FeatureRow[] {
  const n = bars.length;
  if (n <= WARMUP) return [];
  const c = bars.map((b) => b.c);
  const lr = c.map((v, i) => (i ? Math.log(v / c[i - 1]) : 0));
  const logV = bars.map((b) => Math.log(1 + Math.max(0, b.v)));
  const e12 = ema(c, 12);
  const e26 = ema(c, 26);
  const macdLine = c.map((v, i) => (e12[i] - e26[i]) / v);
  const macdSig = ema(macdLine, 9);

  // RSI(14), Wilder smoothing
  const rsi = new Array<number>(n).fill(50);
  let ag = 0;
  let al = 0;
  for (let i = 1; i < n; i++) {
    const d = c[i] - c[i - 1];
    const g = Math.max(d, 0);
    const l = Math.max(-d, 0);
    if (i <= 14) {
      ag += g / 14;
      al += l / 14;
    } else {
      ag = (ag * 13 + g) / 14;
      al = (al * 13 + l) / 14;
    }
    rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }

  const rows: FeatureRow[] = [];
  const start = onlyLast ? n - 1 : WARMUP;
  for (let i = start; i < n; i++) {
    const ret = (k: number) => Math.log(c[i] / c[i - k]);
    const vol5 = std(lr, i - 4, i);
    const vol20 = Math.max(std(lr, i - 19, i), 0.003);
    const vol60 = std(lr, i - 59, i);
    const ma20 = mean(c, i - 19, i);
    const ma50 = mean(c, i - 49, i);
    const ma200 = mean(c, i - 199, i);
    const sd20 = std(c, i - 19, i);
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - 251; j <= i; j++) {
      if (bars[j].h > hi) hi = bars[j].h;
      if (bars[j].l < lo) lo = bars[j].l;
    }
    const vM = mean(logV, i - 19, i);
    const vS = std(logV, i - 19, i) || 1;

    let spy1 = 0, spy5 = 0, spy20 = 0, spyVol = 0.01;
    const mi = market?.byT.get(bars[i].t);
    if (market && mi !== undefined && mi >= 20) {
      spy1 = market.logRet[mi];
      spy5 = Math.log(market.closes[mi] / market.closes[mi - 5]);
      spy20 = Math.log(market.closes[mi] / market.closes[mi - 20]);
      spyVol = std(market.logRet, mi - 19, mi);
    }
    const r20 = ret(20);
    const d = new Date(bars[i].t + 12 * 3600_000);

    const x = new Float64Array([
      ret(1), ret(2), ret(5), ret(10), r20, ret(60), ret(120), ret(250),
      ret(1) / vol20, ret(5) / (vol20 * Math.sqrt(5)), r20 / (vol20 * Math.sqrt(20)),
      vol5, vol20, vol60, vol5 / vol20,
      rsi[i], c[i] / ma20 - 1, c[i] / ma50 - 1, c[i] / ma200 - 1, ma50 / ma200 - 1,
      macdLine[i], macdLine[i] - macdSig[i], sd20 ? (c[i] - ma20) / (2 * sd20) : 0, c[i] / hi - 1, c[i] / lo - 1,
      (logV[i] - vM) / vS, bars[i].o / c[i - 1] - 1, (bars[i].h - bars[i].l) / c[i],
      spy1, spy5, spy20, spyVol, r20 - spy20,
      d.getUTCDay(), d.getUTCMonth() + 1,
    ]);
    rows.push({
      t: bars[i].t,
      x,
      vol20,
      close: c[i],
      nextRet: i + 1 < n ? c[i + 1] / c[i] - 1 : NaN,
      nextT: i + 1 < n ? bars[i + 1].t : null,
    });
  }
  return rows;
}
