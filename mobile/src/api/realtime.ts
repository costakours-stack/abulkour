// Single shared WebSocket to the backend with reconnect and ref-counted channels.

import { onServerUrlChange, wsUrl } from "../config";

type Listener = (msg: any) => void;

class Realtime {
  private ws: WebSocket | null = null;
  private refs = new Map<string, number>();
  private listeners = new Set<Listener>();
  private backoff = 1000;
  private deviceId: string | null = null;
  private connectedListeners = new Set<(c: boolean) => void>();
  connected = false;

  constructor() {
    // reconnect to the new server when the user changes the address
    onServerUrlChange(() => {
      this.backoff = 1000;
      this.ws?.close();
    });
  }

  setDeviceId(id: string) {
    this.deviceId = id;
    this.sendSubscribe([...this.refs.keys()]);
  }

  private connect() {
    if (this.ws) return;
    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    ws.onopen = () => {
      this.backoff = 1000;
      this.setConnected(true);
      this.sendSubscribe([...this.refs.keys()]);
    };
    ws.onmessage = (e) => {
      let msg: any;
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      this.listeners.forEach((l) => l(msg));
    };
    ws.onclose = () => {
      this.ws = null;
      this.setConnected(false);
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 30_000);
    };
    ws.onerror = () => ws.close();
  }

  private setConnected(c: boolean) {
    this.connected = c;
    this.connectedListeners.forEach((l) => l(c));
  }

  onConnectionChange(l: (c: boolean) => void) {
    this.connectedListeners.add(l);
    return () => this.connectedListeners.delete(l);
  }

  private sendSubscribe(channels: string[]) {
    if (this.ws?.readyState === WebSocket.OPEN && channels.length)
      this.ws.send(JSON.stringify({ type: "subscribe", channels, deviceId: this.deviceId }));
  }

  /** Subscribe to channels and receive every server message. Returns a cleanup function. */
  subscribe(channels: string[], listener: Listener): () => void {
    this.connect();
    this.listeners.add(listener);
    const added: string[] = [];
    for (const ch of channels) {
      const n = (this.refs.get(ch) ?? 0) + 1;
      this.refs.set(ch, n);
      if (n === 1) added.push(ch);
    }
    this.sendSubscribe(added);
    return () => {
      this.listeners.delete(listener);
      const removed: string[] = [];
      for (const ch of channels) {
        const n = (this.refs.get(ch) ?? 1) - 1;
        if (n <= 0) {
          this.refs.delete(ch);
          removed.push(ch);
        } else this.refs.set(ch, n);
      }
      if (removed.length && this.ws?.readyState === WebSocket.OPEN)
        this.ws.send(JSON.stringify({ type: "unsubscribe", channels: removed }));
    };
  }
}

export const realtime = new Realtime();
