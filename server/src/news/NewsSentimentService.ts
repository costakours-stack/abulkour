// AI news analysis. Produces the model's INTERPRETATION of an article —
// sentiment, relevance, impact, a short summary, and per-symbol potential
// impact estimates. The UI always shows this under "AI ANALYSIS", separate
// from the facts (headline, source, time, link).
//
// Uses Claude when ANTHROPIC_API_KEY is set; otherwise (or on failure) a
// transparent rule-based analyzer, labeled "rules-v1".

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Impact, NewsAnalysis, NewsCategory, Sentiment, SymbolImpact } from "../domain/types.js";

export interface AnalysisInput {
  headline: string;
  source: string;
  publishedAt: number;
  providerSnippet: string | null;
  candidateSymbols: string[];
  category: NewsCategory;
}

export interface NewsAnalyzer {
  readonly name: string;
  analyze(input: AnalysisInput): Promise<NewsAnalysis>;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : 0));

// ------------------------------------------------------------------ rules

const POS = [
  "beat", "beats", "surge", "surges", "soar", "soars", "jump", "jumps", "rally", "rallies", "record", "upgrade",
  "upgraded", "raises", "raised", "growth", "gain", "gains", "strong", "tops", "outperform", "approval", "approved",
  "expands", "increased production", "partnership", "wins", "buyback", "higher", "rises", "rise", "boost",
];
const NEG = [
  "miss", "misses", "plunge", "plunges", "fall", "falls", "drop", "drops", "slump", "downgrade", "downgraded",
  "cuts", "cut", "lawsuit", "probe", "investigation", "recall", "weak", "loss", "losses", "layoffs", "fine",
  "fined", "ban", "warns", "warning", "lower", "decline", "declines", "sell-off", "selloff", "bankruptcy", "delay",
];
const HIGH_IMPACT = /\b(earnings|guidance|acquisition|merger|takeover|bankruptcy|fda|antitrust|ceo (resigns|steps down|ousted)|federal reserve|fomc|rate (cut|hike)|recall|halted|sec charges)\b/i;

export class RuleBasedNewsAnalyzer implements NewsAnalyzer {
  readonly name = "rules-v1";

  async analyze(input: AnalysisInput): Promise<NewsAnalysis> {
    const text = `${input.headline} ${input.providerSnippet ?? ""}`.toLowerCase();
    const count = (words: string[]) => words.reduce((n, w) => n + (new RegExp(`\\b${w}\\b`).test(text) ? 1 : 0), 0);
    const p = count(POS);
    const n = count(NEG);
    const score = p + n === 0 ? 0 : (p - n) / (p + n + 1);
    const sentiment: Sentiment = score > 0.15 ? "positive" : score < -0.15 ? "negative" : "neutral";
    const impact: Impact = HIGH_IMPACT.test(text) ? "high" : input.candidateSymbols.length > 0 && p + n > 1 ? "medium" : "low";
    const relevance = input.candidateSymbols.length > 0 ? 0.6 : input.category === "macro" ? 0.5 : 0.25;
    const symbolImpacts: SymbolImpact[] = input.candidateSymbols.slice(0, 5).map((s) => ({
      symbol: s,
      direction: sentiment,
      confidence: Math.round(clamp(Math.abs(score) * 0.6, 0, 0.6) * 100) / 100,
    }));
    return {
      sentiment,
      sentimentScore: Math.round(score * 100) / 100,
      relevanceScore: relevance,
      impact,
      relatedSymbols: input.candidateSymbols,
      summary: shortSummary(input),
      reason:
        `Keyword-based estimate (${p} positive / ${n} negative terms` +
        (impact === "high" ? "; mentions a typically market-moving event type" : "") +
        "). No language model was used.",
      category: input.category,
      symbolImpacts,
      analyzer: this.name,
      analyzedAt: Date.now(),
    };
  }
}

/** First sentence of the publisher snippet, capped — never the full article. */
function shortSummary(input: AnalysisInput): string {
  const src = input.providerSnippet?.trim() || input.headline;
  const first = src.split(/(?<=[.!?])\s+/)[0] ?? src;
  return first.length > 220 ? `${first.slice(0, 217).trimEnd()}…` : first;
}

// ------------------------------------------------------------------ Claude

const AnalysisSchema = z.object({
  sentiment: z.enum(["positive", "neutral", "negative"]),
  sentimentScore: z.number().describe("-1 (very negative) to +1 (very positive)"),
  relevanceScore: z.number().describe("0 to 1: how relevant this is to investors in the related symbols"),
  impact: z.enum(["low", "medium", "high"]),
  category: z.enum(["earnings", "m&a", "analyst", "regulatory", "macro", "product", "company", "market", "other"]),
  relatedSymbols: z.array(z.string()).describe("US tickers of stocks/ETFs the article is actually about"),
  summary: z.string().describe("One or two factual sentences in your own words, max 45 words"),
  reason: z.string().describe("Brief explanation of why this may be relevant to the related symbols"),
  symbolImpacts: z.array(
    z.object({
      symbol: z.string(),
      direction: z.enum(["positive", "neutral", "negative"]),
      confidence: z.number().describe("0 to 1"),
    }),
  ),
});

