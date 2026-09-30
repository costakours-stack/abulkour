import {
  COMPANIES,
  ETFS,
  MACRO_KEYWORDS,
  SECTOR_KEYWORDS,
  getCompany,
  getEtf,
  type EtfInfo,
} from "../assets/assetRegistry.js";
import type { ArticleRelation, NewsCategory, RawArticle } from "../domain/types.js";

export interface Classification {
  directSymbols: string[];
  relatedCompanies: string[];
  relatedEtfs: string[];
  relations: ArticleRelation[];
  sectors: string[];
  category: NewsCategory;
  isMacro: boolean;
}

const CATEGORY_RULES: [NewsCategory, RegExp][] = [
  ["earnings", /\b(earnings|quarterly results|q[1-4] results|eps|revenue (beat|miss)|beats estimates|misses estimates|guidance|profit (rose|fell|jumps|drops))\b/i],
  ["m&a", /\b(acquire[sd]?|acquisition|merger|merge|takeover|buyout|to buy|deal to purchase|stake in)\b/i],
  ["analyst", /\b(upgrade[sd]?|downgrade[sd]?|price target|initiates coverage|overweight|underweight|outperform|underperform|analyst)\b/i],
  ["regulatory", /\b(sec |antitrust|regulator|regulatory|lawsuit|probe|investigation|fine[sd]?|ftc|doj|european commission|ban|export control|approval|fda)\b/i],
  ["macro", /\b(federal reserve|fed |fomc|powell|inflation|cpi|pce|jobs report|payrolls|unemployment|gdp|recession|treasury yields?|interest rates?|tariffs?)\b/i],
  ["product", /\b(launch(es|ed)?|unveil(s|ed)?|new product|announces new|release[sd]?|rolls out)\b/i],
];

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Pre-compiled alias patterns with word boundaries so "Meta" doesn't match "metal".
const COMPANY_PATTERNS = COMPANIES.map((c) => ({
  symbol: c.symbol,
  name: c.name,
  re: new RegExp(`\\b(${c.aliases.map(escapeRe).join("|")})\\b`, "i"),
}));
const ETF_PATTERNS = ETFS.map((e) => ({
  symbol: e.symbol,
  re: new RegExp(`\\b(${e.aliases.map(escapeRe).join("|")})\\b`, "i"),
}));

/**
 * Links articles to stocks and ETFs, and labels HOW each asset is related.
 * An article about NVDA is "direct" for NVDA but only "holding" for QQQ.
 */
export class NewsClassifier {
  /** Holdings lookup; defaults to the reference list, can be swapped for live provider holdings. */
  constructor(private holdingsOf: (etf: EtfInfo) => string[] = (e) => e.referenceHoldings) {}

  classify(a: RawArticle, extraDirectSymbols: string[] = []): Classification {
    const text = `${a.headline}. ${a.providerSnippet ?? ""}`;
    const lower = ` ${text.toLowerCase()} `;
    const direct = new Set<string>();

    // 1) explicit ticker mentions: $AAPL, (AAPL), NASDAQ:AAPL
    for (const m of text.matchAll(/(?:\$|\(|(?:NASDAQ|NYSE|NYSEARCA|AMEX):\s?)([A-Z]{1,5}(?:\.[A-Z])?)\)?/g)) {
      const s = m[1].toUpperCase();
      if (getCompany(s) || getEtf(s)) direct.add(s);
    }
    // 2) company / ETF names in the headline or snippet
    for (const p of COMPANY_PATTERNS) if (p.re.test(text)) direct.add(p.symbol);
    for (const p of ETF_PATTERNS) if (p.re.test(text)) direct.add(p.symbol);
    // 3) provider tags (company-news endpoints) and AI-identified symbols
    for (const s of [...(a.providerSymbols ?? []), ...extraDirectSymbols]) {
      const u = s.toUpperCase();
      if (u && /^[A-Z.]{1,6}$/.test(u)) direct.add(u);
    }

    const sectors = Object.entries(SECTOR_KEYWORDS)
      .filter(([, kws]) => kws.some((k) => new RegExp(`\\b${escapeRe(k)}\\b`, "i").test(lower)))
      .map(([s]) => s);
    for (const s of direct) {
      const c = getCompany(s);
      if (c && !sectors.includes(c.sector)) sectors.push(c.sector);
    }

    const isMacro = MACRO_KEYWORDS.some((k) => lower.includes(k));
    let category: NewsCategory = "other";
    for (const [cat, re] of CATEGORY_RULES) {
      if (re.test(text)) {
        category = cat;
        break;
      }
    }
    if (category === "other") category = direct.size > 0 ? "company" : isMacro ? "macro" : "market";

    return this.build([...direct], sectors, category, isMacro);
  }

  /**
   * Builds relations from a final set of directly-related symbols. Called again
   * after AI analysis, which may drop false keyword matches or add missed tickers.
   */
  build(directSymbols: string[], sectors: string[], category: NewsCategory, isMacro: boolean): Classification {
    const direct = new Set(directSymbols.map((s) => s.toUpperCase()));
    const relations: ArticleRelation[] = [];
    for (const s of direct) {
      relations.push({ symbol: s, relation: "direct", label: getEtf(s) ? `News about ${s} itself.` : `News about ${s}.` });
    }

    // ETF relations. Never label holding-level news as direct ETF news.
    for (const etf of ETFS) {
      if (direct.has(etf.symbol)) continue;
      const holdings = this.holdingsOf(etf);
      const via = [...direct].filter((s) => holdings.includes(s));
      if (via.length > 0) {
        const first = via[0];
        relations.push({
          symbol: etf.symbol,
          relation: "holding",
          via: first,
          label:
            via.length === 1
              ? `Related through ${first}, one of ${etf.symbol}'s major holdings.`
              : `Related through ${via.slice(0, 3).join(", ")} — major holdings of ${etf.symbol}.`,
        });
        continue;
      }
      const sector = sectors.find((s) => etf.exposure.includes(s));
      if (sector && (category === "regulatory" || category === "macro" || direct.size === 0)) {
        relations.push({
          symbol: etf.symbol,
          relation: "sector",
          via: sector,
          label: `Sector news (${sector}) that may affect ${etf.symbol}.`,
        });
        continue;
      }
      if (isMacro && category === "macro" && etf.macroSensitive) {
        relations.push({
          symbol: etf.symbol,
          relation: "macro",
          label: `Macroeconomic news that may affect ${etf.symbol}.`,
        });
      }
    }

    const directList = [...direct];
    return {
      directSymbols: directList,
      relatedCompanies: directList.map((s) => getCompany(s)?.name).filter((n): n is string => !!n),
      relatedEtfs: [
        ...directList.filter((s) => getEtf(s)),
        ...relations.filter((r) => r.relation !== "direct").map((r) => r.symbol),
      ],
      relations,
      sectors,
      category,
      isMacro,
    };
  }
}
