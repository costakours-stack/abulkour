import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { useWindowDimensions } from "react-native";
import { realtime } from "./api/realtime";
import type { AnyQuote, Article, DataStatus, Prediction, Quote } from "./api/types";
import { hasPrice } from "./api/types";

/** True on desktop-width screens (web), where layouts switch to multiple columns. */
export function useWide(min = 1000) {
  return useWindowDimensions().width >= min;
}

/** Re-render every `ms` so relative times and staleness stay honest. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function useConnected() {
  const [c, setC] = useState(realtime.connected);
  useEffect(() => {
    const off = realtime.onConnectionChange(setC);
    return () => {
      off();
    };
  }, []);
  return c;
}

const STALE_MS = 2 * 60_000;

/**
 * The status to DISPLAY. Starts from the server's status and only ever
 * downgrades it: a LIVE quote that stops updating (or whose connection
 * dropped) is shown as DELAYED, never as LIVE.
 */
export function effectiveStatus(q: AnyQuote | null | undefined, now: number, connected: boolean): { status: DataStatus; reason: string } {
  if (!q) return { status: "DATA_UNAVAILABLE", reason: "No data." };
  if (!hasPrice(q)) return { status: "DATA_UNAVAILABLE", reason: q.statusReason };
  if (q.status !== "LIVE") return { status: q.status, reason: q.statusReason };
  if (!connected) return { status: "DELAYED", reason: "Live connection lost — price may be stale." };
  if (now - q.dataTimestamp > STALE_MS) return { status: "DELAYED", reason: "No recent trades — price may be stale." };
  return { status: "LIVE", reason: q.statusReason };
}

/** Live quotes for a set of symbols: REST seed, overridden by newer WebSocket pushes. */
export function useLiveQuotes(symbols: string[], seed?: Record<string, AnyQuote>) {
  const [live, setLive] = useState<Record<string, Quote>>({});
  const key = symbols.join(",");
  useEffect(() => {
    if (!key) return;
    const list = key.split(",");
    return realtime.subscribe(
      list.map((s) => `quotes:${s}`),
      (msg) => {
        if (msg.type === "quote" && list.includes(msg.data.symbol)) setLive((prev) => ({ ...prev, [msg.data.symbol]: msg.data as Quote }));
      },
    );
  }, [key]);
  return useMemo(() => {
    const out: Record<string, AnyQuote> = { ...(seed ?? {}) };
    for (const [s, q] of Object.entries(live)) {
      const cur = out[s];
      if (!hasPrice(cur) || q.dataTimestamp >= cur.dataTimestamp) out[s] = q;
    }
    return out;
  }, [seed, live]);
}

/** Keeps the latest value of a callback in a ref without writing to refs during render. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * Keeps a news list live: new/analyzed articles for `channel` are merged in
 * without a manual refresh. `accept` decides whether an article belongs in this view.
 */
export function useLiveNews(channel: string | null, initial: Article[], accept: (a: Article) => boolean = () => true) {
  // reset when the initial list changes (adjusting state during render, not in an effect)
  const [state, setState] = useState({ base: initial, items: initial });
  if (state.base !== initial) setState({ base: initial, items: initial });
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const acceptRef = useLatest(accept);

  useEffect(() => {
    if (!channel) return;
    return realtime.subscribe([channel], (msg) => {
      if (msg.type !== "article") return;
      const a = msg.data as Article;
      if (!acceptRef.current(a)) return;
      setState((st) => {
        const prev = st.items;
        const i = prev.findIndex((x) => x.id === a.id || x.clusterId === a.clusterId);
        let items: Article[];
        if (i >= 0) {
          // same article re-sent after analysis, or another outlet on the same event
          if (prev[i].id !== a.id) {
            const lead = { ...prev[i], alsoReportedBy: [...(prev[i].alsoReportedBy ?? []), { source: a.source, url: a.url }] };
            items = [...prev.slice(0, i), lead, ...prev.slice(i + 1)];
          } else {
            items = [...prev];
            items[i] = { ...a, alsoReportedBy: prev[i].alsoReportedBy };
          }
        } else {
          items = [a, ...prev].sort((x, y) => y.publishedAt - x.publishedAt);
        }
        return { ...st, items };
      });
      if (msg.event === "new") setFreshIds((s) => new Set(s).add(a.id));
    });
  }, [channel, acceptRef]);

  return { items: state.items, freshIds };
}

export function useLivePredictions(symbol: string, onPrediction: (p: Prediction) => void) {
  const cb = useLatest(onPrediction);
  useEffect(
    () =>
      realtime.subscribe([`predictions:${symbol}`], (msg) => {
        if (msg.type === "prediction" && msg.data.symbol === symbol) cb.current(msg.data);
      }),
    [symbol, cb],
  );
}

/**
 * Async loader keyed by `deps`. Results from an outdated request (deps changed
 * meanwhile) are ignored. `reload` re-runs it; `setData` lets live updates patch the data.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const key = JSON.stringify(deps);
  const fnRef = useLatest(fn);
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null; loading: boolean; nonce: number }>({
    key, data: null, error: null, loading: true, nonce: 0,
  });
  if (state.key !== key) setState({ key, data: null, error: null, loading: true, nonce: state.nonce });

  useEffect(() => {
    let current = true;
    fnRef
      .current()
      .then((data) => current && setState((s) => (s.key === key ? { ...s, data, error: null, loading: false } : s)))
      .catch((e: Error) => current && setState((s) => (s.key === key ? { ...s, error: e.message, loading: false } : s)));
    return () => {
      current = false;
    };
  }, [key, state.nonce, fnRef]);

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, nonce: s.nonce + 1 }));
  }, []);
  const setData = useCallback(
    (u: SetStateAction<T | null>) =>
      setState((s) => ({ ...s, data: typeof u === "function" ? (u as (p: T | null) => T | null)(s.data) : u })),
    [],
  );
  return { data: state.data, error: state.error, loading: state.loading, reload, setData };
}
