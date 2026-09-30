import type { RawArticle } from "../domain/types.js";
import type { NewsProvider } from "../providers/types.js";

/** Pulls from every configured provider and merges the results. One bad feed never blocks the others. */
export class NewsAggregator {
  constructor(private providers: NewsProvider[]) {}

  get providerNames() {
    return this.providers.map((p) => p.name);
  }

  async fetchLatest(): Promise<RawArticle[]> {
    const results = await Promise.allSettled(this.providers.map((p) => p.fetchLatest()));
    return this.collect(results);
  }

  async fetchForSymbols(symbols: string[], lookbackMs = 2 * 24 * 3600_000): Promise<RawArticle[]> {
    const now = Date.now();
    const jobs: Promise<RawArticle[]>[] = [];
    for (const p of this.providers)
      if (p.fetchForSymbol) for (const s of symbols) jobs.push(p.fetchForSymbol(s, { from: now - lookbackMs, to: now }));
    return this.collect(await Promise.allSettled(jobs));
  }

  private collect(results: PromiseSettledResult<RawArticle[]>[]): RawArticle[] {
    const out: RawArticle[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") out.push(...r.value);
      else console.warn("[news] provider fetch failed:", (r.reason as Error)?.message ?? r.reason);
    }
    return out.sort((a, b) => b.publishedAt - a.publishedAt);
  }
}
