import WebSocket from "ws";
import type { Candle, CandleResolution, MarketSession, MarketStatusInfo, RawQuote } from "../../domain/types.js";
import { getJson, RateLimiter } from "../http.js";
import {
  ProviderNotSupportedError,
  type MarketDataCapabilities,
  type MarketDataProvider,
  type TradeTick,
} from "../types.js";

const BASE = "https://finnhub.io/api/v1";

interface FinnhubQuote {
  c: number; d: number | null; dp: number | null; h: number; l: number; o: number; pc: number; t: number;
}

// Shared across the Finnhub providers so the combined call rate respects the plan.
export const finnhubLimiter = new RateLimiter(1100); // ~55 calls/min (free plan = 60)

export class FinnhubMarketDataProvider implements MarketDataProvider {
  readonly name = "finnhub";
  readonly capabilities: MarketDataCapabilities;

  constructor(private apiKey: string, delayMinutes: number, streaming: boolean) {
    this.capabilities = {
      realtimeQuotes: delayMinutes === 0,
      quoteDelayMinutes: delayMinutes,
      bidAsk: false, // /quote does not include bid/ask
      streaming,
      candles: false, // candles are a premium Finnhub endpoint; Polygon handles history
    };
  }

  private url(path: string, params: Record<string, string>): string {
    const qs = new URLSearchParams({ ...params, token: this.apiKey });
    return `${BASE}${path}?${qs}`;
  }

  async getQuote(symbol: string): Promise<RawQuote> {
    const q = await getJson<FinnhubQuote>(this.url("/quote", { symbol }), { limiter: finnhubLimiter });
    // Finnhub returns all zeros for unknown symbols.
    if (!q || (!q.c && !q.t)) throw new Error(`No quote data for ${symbol}`);
    return {
      symbol,
      price: q.c,
      change: q.d,
      changePercent: q.dp,
      previousClose: q.pc || null,
      open: q.o || null,
      high: q.h || null,
      low: q.l || null,
      volume: null, // not included in /quote; filled from candles/stream when available
      bid: null,
      ask: null,
      dataTimestamp: q.t * 1000,
      provider: this.name,
    };
  }

  async getCandles(_s: string, _r: CandleResolution, _f: number, _t: number): Promise<Candle[]> {
    throw new ProviderNotSupportedError(this.name, "candles");
  }

  async getMarketStatus(): Promise<MarketStatusInfo> {
    const s = await getJson<{ isOpen: boolean; session: string | null; exchange: string; t: number }>(
      this.url("/stock/market-status", { exchange: "US" }),
      { limiter: finnhubLimiter },
    );
    const session: MarketSession =
      s.session === "regular" || s.session === "pre-market" || s.session === "post-market" ? s.session : "closed";
    return { isOpen: s.isOpen, session, exchange: s.exchange, asOf: s.t * 1000, source: this.name };
  }

  async searchSymbols(query: string) {
    const r = await getJson<{ result: { symbol: string; description: string; type: string }[] }>(
      this.url("/search", { q: query, exchange: "US" }),
      { limiter: finnhubLimiter },
    );
    return (r.result ?? [])
      .filter((x) => !x.symbol.includes("."))
      .slice(0, 20)
      .map((x) => ({ symbol: x.symbol, name: x.description, type: x.type }));
  }

  streamTrades(symbols: string[], onTick: (tick: TradeTick) => void): () => void {
    let ws: WebSocket | null = null;
    let closed = false;
    let backoff = 1000;

    const connect = () => {
      ws = new WebSocket(`wss://ws.finnhub.io?token=${this.apiKey}`);
      ws.on("open", () => {
        backoff = 1000;
        for (const s of symbols) ws!.send(JSON.stringify({ type: "subscribe", symbol: s }));
      });
      ws.on("message", (buf) => {
        try {
          const msg = JSON.parse(buf.toString());
          if (msg.type !== "trade" || !Array.isArray(msg.data)) return;
          for (const t of msg.data) onTick({ symbol: t.s, price: t.p, volume: t.v, timestamp: t.t });
        } catch {
          /* ignore malformed frames */
        }
      });
      ws.on("close", () => {
        if (closed) return;
        setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 60_000);
      });
      ws.on("error", (e) => console.warn("[finnhub-ws] error:", e.message));
    };
    connect();
    return () => {
      closed = true;
      ws?.close();
    };
  }
}
