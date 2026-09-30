// Long daily price history for training, charts and sparklines, kept in SQLite.
// Source priority: Tiingo (back to 2000, free key) -> Polygon (2 years on the free plan).

import type { DB } from "../db/database.js";
import type { Candle } from "../domain/types.js";
import type { MarketDataProvider } from "../providers/types.js";
import type { TiingoHistoryProvider } from "../providers/tiingo/TiingoHistoryProvider.js";
import { DAY_MS, nyDate } from "../util/time.js";

export const HISTORY_START = "2000-01-01";

export interface SyncStatus {
  symbol: string;
  source: string;
  firstDate: string | null;
  lastDate: string | null;
  bars: number;
  syncedAt: number | null;
}

export class HistoryStore {
  private syncing = false;
  progress = { done: 0, total: 0, current: null as string | null, lastError: null as string | null };

  constructor(
    private db: DB,
    private tiingo: TiingoHistoryProvider | null,
    private polygon: Pick<MarketDataProvider, "getCandles"> | null,
  ) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS daily_bars (
        symbol TEXT NOT NULL, date TEXT NOT NULL, t INTEGER NOT NULL,
        o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL, v REAL NOT NULL,
        source TEXT NOT NULL, PRIMARY KEY (symbol, date)
      );
      CREATE TABLE IF NOT EXISTS history_sync (
        symbol TEXT PRIMARY KEY, source TEXT NOT NULL, synced_at INTEGER NOT NULL
      );`);
  }

  get source(): string {
    return this.tiingo ? "tiingo" : this.polygon ? "polygon" : "none";
  }

  get isSyncing() {
    return this.syncing;
  }

  bars(symbol: string, fromMs = 0, toMs = Number.MAX_SAFE_INTEGER): Candle[] {
    return this.db
      .prepare("SELECT t, o, h, l, c, v FROM daily_bars WHERE symbol = ? AND t >= ? AND t <= ? ORDER BY t")
      .all(symbol.toUpperCase(), fromMs, toMs) as unknown as Candle[];
  }

  lastCloses(symbol: string, n: number): number[] {
    const rows = this.db
      .prepare("SELECT c FROM daily_bars WHERE symbol = ? ORDER BY t DESC LIMIT ?")
      .all(symbol.toUpperCase(), n) as { c: number }[];
    return rows.map((r) => r.c).reverse();
  }

  status(): SyncStatus[] {
    return (
      this.db
        .prepare(
          `SELECT b.symbol, MIN(b.date) AS first, MAX(b.date) AS last, COUNT(*) AS n, s.source, s.synced_at
           FROM daily_bars b LEFT JOIN history_sync s ON s.symbol = b.symbol GROUP BY b.symbol ORDER BY b.symbol`,
        )
        .all() as any[]
    ).map((r) => ({ symbol: r.symbol, source: r.source ?? "?", firstDate: r.first, lastDate: r.last, bars: r.n, syncedAt: r.synced_at }));
  }

  /** Store bars (also used for manual backfills and tests). */
  importBars(symbol: string, bars: Candle[], source: string) {
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO daily_bars (symbol, date, t, o, h, l, c, v, source) VALUES (?,?,?,?,?,?,?,?,?)",
    );
    this.db.exec("BEGIN");
    try {
      for (const b of bars) stmt.run(symbol, nyDate(b.t + 12 * 3600_000), b.t, b.o, b.h, b.l, b.c, b.v, source);
      this.db
        .prepare("INSERT OR REPLACE INTO history_sync (symbol, source, synced_at) VALUES (?,?,?)")
        .run(symbol, source, Date.now());
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** Fetch missing history for each symbol. Safe to call repeatedly; only new bars are requested. */
  async sync(symbols: string[]): Promise<void> {
    if (this.syncing || (!this.tiingo && !this.polygon)) return;
    this.syncing = true;
    this.progress = { done: 0, total: symbols.length, current: null, lastError: null };
    try {
      for (const raw of symbols) {
        const symbol = raw.toUpperCase();
        this.progress.current = symbol;
        try {
          const row = this.db
            .prepare("SELECT MAX(t) AS last, MIN(date) AS first, COUNT(*) AS n FROM daily_bars WHERE symbol = ?")
            .get(symbol) as { last: number | null; first: string | null; n: number };
          const prevSource = (this.db.prepare("SELECT source FROM history_sync WHERE symbol = ?").get(symbol) as any)?.source;
          // Upgrade from Polygon's 2-year window to full Tiingo history when a key is added.
          const needFull = !row.last || (this.tiingo && prevSource !== "tiingo");
          const synced = (this.db.prepare("SELECT synced_at FROM history_sync WHERE symbol = ?").get(symbol) as any)?.synced_at ?? 0;
          if (!needFull && Date.now() - synced < 6 * 3600_000) continue;

          if (this.tiingo) {
            const start = needFull ? HISTORY_START : nyDate(row.last! - 5 * DAY_MS);
            this.importBars(symbol, await this.tiingo.dailyBars(symbol, start), "tiingo");
          } else if (this.polygon) {
            const from = needFull ? Date.now() - 2 * 365 * DAY_MS : row.last! - 5 * DAY_MS;
            this.importBars(symbol, await this.polygon.getCandles(symbol, "1day", from, Date.now()), "polygon");
          }
        } catch (e) {
          this.progress.lastError = `${symbol}: ${(e as Error).message}`;
          console.warn(`[history] ${this.progress.lastError}`);
        } finally {
          this.progress.done++;
        }
      }
    } finally {
      this.syncing = false;
      this.progress.current = null;
    }
  }
}
