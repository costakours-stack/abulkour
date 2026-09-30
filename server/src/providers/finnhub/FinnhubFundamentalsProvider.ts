import { getJson, HttpError } from "../http.js";
import type { CompanyProfile, EtfHolding, FundamentalMetrics, FundamentalsProvider } from "../types.js";
import { finnhubLimiter } from "./FinnhubMarketDataProvider.js";

const BASE = "https://finnhub.io/api/v1";

export class FinnhubFundamentalsProvider implements FundamentalsProvider {
  readonly name = "finnhub";
  constructor(private apiKey: string) {}

  private url(path: string, params: Record<string, string>) {
    return `${BASE}${path}?${new URLSearchParams({ ...params, token: this.apiKey })}`;
  }

  async getProfile(symbol: string): Promise<CompanyProfile | null> {
    const p = await getJson<Record<string, any>>(this.url("/stock/profile2", { symbol }), { limiter: finnhubLimiter });
    if (!p || !p.name) return null;
    return {
      symbol,
      name: p.name,
      exchange: p.exchange ?? null,
      industry: p.finnhubIndustry ?? null,
      country: p.country ?? null,
      marketCap: typeof p.marketCapitalization === "number" ? p.marketCapitalization * 1e6 : null,
      logo: p.logo || null,
      weburl: p.weburl || null,
      ipo: p.ipo || null,
    };
  }

  async getMetrics(symbol: string): Promise<FundamentalMetrics | null> {
    const r = await getJson<{ metric?: Record<string, number> }>(
      this.url("/stock/metric", { symbol, metric: "all" }),
      { limiter: finnhubLimiter },
    );
    const m = r.metric;
    if (!m || Object.keys(m).length === 0) return null;
    const pick = (...keys: string[]) => {
      for (const k of keys) if (typeof m[k] === "number") return m[k];
      return null;
    };
    return {
      symbol,
      peTTM: pick("peTTM", "peBasicExclExtraTTM", "peExclExtraTTM"),
      epsTTM: pick("epsTTM", "epsBasicExclExtraItemsTTM", "epsExclExtraItemsTTM"),
      dividendYield: pick("dividendYieldIndicatedAnnual", "currentDividendYieldTTM"),
      beta: pick("beta"),
      week52High: pick("52WeekHigh"),
      week52Low: pick("52WeekLow"),
      revenueGrowthTTM: pick("revenueGrowthTTMYoy"),
      netMarginTTM: pick("netProfitMarginTTM"),
      asOf: Date.now(),
    };
  }

  /** Premium endpoint on Finnhub; returns null when the plan does not include it. */
  async getEtfHoldings(symbol: string): Promise<EtfHolding[] | null> {
    try {
      const r = await getJson<{ holdings?: { symbol: string; name: string; percent: number }[] }>(
        this.url("/etf/holdings", { symbol }),
        { limiter: finnhubLimiter, retries: 0 },
      );
      if (!r.holdings?.length) return null;
      return r.holdings
        .sort((a, b) => b.percent - a.percent)
        .slice(0, 25)
        .map((h) => ({ symbol: h.symbol, name: h.name, weightPct: h.percent }));
    } catch (e) {
      if (e instanceof HttpError && (e.status === 401 || e.status === 403)) return null;
      throw e;
    }
  }
}
