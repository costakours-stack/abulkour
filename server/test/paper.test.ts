import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "../src/db/database.js";
import { PaperTrader } from "../src/trading/PaperTrader.js";
import { nyTimeOn } from "../src/util/time.js";

test("paper trader: buys strong estimates, obeys stop-loss, flattens at the close, P&L adds up", async () => {
  const db = openDatabase(":memory:");
  const day = Date.UTC(2026, 8, 30, 16); // a Wednesday, noon in New York
  const prices: Record<string, number> = { SPY: 500, AAA: 100, BBB: 50, CCC: 20 };
  const est: Record<string, number> = { SPY: 0.05, AAA: 0.8, BBB: 0.5, CCC: -0.3 };
  const quote = (s: string) => ({
    symbol: s, price: prices[s], change: 0, changePercent: 0, previousClose: prices[s], open: prices[s], high: prices[s], low: prices[s],
    volume: null, bid: null, ask: null, dataTimestamp: day, provider: "t", status: "LIVE", statusReason: "", session: "regular",
    delayMinutes: 0, receivedAt: day,
  });
  const market = {
    marketStatus: { isOpen: true, session: "regular" },
    getQuoteFresh: async (s: string) => quote(s),
  };
  const forecaster = {
    forecast: (s: string) => ({ horizons: [{ horizon: 1, totalPct: est[s], probabilityUp: est[s] > 0 ? 0.62 : 0.4 }] }),
  };
  const trader = new PaperTrader(db, forecaster as any, market as any, () => Object.keys(prices));

  // 10:00 — should buy AAA and BBB (CCC negative, SPY below threshold)
  await trader.tick(nyTimeOn(day, 10));
  let snap = await trader.snapshot();
  const held = snap.current!.positions.map((p) => p.symbol).sort();
  assert.deepEqual(held, ["AAA", "BBB"]);
  assert.ok(snap.current!.cash < 10_000 && snap.current!.cash > 10_000 * 0.1 - 1, "keeps a cash reserve");

  // 10:05 — AAA falls 3% -> stop-loss sells it at a loss
  prices.AAA = 97;
  await trader.tick(nyTimeOn(day, 10, 5));
  snap = await trader.snapshot();
  const stop = snap.current!.tradeLog.find((t) => t.side === "SELL" && t.symbol === "AAA")!;
  assert.match(stop.reason, /Stop-loss/);
  assert.ok(stop.realizedPnl! < 0);

  // 15:56 — everything is closed; equity == cash; P&L == sum of realized trades
  prices.BBB = 51;
  await trader.tick(nyTimeOn(day, 15, 56));
  snap = await trader.snapshot();
  const cur = snap.current!;
  assert.equal(cur.status, "closed");
  assert.equal(cur.positions.length, 0);
  const realized = cur.tradeLog.filter((t) => t.side === "SELL").reduce((s, t) => s + t.realizedPnl!, 0);
  assert.ok(Math.abs(cur.pnl - realized) < 0.05, `pnl ${cur.pnl} vs realized ${realized}`);
  assert.equal(snap.history.length, 1);

  // no trading after the session is closed
  await trader.tick(nyTimeOn(day, 15, 58));
  assert.equal((await trader.snapshot()).current!.trades, cur.trades);
});