const SYSTEM_PROMPT = `You analyze financial news for an investing app. You receive only a headline, the source, the publication time, and (sometimes) a short publisher excerpt — not the full article.

Your output is shown to users labeled "AI ANALYSIS", next to the facts. Keep it honest:
- summary: restate only what the headline/excerpt says, in your own words. Do not add facts, numbers, or quotes that are not in the input. Do not copy the excerpt verbatim.
- sentiment/sentimentScore: tone of the news for the related companies' shareholders.
- relatedSymbols: only tickers the news is materially about. Candidate tickers found by a keyword matcher are provided; drop false matches (e.g. "apple" the fruit) and add obvious missing ones.
- impact: "high" only for events that commonly move prices (earnings, guidance, M&A, major regulatory action, Fed decisions, CEO changes); otherwise medium or low.
- symbolImpacts: your estimate of the potential direction of price impact per related symbol and your confidence (0-1). This is an uncertain estimate, not a prediction of what will happen; use modest confidence unless the news is unambiguous.
- reason: one sentence, phrased as an estimate ("may", "could").`;

export class ClaudeNewsAnalyzer implements NewsAnalyzer {
  readonly name: string;
  private client: Anthropic;

  constructor(apiKey: string, private model: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 3 });
    this.name = model;
  }

  async analyze(input: AnalysisInput): Promise<NewsAnalysis> {
    const userContent = [
      `Headline: ${input.headline}`,
      `Source: ${input.source}`,
      `Published: ${new Date(input.publishedAt).toISOString()}`,
      input.providerSnippet ? `Publisher excerpt: ${input.providerSnippet.slice(0, 600)}` : "Publisher excerpt: (none)",
      `Candidate tickers from keyword matcher: ${input.candidateSymbols.join(", ") || "(none)"}`,
    ].join("\n");

    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 2000,
      // Short classification task: low effort keeps latency and cost down.
      output_config: { effort: "low", format: zodOutputFormat(AnalysisSchema) },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });

    if (response.stop_reason === "refusal") throw new Error("Model declined to analyze this article");
    const out = response.parsed_output;
    if (!out) throw new Error(`No structured output (stop_reason=${response.stop_reason})`);

    const symbols = [...new Set(out.relatedSymbols.map((s) => s.toUpperCase().trim()).filter((s) => /^[A-Z.]{1,6}$/.test(s)))];
    return {
      sentiment: out.sentiment,
      sentimentScore: Math.round(clamp(out.sentimentScore, -1, 1) * 100) / 100,
      relevanceScore: Math.round(clamp(out.relevanceScore, 0, 1) * 100) / 100,
      impact: out.impact,
      category: out.category,
      relatedSymbols: symbols,
      summary: out.summary.trim(),
      reason: out.reason.trim(),
      symbolImpacts: out.symbolImpacts
        .filter((i) => symbols.includes(i.symbol.toUpperCase()))
        .map((i) => ({
          symbol: i.symbol.toUpperCase(),
          direction: i.direction,
          confidence: Math.round(clamp(i.confidence, 0, 1) * 100) / 100,
        })),
      analyzer: this.name,
      analyzedAt: Date.now(),
    };
  }
}

// ------------------------------------------------------------------ service

/** Queues analysis with bounded concurrency and falls back to rules on failure. */
export class NewsSentimentService {
  private queue: { input: AnalysisInput; resolve: (a: NewsAnalysis) => void }[] = [];
  private active = 0;
  private fallback = new RuleBasedNewsAnalyzer();

  constructor(private primary: NewsAnalyzer | null, private concurrency = 3) {}

  get analyzerName() {
    return this.primary?.name ?? this.fallback.name;
  }

  analyze(input: AnalysisInput): Promise<NewsAnalysis> {
    return new Promise((resolve) => {
      this.queue.push({ input, resolve });
      this.pump();
    });
  }

  private pump() {
    while (this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!;
      this.active++;
      this.run(job.input)
        .then(job.resolve)
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }

  private async run(input: AnalysisInput): Promise<NewsAnalysis> {
    if (this.primary) {
      try {
        return await this.primary.analyze(input);
      } catch (e) {
        console.warn(`[analysis] ${this.primary.name} failed, using rules: ${(e as Error).message}`);
      }
    }
    return this.fallback.analyze(input);
  }
}
