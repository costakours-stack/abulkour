import type { DB } from "../db/database.js";
import { transaction } from "../db/database.js";
import type { ArticleRelation, NewsAnalysis, NewsCategory, Sentiment, StoredArticle } from "../domain/types.js";
import { getEtf } from "../assets/assetRegistry.js";

export interface NewsFilter {
  symbol?: string;
  /** Restrict per-asset feeds to these relation types (default: all). */
  relations?: ArticleRelation["relation"][];
  assetType?: "stock" | "etf";
  sector?: string;
  source?: string;
  sentiment?: Sentiment;
  category?: NewsCategory;
  impact?: "high" | "medium" | "low";
  sinceMs?: number;
  minRelevance?: number;
  sort?: "newest" | "relevance";
  before?: number;
  limit?: number;
  groupClusters?: boolean;
}

type Row = Record<string, any>;

function rowToArticle(r: Row): StoredArticle {
  return {
    id: r.id,
    clusterId: r.cluster_id,
    headline: r.headline,
    source: r.source,
    url: r.url,
    publishedAt: r.published_at,
    retrievedAt: r.retrieved_at,
    availableAt: r.available_at,
    providerSnippet: r.provider_snippet,
    provider: r.provider,
    imageUrl: r.image_url,
    relatedSymbols: JSON.parse(r.related_symbols),
    relatedCompanies: JSON.parse(r.related_companies),
    relatedEtfs: JSON.parse(r.related_etfs),
    relations: JSON.parse(r.relations),
    sectors: JSON.parse(r.sectors),
    analysis: r.analysis ? JSON.parse(r.analysis) : null,
  };
}

export class NewsStorageService {
  constructor(private db: DB) {}

  exists(id: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM articles WHERE id = ?").get(id);
  }

  existsByCanonicalUrl(canonicalUrl: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM articles WHERE canonical_url = ?").get(canonicalUrl);
  }

