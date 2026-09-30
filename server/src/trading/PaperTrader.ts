// AI paper trader: a SIMULATION with virtual money. No orders are sent anywhere.
//
// Each trading day is one session: it starts with $10,000 at the open, trades on
// the model's estimates every few minutes, and closes every position just before
// the close, so each day's result stands on its own. Fills use the live quote
// plus/minus a slippage cost, and every decision is logged with its reason and the
// model numbers behind it. Results are compared with simply holding SPY.

import { randomUUID } from "node:crypto";
import { getCompany, getEtf } from "../assets/assetRegistry.js";
import type { DB } from "../db/database.js";
import type { Quote } from "../domain/types.js";
import type { LiveMarketService } from "../market/LiveMarketService.js";
import type { Forecaster } from "../prediction/Forecaster.js";
import { nyDate, nyMinutes } from "../util/time.js";

export interface TraderRules {
  startingCash: number;
  maxPositions: number;
  /** keep this share of equity in cash */
  cashReserve: number;
  /** minimum model estimate (next close, %) to buy */
  minEstPct: number;
  /** minimum model P(up) to buy */
  minProbUp: number;
  stopLossPct: number;
  takeProfitPct: number;
  /** cost per fill (bid/ask spread + market impact), as a fraction of price */
  slippage: number;
  /** minutes to wait before re-buying a symbol after selling it */
  reentryCooldownMin: number;
  /** trading window, New York minutes since midnight */
  startMin: number; // 9:35 — skip the noisy first minutes
  lastEntryMin: number; // 15:30 — no new buys late in the day
  flattenMin: number; // 15:55 — close everything
  intervalMs: number;
}

export const DEFAULT_RULES: TraderRules = {
  startingCash: 10_000,
  maxPositions: 5,
  cashReserve: 0.1,
  minEstPct: 0.15,
  minProbUp: 0.55,
  stopLossPct: 2,
  takeProfitPct: 3,
  slippage: 0.0005,
  reentryCooldownMin: 30,
  startMin: 9 * 60 + 35,
  lastEntryMin: 15 * 60 + 30,
  flattenMin: 15 * 60 + 55,
  intervalMs: 5 * 60_000,
};

interface Position {
  symbol: string;
  qty: number;
  entryPrice: number;
  entryAt: number;
  estAtEntry: number;
}

export interface Trade {
  id: string;
  sessionDate: string;
  at: number;
  side: "BUY" | "SELL";
  symbol: string;
  qty: number;
  price: number;
  value: number;
  reason: string;
  estPct: number | null;
  probUp: number | null;
  realizedPnl: number | null;
  realizedPct: number | null;
}

interface SessionRow {
  date: string;
  startedAt: number;
  endedAt: number | null;
  startEquity: number;
  cash: number;
  positions: Position[];
  spyStart: number | null;
  spyLast: number | null;
  status: "trading" | "closed";
}

export class PaperTrader {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  lastRunAt: number | null = null;
  lastError: string | null = null;

