import type { DB } from "../db/database.js";

export class WatchlistService {
  constructor(private db: DB, private defaults: string[]) {}

  get(deviceId: string): string[] {
    const rows = this.db.prepare("SELECT symbol FROM watchlists WHERE device_id = ? ORDER BY position").all(deviceId) as any[];
    return rows.length ? rows.map((r) => r.symbol) : [...this.defaults];
  }

  set(deviceId: string, symbols: string[]) {
    const clean = [...new Set(symbols.map((s) => s.toUpperCase().trim()).filter((s) => /^[A-Z.]{1,6}$/.test(s)))].slice(0, 50);
    this.db.prepare("DELETE FROM watchlists WHERE device_id = ?").run(deviceId);
    const stmt = this.db.prepare("INSERT INTO watchlists (device_id, symbol, position) VALUES (?,?,?)");
    clean.forEach((s, i) => stmt.run(deviceId, s, i));
    return clean;
  }

  /** Every symbol any device watches, plus defaults. Drives background polling and predictions. */
  all(): string[] {
    const rows = this.db.prepare("SELECT DISTINCT symbol FROM watchlists").all() as any[];
    return [...new Set([...this.defaults, ...rows.map((r) => r.symbol as string)])].slice(0, 40);
  }
}
