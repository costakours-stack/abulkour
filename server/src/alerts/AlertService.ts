import { randomUUID } from "node:crypto";
import type { DB } from "../db/database.js";
import type { AlertEvent, StoredArticle } from "../domain/types.js";
import type { EventBus } from "../events.js";
import type { NewsStorageService } from "../news/NewsStorageService.js";

export interface AlertPrefs {
  symbol: string;
  newArticle: boolean;
  highImpact: boolean;
  unusualSentiment: boolean;
}

const SENTIMENT_COOLDOWN_MS = 6 * 3600_000;

export class AlertService {
  private lastSentimentAlert = new Map<string, number>();

  constructor(private db: DB, private bus: EventBus, private news: NewsStorageService, private expoPush: boolean) {}

  start() {
    this.bus.on("article:analyzed", (a) => this.onArticle(a).catch((e) => console.warn("[alerts]", e.message)));
  }

  registerDevice(deviceId: string, pushToken: string | null, notificationsEnabled: boolean) {
    this.db
      .prepare(
        `INSERT INTO devices (device_id, push_token, notifications_enabled, updated_at) VALUES (?,?,?,?)
         ON CONFLICT(device_id) DO UPDATE SET push_token = excluded.push_token,
           notifications_enabled = excluded.notifications_enabled, updated_at = excluded.updated_at`,
      )
      .run(deviceId, pushToken, notificationsEnabled ? 1 : 0, Date.now());
  }

  getDevice(deviceId: string) {
    const r = this.db.prepare("SELECT * FROM devices WHERE device_id = ?").get(deviceId) as any;
    return r ? { deviceId, notificationsEnabled: !!r.notifications_enabled, hasPushToken: !!r.push_token } : null;
  }

  getPrefs(deviceId: string): AlertPrefs[] {
    return (this.db.prepare("SELECT * FROM alert_prefs WHERE device_id = ? ORDER BY symbol").all(deviceId) as any[]).map((r) => ({
      symbol: r.symbol,
      newArticle: !!r.new_article,
      highImpact: !!r.high_impact,
      unusualSentiment: !!r.unusual_sentiment,
    }));
  }

  setPrefs(deviceId: string, p: AlertPrefs) {
    if (!this.getDevice(deviceId)) this.registerDevice(deviceId, null, true);
    this.db
      .prepare(
        `INSERT INTO alert_prefs (device_id, symbol, new_article, high_impact, unusual_sentiment) VALUES (?,?,?,?,?)
         ON CONFLICT(device_id, symbol) DO UPDATE SET new_article = excluded.new_article,
           high_impact = excluded.high_impact, unusual_sentiment = excluded.unusual_sentiment`,
      )
      .run(deviceId, p.symbol.toUpperCase(), +p.newArticle, +p.highImpact, +p.unusualSentiment);
  }

  deletePrefs(deviceId: string, symbol: string) {
    this.db.prepare("DELETE FROM alert_prefs WHERE device_id = ? AND symbol = ?").run(deviceId, symbol.toUpperCase());
  }

  history(deviceId: string, limit = 50): AlertEvent[] {
    return (this.db.prepare("SELECT * FROM alerts WHERE device_id = ? ORDER BY created_at DESC LIMIT ?").all(deviceId, limit) as any[]).map(
      (r) => ({
        id: r.id,
        deviceId: r.device_id,
        symbol: r.symbol,
        kind: r.kind,
        title: r.title,
        body: r.body,
        articleId: r.article_id ?? undefined,
        createdAt: r.created_at,
      }),
    );
  }

  private async onArticle(a: StoredArticle) {
    if (!a.analysis) return;
    // Only alert on fresh news, not on backfilled history.
    if (Date.now() - a.publishedAt > 6 * 3600_000) return;
    const symbols = a.relations.filter((r) => r.relation === "direct").map((r) => r.symbol);
    if (!symbols.length) return;

    const rows = this.db
      .prepare(
        `SELECT p.*, d.push_token FROM alert_prefs p JOIN devices d ON d.device_id = p.device_id
         WHERE d.notifications_enabled = 1 AND p.symbol IN (${symbols.map(() => "?").join(",")})`,
      )
      .all(...symbols) as any[];

    // evaluated once per symbol so every subscribed device gets the same answer
    const unusual = new Map<string, "positive" | "negative" | null>();
    for (const s of symbols) unusual.set(s, this.unusualSentiment(s));

    for (const r of rows) {
      const sym = r.symbol as string;
      let alert: Omit<AlertEvent, "id" | "createdAt" | "deviceId"> | null = null;
      const dir = unusual.get(sym);
      if (r.high_impact && a.analysis.impact === "high") {
        alert = { symbol: sym, kind: "high_impact", title: `${sym}: High-impact news detected`, body: a.headline, articleId: a.id };
      } else if (r.unusual_sentiment && dir) {
        alert = {
          symbol: sym,
          kind: "unusual_sentiment",
          title: `${sym}: Unusual ${dir} news sentiment detected`,
          body: "AI-estimated sentiment over the last 24h differs sharply from the 7-day baseline.",
          articleId: a.id,
        };
      } else if (r.new_article) {
        alert = { symbol: sym, kind: "new_article", title: `New ${sym} article detected`, body: a.headline, articleId: a.id };
      }
      if (alert) await this.deliver(r.device_id, r.push_token, alert);
    }
  }

  /** 24h mean sentiment deviates from the 7-day baseline by > 0.4, with >= 3 articles in 24h. */
  private unusualSentiment(symbol: string): "positive" | "negative" | null {
    const last = this.lastSentimentAlert.get(symbol) ?? 0;
    if (Date.now() - last < SENTIMENT_COOLDOWN_MS) return null;
    const now = Date.now();
    const week = this.news.listAvailableAt(symbol, now, 7 * 24 * 3600_000).filter((a) => a.analysis);
    const day = week.filter((a) => now - a.availableAt <= 24 * 3600_000);
    if (day.length < 3 || week.length < 6) return null;
    const avg = (xs: typeof week) => xs.reduce((s, a) => s + a.analysis!.sentimentScore, 0) / xs.length;
    const diff = avg(day) - avg(week);
    if (Math.abs(diff) <= 0.4) return null;
    this.lastSentimentAlert.set(symbol, now);
    return diff > 0 ? "positive" : "negative";
  }

  private async deliver(deviceId: string, pushToken: string | null, a: Omit<AlertEvent, "id" | "createdAt" | "deviceId">) {
    const event: AlertEvent = { ...a, id: randomUUID(), deviceId, createdAt: Date.now() };
    this.db
      .prepare("INSERT INTO alerts (id, device_id, symbol, kind, title, body, article_id, created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(event.id, deviceId, event.symbol, event.kind, event.title, event.body, event.articleId ?? null, event.createdAt);
    this.bus.emit("alert", event);
    if (this.expoPush && pushToken) {
      try {
        await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: pushToken, title: event.title, body: event.body, data: { articleId: event.articleId, symbol: event.symbol } }),
        });
      } catch (e) {
        console.warn("[alerts] push failed:", (e as Error).message);
      }
    }
  }
}