  constructor(
    private db: DB,
    private forecaster: Forecaster,
    private market: LiveMarketService,
    private universe: () => string[],
    readonly rules: TraderRules = DEFAULT_RULES,
  ) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS paper_sessions (date TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS paper_trades (
        id TEXT PRIMARY KEY, session_date TEXT NOT NULL, at INTEGER NOT NULL, body TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_paper_trades_session ON paper_trades(session_date, at);
      CREATE TABLE IF NOT EXISTS paper_equity (session_date TEXT NOT NULL, at INTEGER NOT NULL, equity REAL NOT NULL, spy REAL);
      CREATE INDEX IF NOT EXISTS idx_paper_equity ON paper_equity(session_date, at);`);
  }

  start() {
    const tick = () => this.tick().catch((e) => (this.lastError = (e as Error).message));
    setTimeout(tick, 30_000);
    this.timer = setInterval(tick, this.rules.intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  // ------------------------------------------------------------------ storage

  private loadSession(date: string): SessionRow | null {
    const r = this.db.prepare("SELECT body FROM paper_sessions WHERE date = ?").get(date) as { body: string } | undefined;
    return r ? JSON.parse(r.body) : null;
  }

  private saveSession(s: SessionRow) {
    this.db.prepare("INSERT OR REPLACE INTO paper_sessions (date, body) VALUES (?,?)").run(s.date, JSON.stringify(s));
  }

  private logTrade(t: Trade) {
    this.db.prepare("INSERT INTO paper_trades (id, session_date, at, body) VALUES (?,?,?,?)").run(t.id, t.sessionDate, t.at, JSON.stringify(t));
  }

  private trades(date: string): Trade[] {
    return (this.db.prepare("SELECT body FROM paper_trades WHERE session_date = ? ORDER BY at").all(date) as { body: string }[]).map((r) =>
      JSON.parse(r.body),
    );
  }

  // ------------------------------------------------------------------ prices

  private async price(symbol: string): Promise<Quote | null> {
    const q = await this.market.getQuoteFresh(symbol);
    return "price" in q && q.price > 0 ? q : null;
  }

  private async equityOf(s: SessionRow): Promise<{ equity: number; marks: Record<string, number> }> {
    const marks: Record<string, number> = {};
    let equity = s.cash;
    for (const p of s.positions) {
      const q = await this.price(p.symbol);
      marks[p.symbol] = q?.price ?? p.entryPrice;
      equity += p.qty * marks[p.symbol];
    }
    return { equity, marks };
  }

  // ------------------------------------------------------------------ trading

  private buy(s: SessionRow, symbol: string, price: number, budget: number, reason: string, est: number, pUp: number, at: number) {
    const fill = price * (1 + this.rules.slippage);
    const qty = Math.floor(budget / fill);
    if (qty < 1) return;
    const value = qty * fill;
    s.cash -= value;
    s.positions.push({ symbol, qty, entryPrice: fill, entryAt: at, estAtEntry: est });
    this.logTrade({
      id: randomUUID(), sessionDate: s.date, at, side: "BUY", symbol, qty, price: round(fill, 4), value: round(value),
      reason, estPct: round(est, 3), probUp: round(pUp, 3), realizedPnl: null, realizedPct: null,
    });
  }

  private sell(s: SessionRow, p: Position, price: number, reason: string, at: number, est?: number | null, pUp?: number | null) {
    est ??= null;
    pUp ??= null;
    const fill = price * (1 - this.rules.slippage);
    const value = p.qty * fill;
    const pnl = value - p.qty * p.entryPrice;
    s.cash += value;
    s.positions = s.positions.filter((x) => x !== p);
    this.logTrade({
      id: randomUUID(), sessionDate: s.date, at, side: "SELL", symbol: p.symbol, qty: p.qty, price: round(fill, 4), value: round(value),
      reason, estPct: est === null ? null : round(est, 3), probUp: pUp === null ? null : round(pUp, 3),
      realizedPnl: round(pnl), realizedPct: round((fill / p.entryPrice - 1) * 100, 3),
    });
  }

  /** One decision cycle. Safe to call any time; does nothing outside market hours. */
  async tick(now = Date.now()): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const date = nyDate(now);
      const minute = nyMinutes(now);
      let s = this.loadSession(date);

      // Finish a session that is still open after the flatten time (e.g. the server was asleep).
      if (s && s.status === "trading" && (minute >= this.rules.flattenMin || !this.market.marketStatus.isOpen)) {
        await this.flatten(s, now, "End of day: close all positions");
        return;
      }
      if (!this.market.marketStatus.isOpen || minute < this.rules.startMin || minute >= this.rules.flattenMin) return;

      if (!s) {
        const spy = await this.price("SPY");
        s = {
          date, startedAt: now, endedAt: null, startEquity: this.rules.startingCash, cash: this.rules.startingCash,
          positions: [], spyStart: spy?.price ?? null, spyLast: spy?.price ?? null, status: "trading",
        };
        this.saveSession(s);
      }
      if (s.status !== "trading") return;
      this.lastRunAt = now;

      // 1) rank the universe by the model's estimate (from the latest completed data + news)
      const ranked = this.universe()
        .map((sym) => {
          const f = this.forecaster.forecast(sym, null, now);
          const h = f?.horizons[0];
          return h ? { symbol: sym, est: h.totalPct, pUp: h.probabilityUp } : null;
        })
        .filter((x): x is { symbol: string; est: number; pUp: number } => !!x)
        .sort((a, b) => b.est - a.est);
      const rankOf = new Map(ranked.map((r, i) => [r.symbol, i]));

      // 2) exits: stop-loss, take-profit, or the model no longer favours the position
      for (const p of [...s.positions]) {
        const q = await this.price(p.symbol);
        if (!q) continue;
        // refine with the live quote for held symbols
        const live = this.forecaster.forecast(p.symbol, q, now)?.horizons[0];
        const chg = (q.price / p.entryPrice - 1) * 100;
        const rank = rankOf.get(p.symbol) ?? 999;
        if (chg <= -this.rules.stopLossPct) this.sell(s, p, q.price, `Stop-loss: down ${chg.toFixed(2)}% from entry`, now, live?.totalPct, live?.probabilityUp);
        else if (chg >= this.rules.takeProfitPct) this.sell(s, p, q.price, `Take-profit: up ${chg.toFixed(2)}% from entry`, now, live?.totalPct, live?.probabilityUp);
        else if (live && live.totalPct <= 0) this.sell(s, p, q.price, `AI estimate turned negative (${live.totalPct.toFixed(2)}%)`, now, live.totalPct, live.probabilityUp);
        else if (rank >= this.rules.maxPositions * 3) this.sell(s, p, q.price, `Dropped out of the AI's top ${this.rules.maxPositions * 3}`, now, live?.totalPct ?? null, live?.probabilityUp ?? null);
      }

      // 3) entries
      if (minute < this.rules.lastEntryMin) {
        const recentSells = new Map(
          this.trades(date)
            .filter((t) => t.side === "SELL")
            .map((t) => [t.symbol, t.at]),
        );
        const { equity } = await this.equityOf(s);
        const slotBudget = (equity * (1 - this.rules.cashReserve)) / this.rules.maxPositions;
        for (const c of ranked) {
          if (s.positions.length >= this.rules.maxPositions) break;
          if (c.est < this.rules.minEstPct) break; // ranked: nothing better below
          if (s.positions.some((p) => p.symbol === c.symbol)) continue;
          const soldAt = recentSells.get(c.symbol);
          if (soldAt && now - soldAt < this.rules.reentryCooldownMin * 60_000) continue;
          const q = await this.price(c.symbol);
          if (!q) continue;
          const live = this.forecaster.forecast(c.symbol, q, now)?.horizons[0];
          if (!live || live.totalPct < this.rules.minEstPct || live.probabilityUp < this.rules.minProbUp) continue;
          const budget = Math.min(slotBudget, s.cash - equity * this.rules.cashReserve);
          if (budget < q.price) continue;
          this.buy(
            s, c.symbol, q.price, budget,
            `AI estimate ${live.totalPct >= 0 ? "+" : ""}${live.totalPct.toFixed(2)}% (P(up) ${(live.probabilityUp * 100).toFixed(0)}%), rank #${(rankOf.get(c.symbol) ?? 0) + 1}`,
            live.totalPct, live.probabilityUp, now,
          );
        }
      }

      // 4) mark to market
      const spy = await this.price("SPY");
      s.spyLast = spy?.price ?? s.spyLast;
      this.saveSession(s);
      const { equity } = await this.equityOf(s);
      this.db.prepare("INSERT INTO paper_equity (session_date, at, equity, spy) VALUES (?,?,?,?)").run(date, now, round(equity), s.spyLast);
    } finally {
      this.busy = false;
    }
  }

  private async flatten(s: SessionRow, now: number, reason: string) {
    for (const p of [...s.positions]) {
      const q = await this.price(p.symbol);
      this.sell(s, p, q?.price ?? p.entryPrice, reason, now);
    }
    const spy = await this.price("SPY");
    s.spyLast = spy?.price ?? s.spyLast;
    s.status = "closed";
    s.endedAt = now;
    this.saveSession(s);
    this.db.prepare("INSERT INTO paper_equity (session_date, at, equity, spy) VALUES (?,?,?,?)").run(s.date, now, round(s.cash), s.spyLast);
  }

  // ------------------------------------------------------------------ reporting

  async snapshot() {
    const now = Date.now();
    const date = nyDate(now);
    const sessions = (this.db.prepare("SELECT body FROM paper_sessions ORDER BY date DESC LIMIT 30").all() as { body: string }[]).map(
      (r) => JSON.parse(r.body) as SessionRow,
    );
    const today = sessions.find((x) => x.date === date) ?? null;
    const current = today ?? sessions[0] ?? null;

    const summarize = async (s: SessionRow) => {
      const trades = this.trades(s.date);
      const { equity, marks } = s.status === "trading" ? await this.equityOf(s) : { equity: s.cash, marks: {} as Record<string, number> };
      const sells = trades.filter((t) => t.side === "SELL");
      const wins = sells.filter((t) => (t.realizedPnl ?? 0) > 0);
      const spyPct = s.spyStart && s.spyLast ? (s.spyLast / s.spyStart - 1) * 100 : null;
      const slippageCost = trades.reduce((sum, t) => sum + t.value * this.rules.slippage, 0);
      return {
        date: s.date,
        status: s.status,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        startEquity: s.startEquity,
        equity: round(equity),
        cash: round(s.cash),
        pnl: round(equity - s.startEquity),
        pnlPct: round((equity / s.startEquity - 1) * 100, 3),
        spyPct: spyPct === null ? null : round(spyPct, 3),
        trades: trades.length,
        closedTrades: sells.length,
        winRate: sells.length ? wins.length / sells.length : null,
        best: sells.length ? Math.max(...sells.map((t) => t.realizedPnl ?? 0)) : null,
        worst: sells.length ? Math.min(...sells.map((t) => t.realizedPnl ?? 0)) : null,
        slippageCost: round(slippageCost),
        positions: s.positions.map((p) => {
          const px = marks[p.symbol] ?? p.entryPrice;
          return {
            symbol: p.symbol,
            name: getCompany(p.symbol)?.name ?? getEtf(p.symbol)?.name ?? p.symbol,
            qty: p.qty,
            entryPrice: round(p.entryPrice, 4),
            price: round(px, 4),
            value: round(p.qty * px),
            pnl: round(p.qty * (px - p.entryPrice)),
            pnlPct: round((px / p.entryPrice - 1) * 100, 3),
            entryAt: p.entryAt,
            estAtEntry: p.estAtEntry,
          };
        }),
        tradeLog: trades.slice().reverse(),
        equityCurve: (this.db.prepare("SELECT at, equity, spy FROM paper_equity WHERE session_date = ? ORDER BY at").all(s.date) as {
          at: number;
          equity: number;
          spy: number | null;
        }[]).map((e) => ({ t: e.at, equity: e.equity, spyEquity: s.spyStart && e.spy ? round((s.startEquity * e.spy) / s.spyStart) : null })),
      };
    };

    const history = [];
    for (const s of sessions.filter((x) => x.status === "closed")) {
      const sum = await summarize(s);
      history.push({ date: sum.date, pnl: sum.pnl, pnlPct: sum.pnlPct, spyPct: sum.spyPct, trades: sum.trades, winRate: sum.winRate });
    }
    const minute = nyMinutes(now);
    return {
      simulated: true,
      now,
      marketOpen: this.market.marketStatus.isOpen,
      tradingWindow: this.market.marketStatus.isOpen && minute >= this.rules.startMin && minute < this.rules.flattenMin,
      lastRunAt: this.lastRunAt,
      lastError: this.lastError,
      rules: this.rules,
      current: current ? await summarize(current) : null,
      history,
    };
  }
}

function round(x: number, d = 2) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
