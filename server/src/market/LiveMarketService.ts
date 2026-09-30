// Keeps quotes fresh for subscribed symbols (polling + optional trade stream)
// and decides the honest data status for each quote.

import type { AppConfig } from "../config.js";
import type { EventBus } from "../events.js";
import type { DataStatus, MarketStatusInfo, Quote, RawQuote } from "../domain/types.js";
import type { MarketDataProvider, TradeTick } from "../providers/types.js";
import { localUsMarketStatus } from "./marketHours.js";

export function computeStatus(
  q: Pick<RawQuote, "dataTimestamp">,
  market: MarketStatusInfo,
  delayMinutes: number,
  now: number,
  stalenessMs: number,
): { status: DataStatus; reason: string } {
  if (!market.isOpen) {
    return {
      status: "MARKET_CLOSED",
      reason:
        market.session === "pre-market" || market.session === "post-market"
          ? `Regular session closed (${market.session}). Showing last available price.`
          : "Market closed. Showing last available price.",
    };
  }
  if (delayMinutes > 0) return { status: "DELAYED", reason: `Delayed market data (~${delayMinutes} min).` };
  const age = now - q.dataTimestamp;
  if (age > stalenessMs) {
    return { status: "DELAYED", reason: `Last trade was ${Math.round(age / 60_000)} min ago; data may be stale.` };
  }
  return { status: "LIVE", reason: "Real-time quote." };
}

export class LiveMarketService {
  private quotes = new Map<string, Quote>();
  private errors = new Map<string, string>();
  private subscribers = new Map<string, number>(); // symbol -> ref count
  private pinned = new Set<string>();
  private market: MarketStatusInfo = localUsMarketStatus();
  private pollTimer: NodeJS.Timeout | null = null;
  private statusTimer: NodeJS.Timeout | null = null;
  private stopStream: (() => void) | null = null;
  private streamedSymbols = "";

  constructor(private provider: MarketDataProvider, private bus: EventBus, private cfg: AppConfig) {}

  get marketStatus(): MarketStatusInfo {
    return this.market;
  }

  get providerInfo() {
    return { name: this.provider.name, ...this.provider.capabilities };
  }

  start(pinnedSymbols: string[]) {
    pinnedSymbols.forEach((s) => this.pinned.add(s.toUpperCase()));
    this.refreshMarketStatus();
    this.statusTimer = setInterval(() => this.refreshMarketStatus(), 60_000);
    this.pollAll();
    this.pollTimer = setInterval(() => this.pollAll(), this.cfg.quotePollIntervalMs);
    this.restartStream();
  }

  stop() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.stopStream?.();
  }

  subscribe(symbol: string) {
    const s = symbol.toUpperCase();
    const n = (this.subscribers.get(s) ?? 0) + 1;
    this.subscribers.set(s, n);
    if (n === 1 && !this.pinned.has(s)) {
      void this.refresh(s);
      this.restartStream();
    }
  }

  unsubscribe(symbol: string) {
    const s = symbol.toUpperCase();
    const n = (this.subscribers.get(s) ?? 0) - 1;
    if (n <= 0) this.subscribers.delete(s);
    else this.subscribers.set(s, n);
  }

  private activeSymbols(): string[] {
    return [...new Set([...this.pinned, ...this.subscribers.keys()])];
  }

  private async refreshMarketStatus() {
    try {
      this.market = await this.provider.getMarketStatus();
    } catch {
      this.market = localUsMarketStatus();
    }
  }

  private async pollAll() {
    for (const s of this.activeSymbols()) await this.refresh(s);
  }

  /** Returns the cached quote with its status re-evaluated for *now*. */
  getQuote(symbol: string): Quote | { symbol: string; status: "DATA_UNAVAILABLE"; statusReason: string } {
    const s = symbol.toUpperCase();
    const q = this.quotes.get(s);
    if (!q) {
      return { symbol: s, status: "DATA_UNAVAILABLE", statusReason: this.errors.get(s) ?? "No data received yet." };
    }
    return this.withStatus(q);
  }

  async getQuoteFresh(symbol: string) {
    const s = symbol.toUpperCase();
    const cached = this.quotes.get(s);
    if (!cached || Date.now() - cached.receivedAt > this.cfg.quotePollIntervalMs) await this.refresh(s);
    return this.getQuote(s);
  }

  private withStatus(q: Quote): Quote {
    const { status, reason } = computeStatus(
      q,
      this.market,
      this.provider.capabilities.quoteDelayMinutes,
      Date.now(),
      this.cfg.liveStalenessMs,
    );
    return { ...q, status, statusReason: reason, session: this.market.session };
  }

  async refresh(symbol: string): Promise<void> {
    try {
      const raw = await this.provider.getQuote(symbol);
      const prev = this.quotes.get(symbol);
      // a streamed trade may be newer than the polled quote; keep the newest price
      const useStreamPrice = prev && prev.dataTimestamp > raw.dataTimestamp;
      const q: Quote = this.withStatus({
        ...raw,
        price: useStreamPrice ? prev.price : raw.price,
        dataTimestamp: useStreamPrice ? prev.dataTimestamp : raw.dataTimestamp,
        volume: raw.volume ?? prev?.volume ?? null,
        status: "DATA_UNAVAILABLE",
        statusReason: "",
        session: this.market.session,
        delayMinutes: this.provider.capabilities.quoteDelayMinutes,
        receivedAt: Date.now(),
      });
      this.quotes.set(symbol, q);
      this.errors.delete(symbol);
      this.bus.emit("quote", q);
    } catch (e) {
      this.errors.set(symbol, (e as Error).message);
    }
  }

  private restartStream() {
    if (!this.provider.capabilities.streaming || !this.provider.streamTrades) return;
    const symbols = this.activeSymbols().sort();
    const key = symbols.join(",");
    if (key === this.streamedSymbols) return;
    this.streamedSymbols = key;
    this.stopStream?.();
    this.stopStream = this.provider.streamTrades(symbols, (t) => this.onTick(t));
  }

  private lastEmit = new Map<string, number>();

  private onTick(t: TradeTick) {
    const q = this.quotes.get(t.symbol);
    if (!q || t.timestamp <= q.dataTimestamp) return;
    const change = q.previousClose ? t.price - q.previousClose : q.change;
    const updated: Quote = this.withStatus({
      ...q,
      price: t.price,
      change,
      changePercent: q.previousClose && change !== null ? (change / q.previousClose) * 100 : q.changePercent,
      high: q.high !== null ? Math.max(q.high, t.price) : q.high,
      low: q.low !== null ? Math.min(q.low, t.price) : q.low,
      dataTimestamp: t.timestamp,
      receivedAt: Date.now(),
    });
    this.quotes.set(t.symbol, updated);
    // throttle pushes to clients to 1/sec per symbol
    const last = this.lastEmit.get(t.symbol) ?? 0;
    if (Date.now() - last >= 1000) {
      this.lastEmit.set(t.symbol, Date.now());
      this.bus.emit("quote", updated);
    }
  }
}
