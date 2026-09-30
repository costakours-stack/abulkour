// New York trading-calendar helpers. Daily bars are timestamped at 00:00
// America/New_York of the trading date; the session close is 16:00 NY.

const offsetFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" });
const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

/** Hours NY is behind UTC on a given instant (4 in summer, 5 in winter). */
function nyOffsetHours(ms: number): number {
  const part = offsetFmt.formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  const m = part.match(/GMT([+-]\d+)/);
  return m ? -Number(m[1]) : 5;
}

/** "2024-03-15" -> epoch ms of 00:00 New York on that date. */
export function nyMidnight(date: string): number {
  const [y, mo, d] = date.slice(0, 10).split("-").map(Number);
  const noonUtc = Date.UTC(y, mo - 1, d, 12);
  return Date.UTC(y, mo - 1, d, 0) + nyOffsetHours(noonUtc) * 3600_000;
}

/** Epoch ms -> "YYYY-MM-DD" in New York. */
export function nyDate(ms: number): string {
  return dateFmt.format(new Date(ms));
}

export const DAY_MS = 24 * 3600_000;

/** Minutes since 00:00 New York for an instant (e.g. 9:30 -> 570). */
export function nyMinutes(ms: number): number {
  return Math.floor((ms - nyMidnight(nyDate(ms))) / 60_000);
}

/** Epoch ms of a given New York wall-clock time on the same NY date as `ms`. */
export function nyTimeOn(ms: number, hour: number, minute = 0): number {
  return nyMidnight(nyDate(ms)) + (hour * 60 + minute) * 60_000;
}