  insert(a: StoredArticle, canonicalUrl: string): void {
    transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO articles (id, cluster_id, headline, source, url, canonical_url, published_at, retrieved_at,
            available_at, provider, provider_snippet, image_url, related_symbols, related_companies, related_etfs, relations, sectors, analysis)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          a.id, a.clusterId, a.headline, a.source, a.url, canonicalUrl, a.publishedAt, a.retrievedAt, a.availableAt,
          a.provider, a.providerSnippet, a.imageUrl, JSON.stringify(a.relatedSymbols), JSON.stringify(a.relatedCompanies),
          JSON.stringify(a.relatedEtfs), JSON.stringify(a.relations), JSON.stringify(a.sectors),
          a.analysis ? JSON.stringify(a.analysis) : null,
        );
      this.writeRelations(a.id, a.relations);
      this.db
        .prepare("INSERT INTO articles_fts (article_id, headline, snippet, summary, symbols, companies) VALUES (?,?,?,?,?,?)")
        .run(a.id, a.headline, a.providerSnippet ?? "", "", a.relatedSymbols.join(" "), a.relatedCompanies.join(" "));
    });
  }

  private writeRelations(articleId: string, relations: ArticleRelation[]) {
    this.db.prepare("DELETE FROM article_symbols WHERE article_id = ?").run(articleId);
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO article_symbols (article_id, symbol, relation, via, label) VALUES (?,?,?,?,?)",
    );
    for (const r of relations) stmt.run(articleId, r.symbol, r.relation, r.via ?? null, r.label);
  }

  /** Stores the analysis and any symbol/relation refinements it produced. */
  saveAnalysis(
    id: string,
    analysis: NewsAnalysis,
    update: { relatedSymbols: string[]; relatedCompanies: string[]; relatedEtfs: string[]; relations: ArticleRelation[]; sectors: string[] },
  ): void {
    transaction(this.db, () => {
      this.db
        .prepare(
          `UPDATE articles SET analysis = ?, related_symbols = ?, related_companies = ?, related_etfs = ?, relations = ?, sectors = ?
           WHERE id = ?`,
        )
        .run(
          JSON.stringify(analysis), JSON.stringify(update.relatedSymbols), JSON.stringify(update.relatedCompanies),
          JSON.stringify(update.relatedEtfs), JSON.stringify(update.relations), JSON.stringify(update.sectors), id,
        );
      this.writeRelations(id, update.relations);
      this.db
        .prepare("UPDATE articles_fts SET summary = ?, symbols = ?, companies = ? WHERE article_id = ?")
        .run(analysis.summary, update.relatedSymbols.join(" "), update.relatedCompanies.join(" "), id);
    });
  }

  get(id: string): StoredArticle | null {
    const r = this.db.prepare("SELECT * FROM articles WHERE id = ?").get(id) as Row | undefined;
    if (!r) return null;
    const a = rowToArticle(r);
    a.alsoReportedBy = this.clusterSiblings(a);
    return a;
  }

  recentForClustering(sinceMs: number) {
    const rows = this.db
      .prepare("SELECT id, cluster_id, headline, published_at, related_symbols FROM articles WHERE published_at >= ?")
      .all(sinceMs) as Row[];
    return rows.map((r) => ({
      id: r.id as string,
      clusterId: r.cluster_id as string,
      headline: r.headline as string,
      publishedAt: r.published_at as number,
      symbols: JSON.parse(r.related_symbols) as string[],
    }));
  }

  private clusterSiblings(a: StoredArticle) {
    const rows = this.db
      .prepare("SELECT source, url FROM articles WHERE cluster_id = ? AND id != ? ORDER BY published_at ASC LIMIT 10")
      .all(a.clusterId, a.id) as Row[];
    return rows.map((r) => ({ source: r.source as string, url: r.url as string }));
  }

  list(f: NewsFilter = {}): StoredArticle[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    let from = "articles a";

    if (f.symbol) {
      from += " JOIN article_symbols s ON s.article_id = a.id";
      where.push("s.symbol = ?");
      params.push(f.symbol.toUpperCase());
      if (f.relations?.length) {
        where.push(`s.relation IN (${f.relations.map(() => "?").join(",")})`);
        params.push(...f.relations);
      }
    }
    if (f.assetType === "etf") where.push("a.related_etfs != '[]'");
    if (f.assetType === "stock") where.push("EXISTS (SELECT 1 FROM article_symbols x WHERE x.article_id = a.id AND x.relation = 'direct')");
    if (f.sector) {
      where.push("EXISTS (SELECT 1 FROM json_each(a.sectors) WHERE value = ?)");
      params.push(f.sector);
    }
    if (f.source) {
      where.push("lower(a.source) = lower(?)");
      params.push(f.source);
    }
    if (f.sentiment) {
      where.push("json_extract(a.analysis, '$.sentiment') = ?");
      params.push(f.sentiment);
    }
    if (f.category) {
      where.push("json_extract(a.analysis, '$.category') = ?");
      params.push(f.category);
    }
    if (f.impact) {
      where.push("json_extract(a.analysis, '$.impact') = ?");
      params.push(f.impact);
    }
    if (f.sinceMs) {
      where.push("a.published_at >= ?");
      params.push(f.sinceMs);
    }
    if (f.minRelevance !== undefined) {
      where.push("COALESCE(json_extract(a.analysis, '$.relevanceScore'), 0) >= ?");
      params.push(f.minRelevance);
    }
    if (f.before) {
      where.push("a.published_at < ?");
      params.push(f.before);
    }

    const order =
      f.sort === "relevance"
        ? "COALESCE(json_extract(a.analysis, '$.relevanceScore'), 0) DESC, a.published_at DESC"
        : "a.published_at DESC";
    const limit = Math.min(f.limit ?? 50, 200);
    const sql = `SELECT a.*${f.symbol ? ", s.relation AS rel, s.via AS rel_via, s.label AS rel_label" : ""}
                 FROM ${from} ${where.length ? "WHERE " + where.join(" AND ") : ""}
                 ORDER BY ${order} LIMIT ?`;
    const rows = this.db.prepare(sql).all(...params, limit * 3) as Row[];
    return this.group(rows.map(rowToArticle), f.groupClusters ?? true).slice(0, limit);
  }

  /** One card per event; other outlets reporting the same event become "also reported by". */
  private group(articles: StoredArticle[], enabled: boolean): StoredArticle[] {
    if (!enabled) return articles;
    const seen = new Map<string, StoredArticle>();
    const out: StoredArticle[] = [];
    for (const a of articles) {
      const lead = seen.get(a.clusterId);
      if (lead) {
        lead.alsoReportedBy!.push({ source: a.source, url: a.url });
        continue;
      }
      a.alsoReportedBy = [];
      seen.set(a.clusterId, a);
      out.push(a);
    }
    return out;
  }

  search(query: string, f: NewsFilter = {}): StoredArticle[] {
    const terms = query
      .replace(/["*^:()]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => `"${t}"`);
    if (!terms.length) return [];
    const match = terms.join(" OR ");
    const rows = this.db
      .prepare(
        `SELECT a.*, bm25(articles_fts) AS rank FROM articles_fts
         JOIN articles a ON a.id = articles_fts.article_id
         WHERE articles_fts MATCH ? ${f.sinceMs ? "AND a.published_at >= ?" : ""}
         ORDER BY rank LIMIT 150`,
      )
      .all(...([match, ...(f.sinceMs ? [f.sinceMs] : [])] as (string | number)[])) as Row[];
    return rows.map(rowToArticle);
  }

  /**
   * POINT-IN-TIME QUERY. Returns only articles the system could have known
   * about at `asOf` (available_at <= asOf). Used by feature building and
   * backtests; see prediction/PointInTimeNewsView.ts for the enforcement layer.
   */
  listAvailableAt(symbol: string, asOf: number, lookbackMs: number): StoredArticle[] {
    const etf = getEtf(symbol);
    const relations = etf ? ["direct", "holding", "sector", "macro"] : ["direct"];
    const rows = this.db
      .prepare(
        `SELECT a.* FROM articles a JOIN article_symbols s ON s.article_id = a.id
         WHERE s.symbol = ? AND s.relation IN (${relations.map(() => "?").join(",")})
           AND a.available_at <= ? AND a.available_at > ?
         ORDER BY a.available_at DESC`,
      )
      .all(symbol.toUpperCase(), ...relations, asOf, asOf - lookbackMs) as Row[];
    return rows.map(rowToArticle);
  }

  sources(): string[] {
    return (this.db.prepare("SELECT DISTINCT source FROM articles ORDER BY source").all() as Row[]).map((r) => r.source);
  }
}
