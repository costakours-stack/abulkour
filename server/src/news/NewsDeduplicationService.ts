import { createHash } from "node:crypto";

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|mc_|cmpid|ref|src|guccounter|ncid|taid)/i;

const STOPWORDS = new Set(
  "a an the and or of to in on for at by with from as is are was were be its it this that after over into amid says said".split(" "),
);

export interface ClusterCandidate {
  id: string;
  clusterId: string;
  headline: string;
  publishedAt: number;
  symbols: string[];
}

/**
 * Two levels of de-duplication:
 *  1. Exact duplicates: same canonical URL (same article from two feeds) -> dropped.
 *  2. Same event from different sources: similar headline within a time window
 *     -> kept, but share a clusterId so the UI groups them ("+2 more sources").
 */
export class NewsDeduplicationService {
  constructor(
    private readonly sameStoryThreshold = 0.82,
    private readonly sameEventThreshold = 0.45,
    private readonly windowMs = 36 * 3600_000,
  ) {}

  canonicalizeUrl(raw: string): string {
    try {
      const u = new URL(raw.trim());
      u.hash = "";
      u.hostname = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^amp\./, "");
      for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(k)) u.searchParams.delete(k);
      let path = u.pathname.replace(/\/amp\/?$/, "/").replace(/\/+$/, "");
      if (!path) path = "/";
      u.pathname = path;
      return `${u.protocol}//${u.hostname}${u.pathname}${u.search}`;
    } catch {
      return raw.trim();
    }
  }

  articleId(canonicalUrl: string): string {
    return createHash("sha1").update(canonicalUrl).digest("hex").slice(0, 20);
  }

  tokens(headline: string): Set<string> {
    return new Set(
      headline
        .toLowerCase()
        .replace(/[’']/g, "")
        .replace(/[^a-z0-9$%. ]+/g, " ")
        .split(/\s+/)
        .map((t) => t.replace(/\.$/, ""))
        .filter((t) => t.length > 1 && !STOPWORDS.has(t)),
    );
  }

  similarity(a: string, b: string): number {
    const ta = this.tokens(a);
    const tb = this.tokens(b);
    if (!ta.size || !tb.size) return 0;
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter++;
    return inter / (ta.size + tb.size - inter);
  }

  /**
   * Returns { duplicateOf } when this is the same story re-published (drop it),
   * or { clusterId } — an existing cluster when it is the same event, else a new one.
   */
  match(
    candidate: { id: string; headline: string; publishedAt: number; symbols: string[] },
    recent: ClusterCandidate[],
  ): { duplicateOf?: string; clusterId: string } {
    let best: { c: ClusterCandidate; score: number } | null = null;
    for (const r of recent) {
      if (Math.abs(r.publishedAt - candidate.publishedAt) > this.windowMs) continue;
      let score = this.similarity(candidate.headline, r.headline);
      // sharing a ticker makes a moderate headline overlap much more likely to be the same event
      if (score > 0 && candidate.symbols.some((s) => r.symbols.includes(s))) score += 0.1;
      if (!best || score > best.score) best = { c: r, score };
    }
    if (best && best.score >= this.sameStoryThreshold && this.similarity(candidate.headline, best.c.headline) >= this.sameStoryThreshold)
      return { duplicateOf: best.c.id, clusterId: best.c.clusterId };
    if (best && best.score >= this.sameEventThreshold) return { clusterId: best.c.clusterId };
    return { clusterId: candidate.id };
  }
}
