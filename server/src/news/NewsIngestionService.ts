// Pipeline: providers -> aggregate -> dedupe -> classify -> store -> AI analysis
// -> store analysis -> emit events (WebSocket push, alerts, prediction triggers).

import type { EventBus } from "../events.js";
import type { RawArticle, StoredArticle } from "../domain/types.js";
import type { NewsAggregator } from "./NewsAggregator.js";
import type { Classification, NewsClassifier } from "./NewsClassifier.js";
import type { NewsDeduplicationService } from "./NewsDeduplicationService.js";
import type { NewsSentimentService } from "./NewsSentimentService.js";
import type { NewsStorageService } from "./NewsStorageService.js";

const MAX_FUTURE_SKEW_MS = 5 * 60_000;
const BACKFILL_AVAILABILITY_LAG_MS = 5 * 60_000;

export class NewsIngestionService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private tick = 0;
  lastRunAt: number | null = null;
  lastError: string | null = null;

  constructor(
    private aggregator: NewsAggregator,
    private dedup: NewsDeduplicationService,
    private classifier: NewsClassifier,
    private analysis: NewsSentimentService,
    private storage: NewsStorageService,
    private bus: EventBus,
    private watchlist: () => string[],
    private intervalMs: number,
  ) {}

  start() {
    const run = () => this.runOnce().catch((e) => console.error("[news] ingestion error", e));
    run();
    this.timer = setInterval(run, this.intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const raw = await this.aggregator.fetchLatest();
      // company-specific feeds for the watchlist, spread across ticks to respect rate limits
      const wl = this.watchlist();
      if (wl.length) {
        const batch = wl.filter((_, i) => i % 3 === this.tick % 3);
        raw.push(...(await this.aggregator.fetchForSymbols(batch)));
      }
      this.tick++;
      const n = await this.ingest(raw, { backfill: false });
      this.lastRunAt = Date.now();
      this.lastError = null;
      return n;
    } catch (e) {
      this.lastError = (e as Error).message;
      throw e;
    } finally {
      this.running = false;
    }
  }

  /**
   * @param backfill true when loading historical articles after the fact. Their
   *   availability is then publication time + a safety lag instead of the
   *   (much later) retrieval time. Live ingestion uses retrieval time: the
   *   system could not have known about an article before it fetched it.
   */
  async ingest(raw: RawArticle[], opts: { backfill: boolean }): Promise<number> {
    const now = Date.now();
    const recent = this.storage.recentForClustering(now - 3 * 24 * 3600_000);
    const fresh: { article: StoredArticle; cls: Classification }[] = [];

    for (const r of raw) {
      const canonical = this.dedup.canonicalizeUrl(r.url);
      const id = this.dedup.articleId(canonical);
      if (this.storage.exists(id) || fresh.some((f) => f.article.id === id)) continue;

      const publishedAt = Math.min(r.publishedAt, now + MAX_FUTURE_SKEW_MS);
      const cls = this.classifier.classify(r);
      const match = this.dedup.match({ id, headline: r.headline, publishedAt, symbols: cls.directSymbols }, recent);
      if (match.duplicateOf) continue; // same story syndicated under a different URL

      const article: StoredArticle = {
        id,
        clusterId: match.clusterId,
        headline: r.headline,
        source: r.source,
        url: r.url,
        publishedAt,
        retrievedAt: now,
        availableAt: opts.backfill ? publishedAt + BACKFILL_AVAILABILITY_LAG_MS : Math.max(publishedAt, now),
        providerSnippet: r.providerSnippet ?? null,
        provider: r.provider,
        imageUrl: r.imageUrl ?? null,
        relatedSymbols: cls.directSymbols,
        relatedCompanies: cls.relatedCompanies,
        relatedEtfs: cls.relatedEtfs,
        relations: cls.relations,
        sectors: cls.sectors,
        analysis: null,
      };
      this.storage.insert(article, canonical);
      recent.push({ id, clusterId: match.clusterId, headline: r.headline, publishedAt, symbols: cls.directSymbols });
      fresh.push({ article, cls });
    }

    // Emit newest first so live feeds update immediately, then analyze.
    fresh.sort((a, b) => b.article.publishedAt - a.article.publishedAt);
    for (const f of fresh) this.bus.emit("article:new", f.article);
    await Promise.all(fresh.map((f) => this.analyzeAndStore(f.article, f.cls)));
    if (fresh.length) console.log(`[news] ingested ${fresh.length} new articles`);
    return fresh.length;
  }

  private async analyzeAndStore(a: StoredArticle, cls: Classification) {
    const analysis = await this.analysis.analyze({
      headline: a.headline,
      source: a.source,
      publishedAt: a.publishedAt,
      providerSnippet: a.providerSnippet,
      candidateSymbols: cls.directSymbols,
      category: cls.category,
    });

    // A language model can drop false keyword matches ("apple" the fruit) and
    // add tickers the matcher missed; rebuild relations from its symbol list.
    const direct = analysis.analyzer.startsWith("rules") ? cls.directSymbols : analysis.relatedSymbols;
    const refined = this.classifier.build(direct, cls.sectors, analysis.category, cls.isMacro);

    this.storage.saveAnalysis(a.id, analysis, {
      relatedSymbols: refined.directSymbols,
      relatedCompanies: refined.relatedCompanies,
      relatedEtfs: refined.relatedEtfs,
      relations: refined.relations,
      sectors: refined.sectors,
    });
    const stored = this.storage.get(a.id);
    if (stored) this.bus.emit("article:analyzed", stored);
  }
}
