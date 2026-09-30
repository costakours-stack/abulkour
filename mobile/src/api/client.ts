import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiUrl, getAccessToken } from "../config";
import type {
  AnalystBrief,
  TopPicksResponse,
  PaperSnapshot,
  ImpactCalibration,
  ModelRecord,
  NewsMomentum,
  AlertEvent,
  AlertPrefs,
  Article,
  AssetOverview,
  Candle,
  Dashboard,
  Performance,
  Prediction,
  PredictionTrace,
} from "./types";

const WATCHLIST_KEY = "abulkour.watchlist";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Listeners told when the server looks asleep (free hosting spins down when idle) and when it answers again. */
const wakeListeners = new Set<(waking: boolean) => void>();
export function onServerWaking(l: (waking: boolean) => void) {
  wakeListeners.add(l);
  return () => {
    wakeListeners.delete(l);
  };
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  // A sleeping free-tier server takes up to ~60s to start: keep retrying gateway errors
  // and dropped connections for up to 90s before giving up.
  const deadline = Date.now() + 90_000;
  let waking = false;
  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(`${apiUrl()}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", "x-app-token": getAccessToken(), ...(init?.headers ?? {}) },
      });
    } catch (e) {
      if (Date.now() > deadline) throw e;
    }
    if (res && ![502, 503, 504].includes(res.status)) {
      if (waking) wakeListeners.forEach((l) => l(false));
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          msg = (await res.json()).error ?? msg;
        } catch {}
        throw new Error(msg);
      }
      return res.status === 204 ? (undefined as T) : res.json();
    }
    if (Date.now() > deadline) throw new Error("The Abulkour server did not respond. Check your connection and try again.");
    if (!waking && attempt >= 1) {
      waking = true;
      wakeListeners.forEach((l) => l(true));
    }
    await sleep(Math.min(8000, 1500 * (attempt + 1)));
  }
}

const qs = (params: Record<string, string | number | undefined | null>) => {
  const s = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return s ? `?${s}` : "";
};

export interface NewsQuery {
  symbol?: string;
  sentiment?: string;
  category?: string;
  since?: string;
  source?: string;
  sector?: string;
  assetType?: string;
  impact?: string;
  minRelevance?: number;
  sort?: "newest" | "relevance";
  tab?: string;
  relation?: string;
  limit?: number;
  before?: number;
}

export const api = {
  dashboard: (deviceId: string) => req<Dashboard>(`/dashboard${qs({ deviceId })}`),
  status: () => req<any>("/status"),

  searchAssets: (q: string) => req<{ symbol: string; name: string; type: string }[]>(`/assets/search${qs({ q })}`),
  asset: (symbol: string) => req<AssetOverview>(`/assets/${encodeURIComponent(symbol)}`),
  candles: (symbol: string, range: string, warmup = 0) =>
    req<{ candles: Candle[]; available: boolean; reason?: string; resolution: string; provider?: string; displayFrom?: number }>(
      `/assets/${encodeURIComponent(symbol)}/candles${qs({ range, warmup })}`,
    ),
  fundamentals: (symbol: string) => req<any>(`/assets/${encodeURIComponent(symbol)}/fundamentals`),
  assetNews: (symbol: string, q: NewsQuery) => req<Article[]>(`/assets/${encodeURIComponent(symbol)}/news${qs({ ...q })}`),
  predictions: (symbol: string) =>
    req<{
      latest: Prediction | null;
      history: Prediction[];
      performance: Performance[];
      modelRecord: ModelRecord | null;
      modelRecords: { horizon: number; version: string; symbol: { n: number; hitRate: number; baselineHitRate: number } | null; overall: ModelRecord["overall"] & { bandCoverage?: number } }[];
      newsImpact: ImpactCalibration;
      disclaimer: string;
    }>(
      `/assets/${encodeURIComponent(symbol)}/predictions`,
    ),
  requestPrediction: (symbol: string) => req<Prediction>(`/assets/${encodeURIComponent(symbol)}/predictions`, { method: "POST" }),
  brief: (symbol: string, force = false) =>
    req<{ available: boolean; reason?: string; brief?: AnalystBrief }>(`/assets/${encodeURIComponent(symbol)}/brief${qs({ force: force ? 1 : undefined })}`),
  newsMomentum: (symbol: string) => req<NewsMomentum>(`/assets/${encodeURIComponent(symbol)}/news-momentum`),
  sparklines: (symbols: string[]) => req<Record<string, number[]>>(`/sparklines${qs({ symbols: symbols.join(",") })}`),
  model: () => req<any>("/model"),
  topPicks: () => req<TopPicksResponse>("/top-picks"),
  paper: () => req<PaperSnapshot>("/paper"),
  rescan: () => req<any>("/top-picks/scan", { method: "POST" }),
  train: () => req<any>("/model/train", { method: "POST" }),
  predictionTrace: (id: string) => req<PredictionTrace>(`/predictions/${encodeURIComponent(id)}`),

  news: (q: NewsQuery) => req<Article[]>(`/news${qs({ ...q })}`),
  newsMeta: () => req<{ sources: string[]; sectors: string[]; categories: string[]; etfs: string[] }>("/news/meta"),
  searchNews: (q: string, f: NewsQuery = {}) =>
    req<{ query: string; relatedAssets: { symbol: string; name: string; type: string | null }[]; articles: Article[] }>(
      `/news/search${qs({ q, ...f })}`,
    ),
  article: (id: string) => req<Article>(`/news/${encodeURIComponent(id)}`),

  watchlist: (deviceId: string) => req<string[]>(`/watchlist${qs({ deviceId })}`),
  /** Saves on the server and on the phone (the phone copy survives server resets). */
  setWatchlist: (deviceId: string, symbols: string[]) =>
    req<string[]>("/watchlist", { method: "PUT", body: JSON.stringify({ deviceId, symbols }) }).then((list) => {
      AsyncStorage.setItem(WATCHLIST_KEY, JSON.stringify(list)).catch(() => {});
      return list;
    }),
  /** Push the phone's saved watchlist to the server (after a server reset it would otherwise fall back to defaults). */
  restoreWatchlist: async (deviceId: string) => {
    const saved = await AsyncStorage.getItem(WATCHLIST_KEY).catch(() => null);
    if (!saved) return;
    await req<string[]>("/watchlist", { method: "PUT", body: JSON.stringify({ deviceId, symbols: JSON.parse(saved) }) }).catch(() => {});
  },

  registerDevice: (deviceId: string, pushToken: string | null, notificationsEnabled: boolean) =>
    req<any>("/devices", { method: "POST", body: JSON.stringify({ deviceId, pushToken, notificationsEnabled }) }),
  alertPrefs: (deviceId: string) =>
    req<{ device: { notificationsEnabled: boolean } | null; prefs: AlertPrefs[] }>(`/alerts/prefs${qs({ deviceId })}`),
  setAlertPrefs: (deviceId: string, p: AlertPrefs) =>
    req<AlertPrefs[]>("/alerts/prefs", { method: "PUT", body: JSON.stringify({ deviceId, ...p }) }),
  alertHistory: (deviceId: string) => req<AlertEvent[]>(`/alerts/history${qs({ deviceId })}`),
};
