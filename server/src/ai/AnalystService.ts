// "AI Analyst" brief for one asset: Claude reads the price action, the model's
// current estimate (and its track record) and recent analyzed news, then writes
// a structured outlook. Shown in the app as AI analysis, never as fact.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { PredictionRecord, Quote, StoredArticle } from "../domain/types.js";

const BriefSchema = z.object({
  stance: z.enum(["bullish", "neutral", "bearish"]).describe("Near-term (days) stance implied by the evidence"),
  headline: z.string().describe("One-line takeaway, max 14 words"),
  summary: z.string().describe("3-4 sentences synthesizing price action, news and the model estimate"),
  drivers: z
    .array(z.object({ title: z.string(), detail: z.string(), direction: z.enum(["positive", "negative", "neutral"]) }))
    .describe("2-5 key drivers, each grounded in the provided news or data"),
  risks: z.array(z.string()).describe("2-4 risks or things that would invalidate the stance"),
  watchNext: z.array(z.string()).describe("1-3 upcoming events or signals worth watching"),
  confidence: z.number().describe("0 to 1: how strongly the evidence supports the stance"),
});

export type AnalystBrief = z.infer<typeof BriefSchema> & {
  symbol: string;
  generatedAt: number;
  model: string;
  basedOn: { quoteTimestamp: number | null; predictionId: string | null; articleIds: string[] };
};

const SYSTEM = `You are a sell-side style equity/ETF analyst writing a short brief inside an investing app.
Use ONLY the data provided: quote, technical snapshot, the quantitative model's estimate and its measured out-of-sample record, and recent news with AI-estimated impacts. Do not invent numbers, events, or quotes.
Be balanced and specific; cite which headlines drive your view. Treat the quantitative model with the skepticism its track record warrants (compare its hit rate to the "always up" baseline).
This is analysis, not advice: never tell the reader to buy or sell.`;

export class AnalystService {
  private client: Anthropic | null;
  private cache = new Map<string, { at: number; key: string; brief: AnalystBrief }>();

  constructor(apiKey: string, private model: string) {
    this.client = apiKey ? new Anthropic({ apiKey, maxRetries: 2 }) : null;
  }

  get available() {
    return !!this.client;
  }

  async brief(input: {
    symbol: string;
    name: string;
    type: string;
    quote: Quote | null;
    technical: Record<string, number> | null;
    prediction: PredictionRecord | null;
    trackRecord: { hitRate: number; baselineHitRate: number; n: number } | null;
    articles: (StoredArticle & { priceImpact?: { symbol: string; estMovePct: number }[] })[];
    force?: boolean;
  }): Promise<AnalystBrief> {
    if (!this.client) throw Object.assign(new Error("Add ANTHROPIC_API_KEY on the server to enable the AI Analyst."), { status: 503 });
    const key = `${input.prediction?.id ?? ""}|${input.articles.slice(0, 5).map((a) => a.id).join(",")}`;
    const hit = this.cache.get(input.symbol);
    if (!input.force && hit && hit.key === key && Date.now() - hit.at < 30 * 60_000) return hit.brief;

    const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
    const t = input.technical;
    const lines = [
      `Asset: ${input.symbol} (${input.name}, ${input.type})`,
      input.quote
        ? `Quote: ${input.quote.price} (${input.quote.changePercent?.toFixed(2)}% today), status ${input.quote.status}, as of ${new Date(input.quote.dataTimestamp).toISOString()}`
        : "Quote: unavailable",
      t
        ? `Technical: 1d ${pct(t.tech_r1 ?? 0)}, 5d ${pct(t.tech_r5 ?? 0)}, 20d ${pct(t.tech_r20 ?? 0)}, 60d ${pct(t.tech_r60 ?? 0)}, RSI14 ${(t.tech_rsi14 ?? 50).toFixed(0)}, vs 50d MA ${pct(t.tech_dma50 ?? 0)}, vs 200d MA ${pct(t.tech_dma200 ?? 0)}, daily vol ${pct(t.tech_vol20 ?? 0)}`
        : "Technical: unavailable",
      input.prediction
        ? `Model estimate for next close: ${input.prediction.predictedReturnPct}% (technical ${input.prediction.features.component_technical_pct}%, news ${input.prediction.features.component_news_pct}%), P(up) ${(input.prediction.probabilityUp * 100).toFixed(0)}%, model ${input.prediction.modelVersion}`
        : "Model estimate: none yet",
      input.trackRecord
        ? `Model out-of-sample record on ${input.symbol}: ${(input.trackRecord.hitRate * 100).toFixed(1)}% direction hit rate over ${input.trackRecord.n} days vs ${(input.trackRecord.baselineHitRate * 100).toFixed(1)}% for "always up"`
        : "Model track record: not available",
      "",
      "Recent news (newest first):",
      ...input.articles.slice(0, 20).map((a) => {
        const est = a.priceImpact?.find((p) => p.symbol === input.symbol);
        return `- [${new Date(a.publishedAt).toISOString().slice(0, 16)}] ${a.source}: ${a.headline}` +
          (a.analysis ? ` | ${a.analysis.sentiment}, ${a.analysis.impact} impact` : "") +
          (est ? ` | est. move ${est.estMovePct > 0 ? "+" : ""}${est.estMovePct}%` : "");
      }),
    ];

    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: zodOutputFormat(BriefSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: lines.join("\n") }],
    });
    if (response.stop_reason === "refusal") throw new Error("The model declined to write this brief.");
    const out = response.parsed_output;
    if (!out) throw new Error(`No structured output (stop_reason=${response.stop_reason})`);

    const brief: AnalystBrief = {
      ...out,
      confidence: Math.max(0, Math.min(1, out.confidence)),
      symbol: input.symbol,
      generatedAt: Date.now(),
      model: this.model,
      basedOn: {
        quoteTimestamp: input.quote?.dataTimestamp ?? null,
        predictionId: input.prediction?.id ?? null,
        articleIds: input.articles.slice(0, 20).map((a) => a.id),
      },
    };
    this.cache.set(input.symbol, { at: Date.now(), key, brief });
    return brief;
  }
}
