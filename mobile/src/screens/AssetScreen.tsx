import { useNavigation, useRoute } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "../api/client";
import type { Article, AssetOverview, Candle, ModelRecord, Prediction, Quote } from "../api/types";
import { hasPrice } from "../api/types";
import { BriefCard } from "../components/BriefCard";
import { LineChart } from "../components/LineChart";
import { NewsCard } from "../components/NewsCard";
import { PredictionCard, horizonsOf } from "../components/PredictionCard";
import { ProChart, type Projection } from "../components/ProChart";
import { TechnicalSummary } from "../components/TechnicalSummary";
import { periodStats } from "../indicators";
import { StatusBadge } from "../components/StatusBadge";
import {
  Button, Card, ChangePill, ChipRow, Empty, ErrorText, Icon, Label, Loading, Section, Segmented, Stat, StatGrid, SymbolBadge,
} from "../components/ui";
import { getDeviceId } from "../device";
import { compact, dateTime, pct, price, signed } from "../format";
import { useAsync, useLiveNews, useLivePredictions, useLiveQuotes, useWide } from "../hooks";
import { changeColor, colors, radius, space, type } from "../theme";

const TABS = ["Overview", "Chart", "AI", "News", "Fundamentals"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { Overview: "Overview", Chart: "Chart", AI: "AI Prediction", News: "News", Fundamentals: "Fundamentals" };

export function AssetScreen() {
  const route = useRoute<any>();
  const nav = useNavigation<any>();
  const symbol: string = String(route.params.symbol).toUpperCase();
  const [tab, setTab] = useState<Tab>(route.params.tab === "AI" ? "AI" : "Overview");
  const { data: asset, error, loading, reload } = useAsync(() => api.asset(symbol), [symbol]);
  const seed = useMemo(() => (asset ? { [symbol]: asset.quote } : undefined), [asset, symbol]);
  const quote = useLiveQuotes([symbol], seed)[symbol] ?? asset?.quote;

  useEffect(() => nav.setOptions({ title: symbol, headerRight: () => <WatchToggle symbol={symbol} /> }), [nav, symbol]);

  if (loading && !asset) return <View style={{ flex: 1, backgroundColor: colors.bg }}><Loading /></View>;
  const q = hasPrice(quote) ? quote : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.hero}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <SymbolBadge symbol={symbol} size={42} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>{asset?.name ?? symbol}</Text>
            <Text style={styles.sub}>
              {asset?.type === "etf" ? "ETF" : asset?.type === "stock" ? "Stock" : ""}
              {asset?.sector ? ` · ${asset.sector}` : ""}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, marginTop: space.md }}>
          <Text style={[styles.price, type.num]}>{q ? price(q.price) : "—"}</Text>
          {q && (
            <View style={{ gap: 3 }}>
              <ChangePill value={q.changePercent} />
              <Text style={[{ color: changeColor(q.change), fontSize: 12, fontWeight: "600" }, type.num]}>{signed(q.change)} today</Text>
            </View>
          )}
        </View>
        <View style={{ marginTop: space.sm }}>
          <StatusBadge quote={quote} detailed />
        </View>
        {error && <ErrorText text={error} />}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs} contentContainerStyle={{ paddingHorizontal: space.md, gap: 4 }}>
        {TABS.map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
            {t === "AI" && <Icon name="sparkles" size={13} color={tab === t ? colors.ai : colors.faint} />}
            <Text style={[styles.tabText, tab === t && { color: colors.text }]}>{TAB_LABELS[t]}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={{ flex: 1 }}>
        {tab === "Overview" && asset && <OverviewTab asset={asset} quote={q} onRefresh={reload} goTab={setTab} />}
        {tab === "Chart" && <ChartTab symbol={symbol} quote={q} />}
        {tab === "AI" && <PredictionTab symbol={symbol} />}
        {tab === "News" && <NewsTab symbol={symbol} isEtf={asset?.type === "etf"} />}
        {tab === "Fundamentals" && <FundamentalsTab symbol={symbol} asset={asset} />}
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ watchlist toggle

function WatchToggle({ symbol }: { symbol: string }) {
  const [list, setList] = useState<string[] | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  useEffect(() => {
    getDeviceId().then(async (id) => {
      setDeviceId(id);
      setList(await api.watchlist(id).catch(() => []));
    });
  }, []);
  if (!list || !deviceId) return null;
  const on = list.includes(symbol);
  const toggle = async () => {
    const next = on ? list.filter((s) => s !== symbol) : [...list, symbol];
    setList(await api.setWatchlist(deviceId, next).catch(() => list));
  };
  return (
    <Pressable onPress={toggle} hitSlop={10} style={{ paddingHorizontal: 6 }}>
      <Icon name={on ? "star" : "star-outline"} size={22} color={on ? colors.delayed : colors.muted} />
    </Pressable>
  );
}

// ------------------------------------------------------------------ overview

function OverviewTab({ asset, quote: q, onRefresh, goTab }: { asset: AssetOverview; quote: any; onRefresh: () => void; goTab: (t: Tab) => void }) {
  const nav = useNavigation<any>();
  const preds = useAsync(() => api.predictions(asset.symbol), [asset.symbol]);
  const news = useAsync(() => api.assetNews(asset.symbol, { limit: 3 }), [asset.symbol]);
  const momentum = useAsync(() => api.newsMomentum(asset.symbol), [asset.symbol]);
  const chart = useAsync(() => api.candles(asset.symbol, "1M"), [asset.symbol]);
  const na = "N/A on plan";
  const pts = (chart.data?.candles ?? []).map((c: Candle) => ({ t: c.t, v: c.c }));
  const m = momentum.data;
  const wide = useWide();

  const aiCol = (
    <>
      <Section title="AI OUTLOOK" icon="sparkles-outline" style={wide ? { marginTop: 0 } : undefined} right={<Pressable onPress={() => goTab("AI")}><Text style={styles.more}>Details</Text></Pressable>}>
        {preds.data?.latest ? (
          <PredictionCard p={preds.data.latest} onPress={() => goTab("AI")} />
        ) : (
          <Card>
            <Empty text="No prediction yet." icon="sparkles-outline" />
            <Button label="Generate prediction" icon="flash" onPress={() => goTab("AI")} />
          </Card>
        )}
      </Section>
      {m && m.articles24h > 0 && (
        <Section title="NEWS PRESSURE · 24H" icon="newspaper-outline">
          <StatGrid>
            <Stat label="Articles" value={String(m.articles24h)} hint={`${m.positive} positive · ${m.negative} negative`} />
            <Stat label="Est. news-driven move" value={pct(m.estMovePct)} color={changeColor(m.estMovePct)} hint="combined model estimate" />
          </StatGrid>
        </Section>
      )}
    </>
  );

  return (
    <ScrollView contentContainerStyle={styles.body} refreshControl={<RefreshControl refreshing={false} onRefresh={onRefresh} tintColor={colors.accent} />}>
     <View style={wide ? styles.cols : undefined}>
     <View style={wide ? { flex: 1.5 } : undefined}>
      <Card onPress={() => goTab("Chart")}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
          <Label>1 MONTH</Label>
          <Icon name="expand-outline" size={14} color={colors.faint} />
        </View>
        {pts.length > 1 ? <LineChart points={pts} height={wide ? 200 : 120} /> : <Empty text={chart.data?.reason ?? "Chart unavailable"} icon="analytics-outline" />}
      </Card>

      {!wide && aiCol}

      <Section title="KEY STATS" icon="stats-chart-outline">
        <StatGrid>
          <Stat label="Open" value={price(q?.open)} />
          <Stat label="Prev close" value={price(q?.previousClose)} />
          <Stat label="Day high" value={price(q?.high)} />
          <Stat label="Day low" value={price(q?.low)} />
          <Stat label="Volume" value={q?.volume != null ? compact(q.volume) : na} />
          <Stat label="Bid / Ask" value={q?.bid != null && q?.ask != null ? `${price(q.bid)} / ${price(q.ask)}` : na} />
        </StatGrid>
        <Text style={styles.note}>Source: {q ? `${q.provider}${q.delayMinutes ? ` (delayed ~${q.delayMinutes} min)` : ""}` : "—"}</Text>
      </Section>

      {asset.holdings && (
        <Section title={asset.holdings.source === "provider" ? "TOP HOLDINGS" : "MAJOR HOLDINGS"} icon="layers-outline">
          <Card style={{ padding: 0 }}>
            <Text style={[styles.note, { paddingHorizontal: space.lg, paddingTop: space.md }]}>{asset.holdings.note}</Text>
            {asset.holdings.items.slice(0, 12).map((h, i, arr) => (
              <Pressable key={h.symbol} onPress={() => nav.push("Asset", { symbol: h.symbol })} style={[styles.holding, i < arr.length - 1 && styles.divider]}>
                <SymbolBadge symbol={h.symbol} size={28} />
                <Text style={styles.holdingName} numberOfLines={1}>{h.name}</Text>
                <Text style={styles.holdingW}>{h.weightPct != null ? `${h.weightPct.toFixed(2)}%` : h.symbol}</Text>
              </Pressable>
            ))}
          </Card>
        </Section>
      )}

      <Section title="RECENT NEWS" icon="newspaper-outline" right={<Pressable onPress={() => goTab("News")}><Text style={styles.more}>All</Text></Pressable>}>
        {news.data?.length ? news.data.map((a) => <NewsCard key={a.id} article={a} focusSymbol={asset.symbol} />) : <Empty text="No recent news." />}
      </Section>
     </View>
     {wide && <View style={{ flex: 1 }}>{aiCol}</View>}
     </View>
    </ScrollView>
  );
}

// ------------------------------------------------------------------ chart

const RANGES = ["1D", "5D", "1M", "6M", "1Y", "5Y", "MAX"] as const;

function ChartTab({ symbol, quote }: { symbol: string; quote: Quote | null }) {
  const wide = useWide();
  const [range, setRange] = useState<(typeof RANGES)[number]>("6M");
  const intraday = range === "1D" || range === "5D";
  const { data, loading } = useAsync(() => api.candles(symbol, range, 260), [symbol, range]);
  const spy = useAsync(() => (symbol === "SPY" ? Promise.resolve(null) : api.candles("SPY", range, 0)), [symbol, range]);
  const preds = useAsync(() => api.predictions(symbol), [symbol]);
  // long history for the technical summary regardless of the visible range
  const longHist = useAsync(() => api.candles(symbol, "1Y", 260), [symbol]);

  // Daily bars end at the last completed session; add today's live candle from the real-time quote.
  const candles = useMemo(() => {
    const cs = data?.candles ?? [];
    const last = cs[cs.length - 1];
    if (!last || !quote || data?.resolution !== "1day" || intraday) return cs;
    const DAY = 86_400_000;
    if (quote.dataTimestamp < last.t + DAY) return cs;
    const t = quote.dataTimestamp - ((quote.dataTimestamp - last.t) % DAY);
    return [...cs, { t, o: quote.open ?? quote.price, h: Math.max(quote.high ?? quote.price, quote.price), l: Math.min(quote.low ?? quote.price, quote.price), c: quote.price, v: quote.volume ?? 0 }];
  }, [data, quote, intraday]);
  const visible = data?.displayFrom ? candles.filter((c) => c.t >= data.displayFrom!) : candles;
  const stats = periodStats(visible, intraday ? 252 * 78 : 252);
  const barDays = data?.resolution?.endsWith("day") ? Number(data.resolution.replace("day", "")) || 1 : 1;

  const latest = preds.data?.latest;
  const projection: Projection | null = latest
    ? {
        basePrice: latest.basePrice,
        points: horizonsOf(latest)
          .filter((h) => Number.isFinite(h.lo))
          .map((h) => ({ days: h.key === "1D" ? 1 : h.key === "1W" ? 5 : 20, pct: h.pct, lowPct: h.lo, highPct: h.hi })),
      }
    : null;
  const fmt = (t: number) =>
    intraday ? dateTime(t) : new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: range === "1M" || range === "6M" ? undefined : "2-digit" });

  const chart = (
    <Card>
      <Segmented options={RANGES} value={range} onChange={setRange} />
      <View style={{ marginTop: space.md }}>
        {loading ? (
          <ActivityIndicator color={colors.accent} style={{ height: 320 }} />
        ) : data?.available && candles.length > 1 ? (
          <ProChart
            key={`${symbol}-${range}`}
            candles={candles}
            displayFrom={data.displayFrom}
            intraday={intraday}
            barDays={barDays}
            projection={projection && projection.points.length ? projection : null}
            compare={spy.data?.candles ?? null}
            compareLabel="S&P 500 (SPY)"
            formatTime={fmt}
          />
        ) : (
          <Empty text={data?.reason ?? "Historical data unavailable for this range."} icon="analytics-outline" />
        )}
      </View>
      <Text style={styles.note}>
        Bars: {data?.provider ?? "—"} ({data?.resolution}). Tap or hover the chart for exact values. Daily history may be end-of-day.
      </Text>
    </Card>
  );

  const side = (
    <>
      {stats && (
        <Section title={`${range} STATISTICS`} icon="stats-chart-outline" style={wide ? { marginTop: 0 } : undefined}>
          <StatGrid>
            <Stat label="Change" value={pct(stats.changePct)} color={changeColor(stats.changePct)} />
            <Stat label="High / Low" value={`${price(stats.high)} / ${price(stats.low)}`} />
            <Stat label="Volatility (annualized)" value={`${stats.annualVolPct.toFixed(1)}%`} />
            <Stat label="Max drawdown" value={`${stats.maxDrawdownPct.toFixed(1)}%`} color={colors.down} />
            <Stat label="Up bars" value={`${stats.upDaysPct.toFixed(0)}%`} />
            <Stat label="Avg volume" value={compact(stats.avgVolume)} />
          </StatGrid>
        </Section>
      )}
      {longHist.data?.candles && longHist.data.candles.length > 60 && (
        <Section title="INDICATORS" icon="pulse-outline">
          <TechnicalSummary candles={longHist.data.candles} />
        </Section>
      )}
    </>
  );

  return (
    <ScrollView contentContainerStyle={styles.body}>
      {wide ? (
        <View style={styles.cols}>
          <View style={{ flex: 1.7 }}>{chart}</View>
          <View style={{ flex: 1 }}>{side}</View>
        </View>
      ) : (
        <>
          {chart}
          {side}
        </>
      )}
    </ScrollView>
  );
}

