import { XMLParser } from "fast-xml-parser";
import type { RawArticle } from "../../domain/types.js";
import { getText, RateLimiter } from "../http.js";
import type { NewsProvider } from "../types.js";

const limiter = new RateLimiter(2000);

/**
 * Reads a publisher's official RSS/Atom feed. Only the feed's own title, link,
 * date and short description are used — pages are never scraped.
 */
export class RssNewsProvider implements NewsProvider {
  readonly name: string;
  private parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

  constructor(private feedUrl: string) {
    this.name = `rss:${new URL(feedUrl).hostname}`;
  }

  async fetchLatest(): Promise<RawArticle[]> {
    const xml = await getText(this.feedUrl, limiter);
    const doc = this.parser.parse(xml);
    const channel = doc?.rss?.channel;
    const feedTitle: string = textOf(channel?.title) || textOf(doc?.feed?.title) || new URL(this.feedUrl).hostname;
    const items: any[] = toArray(channel?.item ?? doc?.feed?.entry);
    const out: RawArticle[] = [];
    for (const it of items) {
      const link = typeof it.link === "string" ? it.link : it.link?.["@_href"] ?? toArray(it.link)[0]?.["@_href"];
      const date = Date.parse(textOf(it.pubDate) || textOf(it.published) || textOf(it.updated) || "");
      const headline = stripHtml(textOf(it.title));
      if (!link || !headline || !Number.isFinite(date)) continue;
      out.push({
        provider: this.name,
        providerArticleId: textOf(it.guid) || link,
        headline,
        source: textOf(it.source) || feedTitle,
        url: link,
        publishedAt: date,
        providerSnippet: stripHtml(textOf(it.description) || textOf(it.summary)).slice(0, 400) || undefined,
      });
    }
    return out;
  }
}

function toArray<T>(x: T | T[] | undefined): T[] {
  return x === undefined ? [] : Array.isArray(x) ? x : [x];
}

function textOf(x: unknown): string {
  if (x == null) return "";
  if (typeof x === "string" || typeof x === "number") return String(x).trim();
  if (typeof x === "object" && "#text" in (x as any)) return String((x as any)["#text"]).trim();
  return "";
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
}
