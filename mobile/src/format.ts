export const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

export const dateTime = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export const price = (x: number | null | undefined) =>
  x == null ? "—" : x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const signed = (x: number | null | undefined, digits = 2, suffix = "") => {
  if (x == null || !Number.isFinite(x)) return "—";
  const r = Number(x.toFixed(digits)); // avoid "-0.00"
  return `${r > 0 ? "+" : ""}${(r === 0 ? 0 : r).toFixed(digits)}${suffix}`;
};

export const pct = (x: number | null | undefined, digits = 2) => signed(x, digits, "%");

export function compact(x: number | null | undefined): string {
  if (x == null) return "—";
  const abs = Math.abs(x);
  if (abs >= 1e12) return `${(x / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(x / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(x / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(x / 1e3).toFixed(1)}K`;
  return String(x);
}

export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
