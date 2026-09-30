import type { Candle } from "../../domain/types.js";
import { nyMidnight } from "../../util/time.js";
import { getJson, RateLimiter } from "../http.js";

// Free Tiingo plan: 50 requests/hour, 1000/day. One request returns a symbol's
// full daily history, so the whole training universe fits in the hourly budget.
const limiter = new RateLimiter(75_000);

interface TiingoBar {
  date: string;
  adjOpen: number;
  adjHigh: number;
  adjLow: number;
  adjClose: number;
  adjVolume: number;
}

/** Split/dividend-adjusted daily bars back to the 1990s (https://www.tiingo.com). */
export class TiingoHistoryProvider {
  readonly name = "tiingo";
  constructor(private apiKey: string) {}

  async dailyBars(symbol: string, startDate: string): Promise<Candle[]> {
    const ticker = symbol.replace(".", "-"); // BRK.B -> BRK-B
    const qs = new URLSearchParams({ startDate, token: this.apiKey });
    const rows = await getJson<TiingoBar[]>(
      `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(ticker)}/prices?${qs}`,
      { limiter, timeoutMs: 60_000 },
    );
    return rows
      .filter((r) => r.adjClose > 0)
      .map((r) => ({ t: nyMidnight(r.date), o: r.adjOpen, h: r.adjHigh, l: r.adjLow, c: r.adjClose, v: r.adjVolume }));
  }
}
