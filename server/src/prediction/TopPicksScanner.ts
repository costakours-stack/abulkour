// Scans the universe, ranks symbols by the model's estimated return for the
// next close, and keeps every scan (append-only) so past "top picks" can be
// scored against what actually happened.

import { randomUUID } from "node:crypto";
import { getCompany, getEtf } from "../assets/assetRegistry.js";
import type { DB } from "../db/database.js";
import type { HistoryStore } from "../history/HistoryStore.js";
import type { LiveMarketService } from "../market/LiveMarketService.js";
import type { Forecaster } from "./Forecaster.js";
import { candleAvailableAt } from "./PointInTime.js";

export interface PickRow {
  rank: number;
  symbol: string;
  name: string;
  type: "stock" | "etf";
  basePrice: number;
  marketDataTimestamp: number;
  estPct: number;
  technicalPct: number;
  newsPct: number;
  lowPct: number;
  highPct: number;
  probabilityUp: number;
  fc5Pct: number | null;
  fc20Pct: number | null;
  newsEvents: number;
  drivers: { feature: string; contributionPct: number }[];
}

export interface Scan {
  id: string;
  createdAt: number;
  modelVersion: string;
  universeSize: number;
  picks: PickRow[]; // top 10, positive estimates only
  all: { symbol: string; estPct: number; basePrice: number }[]; // every scanned symbol, for later scoring
}

export class TopPicksScanner {
  private running = false;

  constructor(
    private db: DB,
    private forecaster: Forecaster,
    private history: HistoryStore,
    private market: LiveMarketService,
    private universe: () => string[],
  ) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS scans (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS scans_no_update BEFORE UPDATE ON scans BEGIN SELECT RAISE(ABORT, 'scans are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS scans_no_delete BEFORE DELETE ON scans BEGIN SELECT RAISE(ABORT, 'scans are append-only'); END;`);
  }

  start() {
    const tick = () => {
      const last = this.latest();
      const every = this.market.marketStatus.isOpen ? 20 * 60_000 : 3 * 3600_000;
      if (!last || Date.now() - last.createdAt > every) this.scan().catch((e) => console.warn("[picks]", e.message));
    };
    setTimeout(tick, 20_000);
    setInterval(tick, 5 * 60_000);
  }

  latest(): Scan | null {
    const r = this.db.prepare("SELECT body FROM scans ORDER BY created_at DESC LIMIT 1").get() as { body: string } | undefined;
    return r ? JSON.parse(r.body) : null;
  }

  async scan(): Promise<Scan> {
    if (this.running) throw new Error("Scan already running");
    this.running = true;
    try {
      const asOf = Date.now();
      const rows: (Omit<PickRow, "rank">)[] = [];
      let modelVersion = "?";
      for (const symbol of this.universe()) {
        const q = this.market.getQuote(symbol);
        const f = this.forecaster.forecast(symbol, "price" in q ? q : null, asOf);
        if (!f) continue;
        modelVersion = f.modelVersion;
        const h1 = f.horizons[0];
        const h5 = f.horizons.find((h) => h.horizon === 5);
        const h20 = f.horizons.find((h) => h.horizon === 20);
        rows.push({
          symbol,
          name: getCompany(symbol)?.name ?? getEtf(symbol)?.name ?? symbol,
          type: getEtf(symbol) || ["IWM", "XLV", "XLY", "XLI"].includes(symbol) ? "etf" : "stock",
          basePrice: f.basePrice,
          marketDataTimestamp: f.marketDataTimestamp,
          estPct: h1.totalPct,
          technicalPct: h1.technicalPct,
          newsPct: h1.newsPct,
          lowPct: h1.lowPct,
          highPct: h1.highPct,
          probabilityUp: h1.probabilityUp,
          fc5Pct: h5?.totalPct ?? null,
          fc20Pct: h20?.totalPct ?? null,
          newsEvents: f.newsArticlesSinceClose,
          drivers: f.drivers.slice(0, 3).map((d) => ({ feature: d.feature, contributionPct: d.contributionPct })),
        });
      }
      const r2 = (x: number) => Math.round(x * 1000) / 1000;
      const picks = rows
        .filter((r) => r.estPct > 0)
        .sort((a, b) => b.estPct - a.estPct || b.probabilityUp - a.probabilityUp)
        .slice(0, 10)
        .map((r, i) => ({ ...r, rank: i + 1, estPct: r2(r.estPct), technicalPct: r2(r.technicalPct), newsPct: r2(r.newsPct), lowPct: r2(r.lowPct), highPct: r2(r.highPct) }));
      const scan: Scan = {
        id: randomUUID(),
        createdAt: asOf,
        modelVersion,
        universeSize: rows.length,
        picks,
        all: rows.map((r) => ({ symbol: r.symbol, estPct: r2(r.estPct), basePrice: r.basePrice })),
      };
      this.db.prepare("INSERT INTO scans (id, created_at, body) VALUES (?,?,?)").run(scan.id, scan.createdAt, JSON.stringify(scan));
      return scan;
    } finally {
      this.running = false;
    }
  }

  /**
   * How past scans turned out: for each scan, the realized return to the next
   * close for the top picks vs. the average of everything scanned.
   * One scan per trading day (the latest of that day) to avoid double counting.
   */
  track(days = 30) {
    const rows = this.db
      .prepare("SELECT body FROM scans WHERE created_at >= ? ORDER BY created_at DESC")
      .all(Date.now() - days * 86_400_000) as { body: string }[];
    const perDay = new Map<string, Scan>();
    for (const r of rows) {
      const s = JSON.parse(r.body) as Scan;
      const day = new Date(s.createdAt).toISOString().slice(0, 10);
      if (!perDay.has(day)) perDay.set(day, s);
    }
    const realized = (symbol: string, from: number, base: number) => {
      const bar = this.history.bars(symbol, from - 3 * 86_400_000).find((b) => candleAvailableAt(b, "1day") > from);
      if (!bar || candleAvailableAt(bar, "1day") > Date.now()) return null;
      return (bar.c / base - 1) * 100;
    };
    const out = [];
    for (const s of perDay.values()) {
      const pickRets = s.picks.map((p) => realized(p.symbol, s.createdAt, p.basePrice)).filter((x): x is number => x !== null);
      const allRets = s.all.map((a) => realized(a.symbol, s.createdAt, a.basePrice)).filter((x): x is number => x !== null);
      if (!pickRets.length || !allRets.length) continue;
      const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      out.push({
        scanId: s.id,
        createdAt: s.createdAt,
        picks: s.picks.length,
        picksAvgPct: Math.round(avg(pickRets) * 100) / 100,
        universeAvgPct: Math.round(avg(allRets) * 100) / 100,
        picksUpShare: pickRets.filter((r) => r > 0).length / pickRets.length,
      });
    }
    const n = out.length;
    return {
      scans: out,
      summary: n
        ? {
            days: n,
            picksAvgPct: Math.round((out.reduce((s, x) => s + x.picksAvgPct, 0) / n) * 100) / 100,
            universeAvgPct: Math.round((out.reduce((s, x) => s + x.universeAvgPct, 0) / n) * 100) / 100,
            beatUniverseShare: out.filter((x) => x.picksAvgPct > x.universeAvgPct).length / n,
          }
        : null,
    };
  }
}
