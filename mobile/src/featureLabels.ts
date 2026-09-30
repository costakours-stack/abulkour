// Human-readable names for the model's features, used in "why" explanations.

const pct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
const num = (v: number, d = 2) => v.toFixed(d);

export const FEATURE_LABELS: Record<string, { label: string; fmt: (v: number) => string }> = {
  r1: { label: "Yesterday’s move", fmt: pct },
  r2: { label: "2-day move", fmt: pct },
  r5: { label: "1-week move", fmt: pct },
  r10: { label: "2-week move", fmt: pct },
  r20: { label: "1-month move", fmt: pct },
  r60: { label: "3-month move", fmt: pct },
  r120: { label: "6-month move", fmt: pct },
  r250: { label: "1-year move", fmt: pct },
  r1z: { label: "Yesterday’s move vs normal", fmt: (v) => `${num(v, 1)}σ` },
  r5z: { label: "Week’s move vs normal", fmt: (v) => `${num(v, 1)}σ` },
  r20z: { label: "Month’s move vs normal", fmt: (v) => `${num(v, 1)}σ` },
  vol5: { label: "5-day volatility", fmt: pct },
  vol20: { label: "20-day volatility", fmt: pct },
  vol60: { label: "60-day volatility", fmt: pct },
  volRatio: { label: "Short vs long volatility", fmt: (v) => `${num(v)}×` },
  rsi14: { label: "RSI (14)", fmt: (v) => num(v, 0) },
  dma20: { label: "Price vs 20-day average", fmt: pct },
  dma50: { label: "Price vs 50-day average", fmt: pct },
  dma200: { label: "Price vs 200-day average", fmt: pct },
  ma50_200: { label: "50-day vs 200-day average", fmt: pct },
  macd: { label: "MACD", fmt: (v) => num(v * 100, 2) },
  macdHist: { label: "MACD histogram", fmt: (v) => num(v * 100, 2) },
  bbPos: { label: "Bollinger position", fmt: (v) => num(v) },
  hi252: { label: "Distance from 52-week high", fmt: pct },
  lo252: { label: "Distance from 52-week low", fmt: pct },
  volumeZ20: { label: "Volume vs normal", fmt: (v) => `${num(v, 1)}σ` },
  gap: { label: "Opening gap", fmt: pct },
  range: { label: "Day’s high-low range", fmt: pct },
  spy_r1: { label: "S&P 500 yesterday", fmt: pct },
  spy_r5: { label: "S&P 500 past week", fmt: pct },
  spy_r20: { label: "S&P 500 past month", fmt: pct },
  spy_vol20: { label: "Market volatility", fmt: pct },
  rel20: { label: "1-month move vs S&P 500", fmt: pct },
  dow: { label: "Day of week", fmt: (v) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][Math.round(v)] ?? String(v) },
  month: { label: "Month of year", fmt: (v) => String(Math.round(v)) },
};

export function featureLabel(name: string, value?: number) {
  const f = FEATURE_LABELS[name];
  if (!f) return { label: name, value: value !== undefined ? value.toFixed(3) : "" };
  return { label: f.label, value: value !== undefined && Number.isFinite(value) ? f.fmt(value) : "" };
}