// ------------------------------------------------------------------ AI prediction

function FoldBars({ record }: { record: ModelRecord }) {
  const folds = record.folds.slice(-12);
  return (
    <View>
      <View style={styles.folds}>
        {folds.map((f) => {
          const edge = f.hitRate - f.baselineHitRate;
          const h = Math.max(4, Math.min(56, 28 + edge * 400));
          return (
            <View key={f.label} style={{ alignItems: "center", flex: 1 }}>
              <View style={{ height: 60, justifyContent: "flex-end" }}>
                <View style={{ width: 10, height: h, borderRadius: 3, backgroundColor: edge >= 0 ? colors.up : colors.down }} />
              </View>
              <Text style={styles.foldLabel}>{f.label.length > 4 ? f.label.slice(2) : `'${f.label.slice(2)}`}</Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.note}>Each bar: out-of-sample hit rate vs the “always up” baseline for that period (green = beat it).</Text>
    </View>
  );
}

function PredictionTab({ symbol }: { symbol: string }) {
  const nav = useNavigation<any>();
  const { data, loading, reload, setData } = useAsync(() => api.predictions(symbol), [symbol]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [updated, setUpdated] = useState<string | null>(null);

  useLivePredictions(
    symbol,
    useCallback(
      (p: Prediction) => {
        setData((d) => (d ? { ...d, latest: p, history: [p, ...d.history.filter((x) => x.id !== p.id)] } : d));
        setUpdated(`Updated: ${p.trigger}`);
      },
      [setData],
    ),
  );

  const generate = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.requestPrediction(symbol);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <Loading />;
  const rec = data?.modelRecord;
  const live = data?.performance ?? [];
  const yr = (t: number) => new Date(t).getUTCFullYear();

  return (
    <ScrollView contentContainerStyle={styles.body} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={colors.accent} />}>
      {updated && (
        <View style={styles.updated}>
          <Icon name="flash" size={13} color={colors.ai} />
          <Text style={styles.updatedText}>{updated}</Text>
        </View>
      )}

      {data?.latest ? (
        <PredictionCard p={data.latest} onPress={() => nav.push("PredictionTrace", { id: data.latest!.id })} />
      ) : (
        <Card>
          <Empty text="No prediction yet for this asset." icon="sparkles-outline" />
        </Card>
      )}
      <Button label="Recalculate now" icon="refresh" busy={busy} onPress={generate} />
      {err && <ErrorText text={err} />}

      <Section title="AI ANALYST" icon="sparkles-outline">
        <BriefCard symbol={symbol} />
      </Section>

      <Section title="MODEL TRACK RECORD" icon="ribbon-outline">
        {rec ? (
          <Card>
            <Text style={styles.cardTitle}>{rec.version}</Text>
            <Text style={styles.note}>
              Gradient-boosted trees · trained {yr(rec.trainStart)}–{yr(rec.trainEnd)} on {rec.dataSource} daily data · walk-forward tested
            </Text>
            <View style={{ marginTop: space.md }}>
              <StatGrid>
                <Stat
                  label={`Hit rate on ${symbol}`}
                  value={rec.symbol ? `${(rec.symbol.hitRate * 100).toFixed(1)}%` : "—"}
                  hint={rec.symbol ? `vs ${(rec.symbol.baselineHitRate * 100).toFixed(1)}% always-up · ${rec.symbol.n} days` : "not in training set"}
                  color={rec.symbol ? changeColor(rec.symbol.hitRate - rec.symbol.baselineHitRate) : undefined}
                />
                <Stat
                  label="Hit rate, all assets"
                  value={`${(rec.overall.hitRate * 100).toFixed(1)}%`}
                  hint={`vs ${(rec.overall.baselineHitRate * 100).toFixed(1)}% always-up`}
                  color={changeColor(rec.overall.hitRate - rec.overall.baselineHitRate)}
                />
                <Stat label="Rank correlation (IC)" value={rec.overall.ic.toFixed(3)} hint=">0.02 is meaningful for daily returns" />
                <Stat label="Mean abs. error" value={`${rec.overall.maeReturnPct.toFixed(2)} pts`} hint={`${rec.overall.testRows.toLocaleString()} test days`} />
              </StatGrid>
            </View>
            {(data?.modelRecords?.length ?? 0) > 1 && (
              <View style={{ marginTop: space.lg }}>
                <Label>BY FORECAST HORIZON (OUT-OF-SAMPLE)</Label>
                <View style={styles.hzTable}>
                  <View style={[styles.hzRow, { borderTopWidth: 0 }]}>
                    <Text style={[styles.hzHead, { flex: 1.2 }]}>Horizon</Text>
                    <Text style={styles.hzHead}>Hit rate</Text>
                    <Text style={styles.hzHead}>Always-up</Text>
                    <Text style={styles.hzHead}>IC</Text>
                    <Text style={styles.hzHead}>80% range held</Text>
                  </View>
                  {data!.modelRecords.map((r) => (
                    <View key={r.horizon} style={styles.hzRow}>
                      <Text style={[styles.hzCell, { flex: 1.2 }]}>{r.horizon === 1 ? "1 day" : r.horizon === 5 ? "1 week" : "1 month"}</Text>
                      <Text style={[styles.hzCell, { color: changeColor(r.overall.hitRate - r.overall.baselineHitRate) }]}>{(r.overall.hitRate * 100).toFixed(1)}%</Text>
                      <Text style={styles.hzCell}>{(r.overall.baselineHitRate * 100).toFixed(1)}%</Text>
                      <Text style={styles.hzCell}>{r.overall.ic.toFixed(3)}</Text>
                      <Text style={styles.hzCell}>{r.overall.bandCoverage != null ? `${(r.overall.bandCoverage * 100).toFixed(0)}%` : "—"}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
            <View style={{ marginTop: space.lg }}>
              <Label>BY TEST PERIOD</Label>
              <FoldBars record={rec} />
            </View>
            <View style={{ marginTop: space.md }}>
              <Label>WHAT THE MODEL LOOKS AT MOST</Label>
              <Text style={[styles.note, { color: colors.muted }]}>
                {rec.topFeatures.slice(0, 6).map((f) => `${f.name} ${(f.importance * 100).toFixed(0)}%`).join(" · ")}
              </Text>
            </View>
          </Card>
        ) : (
          <Card>
            <Empty text="The model is still training. Estimates use the baseline model until it finishes." icon="hourglass-outline" />
          </Card>
        )}
        {data?.newsImpact && (
          <Text style={styles.note}>
            News impact: k = {data.newsImpact.k.toFixed(2)} ·{" "}
            {data.newsImpact.kFitted === null ? "prior (not enough resolved news yet)" : `event study on ${data.newsImpact.sampleSize} article reactions`}
          </Text>
        )}
      </Section>

      <Section title="LIVE PREDICTIONS · RESOLVED" icon="checkmark-done-outline">
        {live.length ? (
          <StatGrid>
            {live.map((p) => (
              <Stat
                key={p.modelVersion}
                label={p.modelVersion}
                value={`${(p.directionHitRate * 100).toFixed(0)}% correct`}
                hint={`${p.resolvedCount} resolved · MAE ${p.meanAbsErrorPct.toFixed(2)} pts`}
              />
            ))}
          </StatGrid>
        ) : (
          <Text style={styles.note}>No resolved live predictions yet. Each is scored after its target close.</Text>
        )}
      </Section>

      <Section title="PREDICTION HISTORY" icon="git-commit-outline">
        <Text style={[styles.note, { marginTop: 0, marginBottom: space.sm }]}>Every version is kept, so you can see how the estimate changed as news arrived.</Text>
        {data?.history.length ? (
          data.history.slice(0, 30).map((p, i) => {
            const prev = data.history[i + 1];
            return (
              <Pressable key={p.id} onPress={() => nav.push("PredictionTrace", { id: p.id })} style={styles.timelineRow}>
                <View style={styles.timelineDot} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={styles.timelineTime}>{dateTime(p.predictionTimestamp)}</Text>
                    <Text style={[styles.timelineVal, { color: changeColor(p.predictedReturnPct) }, type.num]}>{pct(p.predictedReturnPct)}</Text>
                  </View>
                  <Text style={styles.note} numberOfLines={2}>
                    {prev ? `${pct(prev.predictedReturnPct)} → ${pct(p.predictedReturnPct)} · ` : ""}
                    {p.trigger}
                  </Text>
                  {p.outcome && (
                    <Text style={[styles.note, { color: p.outcome.directionCorrect ? colors.up : colors.down }]}>
                      Actual {pct(p.outcome.actualReturnPct)} · {p.outcome.directionCorrect ? "correct" : "wrong"}
                    </Text>
                  )}
                </View>
              </Pressable>
            );
          })
        ) : (
          <Empty text="No history yet." />
        )}
      </Section>
      <Text style={[styles.note, { marginTop: space.lg }]}>{data?.disclaimer}</Text>
    </ScrollView>
  );
}

// ------------------------------------------------------------------ news

const NEWS_TABS = ["latest", "positive", "negative", "analyst", "earnings", "company"] as const;
const NEWS_TAB_LABELS = { latest: "Latest", positive: "Positive", negative: "Negative", analyst: "Analyst", earnings: "Earnings", company: "Company" };
const RELATIONS = ["direct", "holding", "sector", "macro"] as const;
const RELATION_LABELS = { direct: "About this ETF", holding: "Via holdings", sector: "Sector", macro: "Macro" };

function NewsTab({ symbol, isEtf }: { symbol: string; isEtf: boolean }) {
  const [newsTab, setNewsTab] = useState<(typeof NEWS_TABS)[number]>("latest");
  const [sort, setSort] = useState<"newest" | "relevance">("newest");
  const [relation, setRelation] = useState<(typeof RELATIONS)[number] | null>(null);
  const { data, loading, reload, error } = useAsync(
    () => api.assetNews(symbol, { tab: newsTab, sort, relation: relation ?? undefined, limit: 60 }),
    [symbol, newsTab, sort, relation],
  );
  const initial = useMemo(() => data ?? [], [data]);
  const accept = useCallback(
    (a: Article) => {
      const rel = a.relations.find((r) => r.symbol === symbol);
      if (!rel) return false;
      if (!isEtf && rel.relation !== "direct") return false;
      if (relation && rel.relation !== relation) return false;
      if (newsTab === "positive" || newsTab === "negative") return a.analysis?.sentiment === newsTab;
      if (newsTab === "analyst" || newsTab === "earnings") return a.analysis?.category === newsTab;
      if (newsTab === "company") return rel.relation === "direct";
      return true;
    },
    [symbol, isEtf, relation, newsTab],
  );
  const live = useLiveNews(`news:${symbol}`, initial, accept);

  return (
    <ScrollView contentContainerStyle={styles.body} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={colors.accent} />}>
      <ChipRow options={NEWS_TABS} value={newsTab} onChange={(v) => setNewsTab(v ?? "latest")} labels={NEWS_TAB_LABELS} />
      <View style={{ marginTop: space.sm }}>
        <Segmented options={["newest", "relevance"] as const} value={sort} onChange={setSort} labels={{ newest: "Newest", relevance: "Most relevant" }} />
      </View>
      {isEtf && (
        <View style={{ marginTop: space.sm }}>
          <ChipRow options={RELATIONS} value={relation} onChange={setRelation} labels={RELATION_LABELS} />
          <Text style={styles.note}>Includes news about the fund, its major holdings, and relevant sector/macro news. Each card says how it’s related.</Text>
        </View>
      )}
      {error && <ErrorText text={error} />}
      <View style={{ marginTop: space.md }}>
        {live.items.length
          ? live.items.map((a) => <NewsCard key={a.id} article={a} focusSymbol={symbol} fresh={live.freshIds.has(a.id)} />)
          : !loading && <Empty text="No matching news." />}
      </View>
    </ScrollView>
  );
}

// ------------------------------------------------------------------ fundamentals

function FundamentalsTab({ symbol, asset }: { symbol: string; asset: AssetOverview | null }) {
  const { data, loading } = useAsync(() => api.fundamentals(symbol), [symbol]);
  if (loading) return <Loading />;
  if (!data?.available)
    return (
      <View style={styles.body}>
        <Empty text={data?.reason ?? (asset?.type === "etf" ? "Fundamentals aren't available for this ETF on the current data plan." : "Fundamentals unavailable.")} />
      </View>
    );
  const p = data.profile;
  const m = data.metrics;
  const n = (x: number | null | undefined, d = 2) => (x == null ? "—" : x.toFixed(d));
  return (
    <ScrollView contentContainerStyle={styles.body}>
      {p && (
        <Section title="COMPANY" icon="business-outline" style={{ marginTop: 0 }}>
          <StatGrid>
            <Stat label="Market cap" value={compact(p.marketCap)} />
            <Stat label="Exchange" value={p.exchange ?? "—"} />
            <Stat label="Industry" value={p.industry ?? "—"} />
            <Stat label="Country · IPO" value={`${p.country ?? "—"} · ${p.ipo ?? "—"}`} />
          </StatGrid>
        </Section>
      )}
      {m && (
        <Section title="VALUATION & QUALITY" icon="calculator-outline">
          <StatGrid>
            <Stat label="P/E (TTM)" value={n(m.peTTM)} />
            <Stat label="EPS (TTM)" value={n(m.epsTTM)} />
            <Stat label="Dividend yield" value={m.dividendYield != null ? `${n(m.dividendYield)}%` : "—"} />
            <Stat label="Beta" value={n(m.beta)} />
            <Stat label="52-week range" value={`${n(m.week52Low)} – ${n(m.week52High)}`} />
            <Stat label="Revenue growth" value={m.revenueGrowthTTM != null ? `${n(m.revenueGrowthTTM)}%` : "—"} color={changeColor(m.revenueGrowthTTM)} />
            <Stat label="Net margin" value={m.netMarginTTM != null ? `${n(m.netMarginTTM)}%` : "—"} />
          </StatGrid>
        </Section>
      )}
      <Text style={styles.note}>Source: {data.provider} · retrieved {m?.asOf ? dateTime(m.asOf) : "—"}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md },
  name: { color: colors.text, fontSize: 17, fontWeight: "700" },
  sub: { color: colors.muted, fontSize: 12, marginTop: 2, textTransform: "capitalize" },
  price: { color: colors.text, ...type.display },
  tabs: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  tab: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 11, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: colors.accent },
  tabText: { color: colors.faint, fontWeight: "700", fontSize: 14 },
  body: { padding: space.lg, paddingBottom: 56, width: "100%", maxWidth: 1280, alignSelf: "center" },
  cols: { flexDirection: "row", gap: space.lg, alignItems: "flex-start" },
  hzTable: { marginTop: 6, backgroundColor: colors.cardAlt, borderRadius: radius.md, overflow: "hidden" },
  hzRow: { flexDirection: "row", paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  hzHead: { flex: 1, color: colors.faint, fontSize: 10, fontWeight: "700" },
  hzCell: { flex: 1, color: colors.text, fontSize: 12, fontWeight: "600" },
  note: { color: colors.faint, fontSize: 11, marginTop: 8, lineHeight: 16 },
  more: { color: colors.accent, fontSize: 13, fontWeight: "700" },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: "800" },
  holding: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: 10 },
  holdingName: { color: colors.text, flex: 1, fontSize: 13 },
  holdingW: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  folds: { flexDirection: "row", alignItems: "flex-end", marginTop: 8, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 4 },
  foldLabel: { color: colors.faint, fontSize: 9, marginTop: 4 },
  updated: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.aiSoft, borderRadius: radius.md, padding: 10, marginBottom: space.sm },
  updatedText: { color: colors.ai, fontSize: 12, fontWeight: "700", flex: 1 },
  timelineRow: { flexDirection: "row", gap: 12, paddingVertical: 8, borderLeftWidth: 2, borderLeftColor: colors.border, marginLeft: 5, paddingLeft: 12 },
  timelineDot: { position: "absolute", left: -6, top: 12, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.ai },
  timelineTime: { color: colors.text, fontSize: 13, fontWeight: "600" },
  timelineVal: { fontSize: 14, fontWeight: "800" },
});
