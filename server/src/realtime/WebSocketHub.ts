// Pushes live updates to the React Native app.
//
// Client -> server: {"type":"subscribe","channels":["quotes:AAPL","news:all","news:AAPL","predictions:AAPL","alerts"],"deviceId":"..."}
//                   {"type":"unsubscribe","channels":[...]}
// Server -> client: {"type":"quote"|"article"|"prediction"|"alert", ...}

import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { EventBus } from "../events.js";
import type { LiveMarketService } from "../market/LiveMarketService.js";

interface Client {
  ws: WebSocket;
  channels: Set<string>;
  deviceId: string | null;
  alive: boolean;
}

export class WebSocketHub {
  private clients = new Set<Client>();

  constructor(server: Server, private bus: EventBus, private market: LiveMarketService, accessToken = "") {
    const wss = new WebSocketServer({
      server,
      path: "/ws",
      // same access code as the REST API, passed as ?token= (browsers can't set WebSocket headers)
      verifyClient: (info: { req: { url?: string } }) =>
        !accessToken || new URL(info.req.url ?? "", "http://x").searchParams.get("token") === accessToken,
    });
    wss.on("connection", (ws) => this.onConnection(ws));

    setInterval(() => {
      for (const c of this.clients) {
        if (!c.alive) {
          c.ws.terminate();
          continue;
        }
        c.alive = false;
        c.ws.ping();
      }
    }, 30_000);

    bus.on("quote", (q) => this.broadcast(`quotes:${q.symbol}`, { type: "quote", data: q }));
    const onArticle = (event: "new" | "analyzed") => (a: any) => {
      const msg = { type: "article", event, data: a };
      const symbols = new Set<string>(a.relations.map((r: any) => r.symbol));
      const sent = new Set<Client>();
      for (const c of this.clients) {
        const wants =
          c.channels.has("news:all") ||
          (a.analysis?.impact === "high" && c.channels.has("news:high-impact")) ||
          [...symbols].some((s) => c.channels.has(`news:${s}`));
        if (wants && !sent.has(c)) {
          sent.add(c);
          this.send(c, msg);
        }
      }
    };
    bus.on("article:new", onArticle("new"));
    bus.on("article:analyzed", onArticle("analyzed"));
    bus.on("prediction", (p) => {
      this.broadcast(`predictions:${p.symbol}`, { type: "prediction", data: p });
      this.broadcast("predictions:all", { type: "prediction", data: p });
    });
    bus.on("alert", (a) => {
      for (const c of this.clients) if (c.deviceId === a.deviceId && c.channels.has("alerts")) this.send(c, { type: "alert", data: a });
    });
  }

  get connectionCount() {
    return this.clients.size;
  }

  private onConnection(ws: WebSocket) {
    const client: Client = { ws, channels: new Set(), deviceId: null, alive: true };
    this.clients.add(client);
    ws.on("pong", () => (client.alive = true));
    ws.on("message", (buf) => {
      let msg: any;
      try {
        msg = JSON.parse(buf.toString());
      } catch {
        return;
      }
      if (typeof msg.deviceId === "string") client.deviceId = msg.deviceId.slice(0, 100);
      const channels: string[] = Array.isArray(msg.channels) ? msg.channels.filter((c: unknown) => typeof c === "string").slice(0, 100) : [];
      if (msg.type === "subscribe") {
        for (const ch of channels) {
          if (client.channels.has(ch)) continue;
          client.channels.add(ch);
          if (ch.startsWith("quotes:")) {
            const symbol = ch.slice(7).toUpperCase();
            this.market.subscribe(symbol);
            const q = this.market.getQuote(symbol);
            if ("price" in q) this.send(client, { type: "quote", data: q });
          }
        }
      } else if (msg.type === "unsubscribe") {
        for (const ch of channels) this.drop(client, ch);
      }
    });
    ws.on("close", () => {
      for (const ch of [...client.channels]) this.drop(client, ch);
      this.clients.delete(client);
    });
    this.send(client, { type: "hello", serverTime: Date.now() });
  }

  private drop(c: Client, ch: string) {
    if (!c.channels.delete(ch)) return;
    if (ch.startsWith("quotes:")) this.market.unsubscribe(ch.slice(7));
  }

  private broadcast(channel: string, msg: unknown) {
    for (const c of this.clients) if (c.channels.has(channel)) this.send(c, msg);
  }

  private send(c: Client, msg: unknown) {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
  }
}
