import type { RawArticle } from "../../domain/types.js";
import { getJson } from "../http.js";
import type { NewsProvider, NewsQueryWindow } from "../types.js";
import { finnhubLimiter } from "./FinnhubMarketDataProvider.js";

const BASE = "https://finnhub.io/api/v1";

interface FinnhubNews {
  category: string;
  datetime: number;
  headline: string;
  id: number;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export class FinnhubNewsProvider implements NewsProvider {
  readonly name = "finnhub-news";
  constructor(private apiKey: string) {}

  private map(n: FinnhubNews): RawArticle | null {
    if (!n.headline || !n.url || !n.datetime) return null;
    return {
      provider: this.name,
      providerArticleId: String(n.id),
      headline: n.headline.trim(),
      source: n.source || "Unknown",
      url: n.url,
      publishedAt: n.datetime * 1000,
      providerSnippet: n.summary?.trim() || undefined,
      providerSymbols: n.related ? n.related.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : [],
      imageUrl: n.image || undefined,
    };
  }

  async fetchLatest(): Promise<RawArticle[]> {
    const qs = new URLSearchParams({ category: "general", token: this.apiKey });
    const items = await getJson<FinnhubNews[]>(`${BASE}/news?${qs}`, { limiter: finnhubLimiter });
    return items.map((n) => this.map(n)).filter((a): a is RawArticle => a !== null);
  }

  async fetchForSymbol(symbol: string, w: NewsQueryWindow): Promise<RawArticle[]> {
    const qs = new URLSearchParams({ symbol, from: ymd(w.from), to: ymd(w.to), token: this.apiKey });
    const items = await getJson<FinnhubNews[]>(`${BASE}/company-news?${qs}`, { limiter: finnhubLimiter });
    return items
      .map((n) => this.map(n))
      .filter((a): a is RawArticle => a !== null)
      .map((a) => ({ ...a, providerSymbols: Array.from(new Set([...(a.providerSymbols ?? []), symbol])) }));
  }
}
