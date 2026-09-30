import { useNavigation } from "@react-navigation/native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../api/client";
import { realtime } from "../api/realtime";
import type { AnyQuote, Dashboard } from "../api/types";
import { NewsCard } from "../components/NewsCard";
import { PredictionCard } from "../components/PredictionCard";
import { MarketTile, QuoteRow } from "../components/QuoteRow";
import { Card, ChangePill, Empty, ErrorText, Icon, Loading, Section, SymbolBadge } from "../components/ui";
import { getServerUrl } from "../config";
import { getDeviceId } from "../device";
import { useAsync, useConnected, useLiveNews, useLiveQuotes, useWide } from "../hooks";
import { colors, radius, space, type } from "../theme";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function HomeScreen() {
  const nav = useNavigation<any>();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  useEffect(() => {
    getDeviceId().then(setDeviceId);
  }, []);

  const { data, error, loading, reload, setData } = useAsync<Dashboard | null>(
    () => (deviceId ? api.dashboard(deviceId) : Promise.resolve(null)),
    [deviceId],
  );
  const connected = useConnected();
  const wide = useWide();
  const picks = useAsync(() => api.topPicks(), []);

  const symbols = useMemo(
    () => [...new Set([...(data?.markets.map((m) => m.symbol) ?? []), ...(data?.watchlist.map((w) => w.symbol) ?? [])])],
    [data],
  );
  const seed = useMemo(() => {
    const s: Record<string, AnyQuote> = {};
    data?.markets.forEach((m) => (s[m.symbol] = m.quote));
    data?.watchlist.forEach((w) => (s[w.symbol] = w.quote));
    return s;
  }, [data]);
  const quotes = useLiveQuotes(symbols, seed);

  const latestInit = useMemo(() => data?.latestNews ?? [], [data]);
  const highInit = useMemo(() => data?.highImpact ?? [], [data]);
  const latest = useLiveNews("news:all", latestInit);
  const high = useLiveNews("news:high-impact", highInit, (a) => a.analysis?.impact === "high");

  useEffect(
    () =>
      realtime.subscribe(["predictions:all"], (msg) => {
        if (msg.type === "prediction")
          setData((d) => (d ? { ...d, aiSignals: [msg.data, ...d.aiSignals.filter((p) => p.id !== msg.data.id)].slice(0, 10) } : d));
      }),
    [setData],
  );

  const ms = data?.marketStatus;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: 48, width: "100%", maxWidth: 1280, alignSelf: "center" }}
        refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} tintColor={colors.accent} />}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.greet}>{greeting()}</Text>
            <Text style={type.h1 as any}>
              <Text style={{ color: colors.text }}>Abul</Text>
              <Text style={{ color: colors.accent }}>kour</Text>
            </Text>
          </View>
          <Pressable onPress={() => nav.navigate("AI")} hitSlop={6} style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}>
            <Icon name="hardware-chip-outline" size={17} color={colors.ai} />
          </Pressable>
          <Pressable onPress={() => nav.navigate("Search")} style={({ pressed }) => [styles.searchBtn, wide && { width: 320 }, pressed && { opacity: 0.7 }]}>
            <Icon name="search" size={16} color={colors.faint} />
            {wide && <Text style={styles.searchText}>Search stocks & ETFs…</Text>}
          </Pressable>
          <View style={{ alignItems: "flex-end", gap: 6 }}>
            {ms && (
              <View style={[styles.marketPill, { backgroundColor: ms.isOpen ? colors.upSoft : colors.neutralSoft }]}>
                <View style={[styles.dot, { backgroundColor: ms.isOpen ? colors.up : colors.muted }]} />
                <Text style={[styles.marketPillText, { color: ms.isOpen ? colors.up : colors.muted }]}>
                  {ms.isOpen ? "MARKET OPEN" : ms.session === "pre-market" ? "PRE-MARKET" : ms.session === "post-market" ? "AFTER HOURS" : "MARKET CLOSED"}
                </Text>
              </View>
            )}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <View style={[styles.dot, { backgroundColor: connected ? colors.live : colors.delayed }]} />
              <Text style={styles.conn}>{connected ? "Live feed" : "Reconnecting"}</Text>
            </View>
          </View>
        </View>

        {error && (
          <ErrorText
            text={
              /access code|401/i.test(error)
                ? "Access code needed: open Alerts → Server address, paste the access code from Render and tap Save & test."
                : `Can’t reach Abulkour at ${getServerUrl()}. Check your internet connection, or Alerts → Server address.`
            }
          />
        )}
        {loading && !data ? (
          <Loading />
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingTop: space.lg }}>
              {data?.markets.map((m) => (
                <MarketTile
                  key={m.symbol}
                  label={m.label}
                  symbol={m.symbol}
                  note={m.note}
                  quote={quotes[m.symbol]}
                  spark={data.sparklines?.[m.symbol]}
                  onPress={() => nav.push("Asset", { symbol: m.symbol })}
                />
              ))}
            </ScrollView>

            <View style={wide ? styles.cols : undefined}>
            <View style={wide ? { flex: 1.25 } : undefined}>
            <Section title="WATCHLIST" icon="star-outline" right={<Pressable onPress={() => nav.navigate("Search")}><Icon name="add-circle-outline" size={20} color={colors.accent} /></Pressable>}>
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {data?.watchlist.length ? (
                  data.watchlist.map((w, i) => (
                    <QuoteRow
                      key={w.symbol}
                      symbol={w.symbol}
                      name={w.name}
                      quote={quotes[w.symbol]}
                      spark={data.sparklines?.[w.symbol]}
                      momentum={data.newsMomentum?.[w.symbol]}
                      last={i === data.watchlist.length - 1}
                      onPress={() => nav.push("Asset", { symbol: w.symbol })}
                    />
                  ))
                ) : (
                  <Empty text="Your watchlist is empty. Search for a stock or ETF to add it." icon="star-outline" />
                )}
              </Card>
            </Section>

            <Section title="AI SIGNALS" icon="sparkles-outline">
              {data?.aiSignals.length ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
                  {data.aiSignals.slice(0, 8).map((p) => (
                    <PredictionCard key={p.id} p={p} compact onPress={() => nav.push("Asset", { symbol: p.symbol, tab: "AI" })} />
                  ))}
                </ScrollView>
              ) : (
                <Empty text="No model signals yet. Open a stock and generate one." icon="sparkles-outline" />
              )}
              <Text style={styles.disclaimer}>Model estimates for the next close. Not advice.</Text>
            </Section>

            <Section
              title="AI TOP PICKS TODAY"
              icon="trophy-outline"
              right={
                <Pressable onPress={() => nav.navigate("Picks")}>
                  <Text style={styles.link}>See top 10</Text>
                </Pressable>
              }
            >
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {picks.data?.scan?.picks.length ? (
                  picks.data.scan.picks.slice(0, 3).map((p, i) => (
                    <Pressable
                      key={p.symbol}
                      onPress={() => nav.push("Asset", { symbol: p.symbol, tab: "AI" })}
                      style={({ pressed }) => [styles.pickRow, i < 2 && styles.divider, pressed && { backgroundColor: colors.cardAlt }]}
                    >
                      <Text style={styles.pickRank}>{p.rank}</Text>
                      <SymbolBadge symbol={p.symbol} size={30} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.pickSym}>{p.symbol}</Text>
                        <Text style={styles.pickName} numberOfLines={1}>
                          {p.name} · P(up) {(p.probabilityUp * 100).toFixed(0)}%
                        </Text>
                      </View>
                      <ChangePill value={p.estPct} />
                    </Pressable>
                  ))
                ) : (
                  <Empty text="No picks yet — the scanner runs after the model finishes training." icon="trophy-outline" />
                )}
              </Card>
              <Text style={styles.disclaimer}>Ranked by model-estimated return to the next close. Estimates, not recommendations.</Text>
            </Section>
            </View>

            <View style={wide ? { flex: 1 } : undefined}>
            {high.items.length > 0 && (
              <Section title="HIGH IMPACT" icon="flash-outline">
                {high.items.slice(0, 4).map((a) => (
                  <NewsCard key={a.id} article={a} fresh={high.freshIds.has(a.id)} />
                ))}
              </Section>
            )}

            <Section
              title="LATEST NEWS"
              icon="newspaper-outline"
              right={
                <Pressable onPress={() => nav.navigate("News")}>
                  <Text style={styles.link}>See all</Text>
                </Pressable>
              }
            >
              {latest.items.length ? (
                latest.items.slice(0, 8).map((a) => <NewsCard key={a.id} article={a} fresh={latest.freshIds.has(a.id)} />)
              ) : (
                <Empty text="No news yet." icon="newspaper-outline" />
              )}
            </Section>
            </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  greet: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  marketPill: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  marketPillText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  conn: { color: colors.faint, fontSize: 11 },
  disclaimer: { color: colors.faint, fontSize: 11, marginTop: 8 },
  link: { color: colors.accent, fontSize: 13, fontWeight: "700" },
  cols: { flexDirection: "row", gap: space.xl, alignItems: "flex-start" },
  iconBtn: { backgroundColor: colors.aiSoft, borderRadius: radius.pill, padding: 9, alignSelf: "center", marginLeft: "auto", marginRight: space.sm },
  searchBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 9, alignSelf: "center", marginRight: space.md },
  searchText: { color: colors.faint, fontSize: 13 },
  pickRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, paddingVertical: space.md },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pickRank: { color: colors.ai, fontWeight: "800", width: 16, textAlign: "center" },
  pickSym: { color: colors.text, fontWeight: "800", fontSize: 14 },
  pickName: { color: colors.muted, fontSize: 12, marginTop: 1 },
});
