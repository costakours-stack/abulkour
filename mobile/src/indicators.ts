// Technical indicators computed on the client from OHLCV candles.
// All functions return arrays aligned with the input (NaN where not yet defined).

import type { Candle } from "./api/types";

export function sma(values: number[], n: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export function ema(values: number[], n: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  const k = 2 / (n + 1);
  let e = NaN;
  for (let i = 0; i < values.length; i++) {
    if (i === n - 1) {
      let s = 0;
      for (let j = 0; j < n; j++) s += values[j];
      e = s / n;
    } else if (i >= n) e = values[i] * k + e * (1 - k);
    out[i] = i >= n - 1 ? e : NaN;
  }
  return out;
}

export function bollinger(values: number[], n = 20, mult = 2) {
  const mid = sma(values, n);
  const upper = new Array<number>(values.length).fill(NaN);
  const lower = new Array<number>(values.length).fill(NaN);
  for (let i = n - 1; i < values.length; i++) {
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (values[j] - mid[i]) ** 2;
    const sd = Math.sqrt(s / n);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
  }
  return { mid, upper, lower };
}

/** Wilder's RSI. */
export function rsi(values: number[], n = 14): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  let ag = 0, al = 0;
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = Math.max(d, 0), l = Math.max(-d, 0);
    if (i <= n) {
      ag += g / n;
      al += l / n;
      if (i === n) out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    } else {
      ag = (ag * (n - 1) + g) / n;
      al = (al * (n - 1) + l) / n;
      out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    }
  }
  return out;
}

export function macd(values: number[], fast = 12, slow = 26, signal = 9) {
  const f = ema(values, fast);
  const s = ema(values, slow);
  const line = values.map((_, i) => f[i] - s[i]);
  const firstValid = line.findIndex((v) => Number.isFinite(v));
  const sig = new Array<number>(values.length).fill(NaN);
  if (firstValid >= 0) {
    const e = ema(line.slice(firstValid), signal);
    e.forEach((v, j) => (sig[firstValid + j] = v));
  }
  const hist = line.map((v, i) => v - sig[i]);
  return { line, signal: sig, hist };
}

/** Average True Range (Wilder). */
export function atr(c: Candle[], n = 14): number[] {
  const out = new Array<number>(c.length).fill(NaN);
  let a = NaN;
  for (let i = 1; i < c.length; i++) {
    const tr = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
    if (i === n) {
      let s = 0;
      for (let j = 1; j <= n; j++) s += Math.max(c[j].h - c[j].l, Math.abs(c[j].h - c[j - 1].c), Math.abs(c[j].l - c[j - 1].c));
      a = s / n;
    } else if (i > n) a = (a * (n - 1) + tr) / n;
    out[i] = i >= n ? a : NaN;
  }
  return out;
}

export interface PeriodStats {
  changePct: number;
  high: number;
  low: number;
  avgVolume: number;
  annualVolPct: number;
  maxDrawdownPct: number;
  upDaysPct: number;
}

export function periodStats(c: Candle[], barsPerYear = 252): PeriodStats | null {
  if (c.length < 2) return null;
  const rets = c.slice(1).map((b, i) => Math.log(b.c / c[i].c));
  const m = rets.reduce((s, r) => s + r, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((s, r) => s + (r - m) ** 2, 0) / Math.max(1, rets.length - 1));
  let peak = c[0].c, mdd = 0;
  for (const b of c) {
    peak = Math.max(peak, b.c);
    mdd = Math.min(mdd, b.c / peak - 1);
  }
  return {
    changePct: (c[c.length - 1].c / c[0].c - 1) * 100,
    high: Math.max(...c.map((b) => b.h)),
    low: Math.min(...c.map((b) => b.l)),
    avgVolume: c.reduce((s, b) => s + b.v, 0) / c.length,
    annualVolPct: sd * Math.sqrt(barsPerYear) * 100,
    maxDrawdownPct: mdd * 100,
    upDaysPct: (rets.filter((r) => r > 0).length / rets.length) * 100,
  };
}

export type Reading = "bullish" | "bearish" | "neutral";

export interface TechnicalReading {
  name: string;
  value: string;
  reading: Reading;
  note: string;
}

/** Plain-language readings of common indicators on daily bars (at least ~200 bars recommended). */
export function technicalReadings(c: Candle[]): TechnicalReading[] {
  const closes = c.map((b) => b.c);
  const i = closes.length - 1;
  if (i < 30) return [];
  const px = closes[i];
  const out: TechnicalReading[] = [];
  const pctFmt = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`;

  for (const n of [20, 50, 200]) {
    const s = sma(closes, n)[i];
    if (!Number.isFinite(s)) continue;
    const d = (px / s - 1) * 100;
    out.push({
      name: `Price vs SMA ${n}`,
      value: pctFmt(d),
      reading: d > 0.5 ? "bullish" : d < -0.5 ? "bearish" : "neutral",
      note: d > 0 ? `Trading above its ${n}-day average` : `Trading below its ${n}-day average`,
    });
  }
  const s50 = sma(closes, 50)[i], s200 = sma(closes, 200)[i];
  if (Number.isFinite(s50) && Number.isFinite(s200)) {
    const prev50 = sma(closes, 50)[i - 5], prev200 = sma(closes, 200)[i - 5];
    const cross = prev50 <= prev200 && s50 > s200 ? " (recent golden cross)" : prev50 >= prev200 && s50 < s200 ? " (recent death cross)" : "";
    out.push({
      name: "SMA 50 vs SMA 200",
      value: pctFmt((s50 / s200 - 1) * 100),
      reading: s50 > s200 ? "bullish" : "bearish",
      note: (s50 > s200 ? "Medium-term trend above long-term" : "Medium-term trend below long-term") + cross,
    });
  }
  const r = rsi(closes, 14)[i];
  if (Number.isFinite(r))
    out.push({
      name: "RSI (14)",
      value: r.toFixed(1),
      reading: r > 70 ? "bearish" : r < 30 ? "bullish" : r >= 50 ? "bullish" : "bearish",
      note: r > 70 ? "Overbought zone (>70)" : r < 30 ? "Oversold zone (<30)" : r >= 50 ? "Positive momentum" : "Weak momentum",
    });
  const m = macd(closes);
  if (Number.isFinite(m.signal[i]))
    out.push({
      name: "MACD (12,26,9)",
      value: m.hist[i].toFixed(2),
      reading: m.hist[i] > 0 ? "bullish" : "bearish",
      note: m.hist[i] > 0 ? (m.hist[i - 1] <= 0 ? "Just crossed above signal" : "Above signal line") : m.hist[i - 1] >= 0 ? "Just crossed below signal" : "Below signal line",
    });
  const bb = bollinger(closes);
  if (Number.isFinite(bb.upper[i])) {
    const pos = (px - bb.lower[i]) / (bb.upper[i] - bb.lower[i] || 1);
    out.push({
      name: "Bollinger %B",
      value: (pos * 100).toFixed(0) + "%",
      reading: pos > 1 ? "bearish" : pos < 0 ? "bullish" : "neutral",
      note: pos > 1 ? "Above upper band (stretched)" : pos < 0 ? "Below lower band (stretched)" : "Inside the bands",
    });
  }
  const look = Math.min(252, i);
  const hi = Math.max(...c.slice(i - look).map((b) => b.h));
  const lo = Math.min(...c.slice(i - look).map((b) => b.l));
  const pos52 = (px - lo) / (hi - lo || 1);
  out.push({
    name: "52-week range position",
    value: `${(pos52 * 100).toFixed(0)}%`,
    reading: pos52 > 0.8 ? "bullish" : pos52 < 0.2 ? "bearish" : "neutral",
    note: `${pctFmt((px / hi - 1) * 100)} from high, ${pctFmt((px / lo - 1) * 100)} from low`,
  });
  for (const [label, n] of [["1-month momentum", 21], ["3-month momentum", 63], ["6-month momentum", 126]] as const) {
    if (i < n) continue;
    const d = (px / closes[i - n] - 1) * 100;
    out.push({ name: label, value: pctFmt(d), reading: d > 1 ? "bullish" : d < -1 ? "bearish" : "neutral", note: "Price change over the period" });
  }
  const a = atr(c, 14)[i];
  if (Number.isFinite(a)) out.push({ name: "ATR (14)", value: `${((a / px) * 100).toFixed(2)}%`, reading: "neutral", note: "Typical daily range" });
  return out;
}
