import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNavigation } from "@react-navigation/native";
import { useEffect, useMemo, useState } from "react";
import { type LayoutChangeEvent, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Line, Path } from "react-native-svg";
import { api } from "../api/client";
import type { PaperSession, PaperSnapshot } from "../api/types";
import { Card, Empty, ErrorText, Icon, Label, Loading, Section, Stat, StatGrid, SymbolBadge } from "../components/ui";
import { ago, clock, pct, price } from "../format";
import { useAsync, useWide } from "../hooks";
import { changeColor, colors, radius, space, type } from "../theme";

const HISTORY_KEY = "abulkour.paperHistory";
const money = (x: number) => `${x < 0 ? "-" : ""}$${Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signedMoney = (x: number) => `${x > 0 ? "+" : ""}${money(x)}`;

/** Equity vs "just hold the S&P 500" over the session. */
function EquityChart({ s }: { s: PaperSession }) {
  const [w, setW] = useState(0);
  const H = 170;
  const pts = s.equityCurve;
  if (pts.length < 2) return <Empty text="The equity curve starts after the first trading cycles." icon="analytics-outline" />;
  const vals = pts.flatMap((p) => [p.equity, p.spyEquity ?? p.equity]).concat(s.startEquity);
  const min = Math.min(...vals), max = Math.max(...vals);
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * (w - 4) + 2;
  const y = (v: number) => 6 + (1 - (v - min) / (max - min || 1)) * (H - 12);
  const path = (key: "equity" | "spyEquity") =>
    pts.filter((p) => p[key] != null).map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p[key]!).toFixed(1)}`).join("");
  return (
    <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && (
        <Svg width={w} height={H}>
          <Line x1={0} x2={w} y1={y(s.startEquity)} y2={y(s.startEquity)} stroke={colors.borderStrong} strokeDasharray="4,4" />
          <Path d={path("spyEquity")} stroke="#F5A524" strokeWidth={1.5} fill="none" strokeDasharray="5,3" />
          <Path d={path("equity")} stroke={s.pnl >= 0 ? colors.up : colors.down} strokeWidth={2.4} fill="none" />
        </Svg>
      )}
      <View style={styles.legend}>
        <View style={[styles.legendDot, { backgroundColor: s.pnl >= 0 ? colors.up : colors.down }]} />
        <Text style={styles.legendText}>AI trader</Text>
        <View style={[styles.legendDot, { backgroundColor: "#F5A524" }]} />
        <Text style={styles.legendText}>Holding the S&P 500 (SPY) with the same $10,000</Text>
      </View>
    </View>
  );
}

/** Virtual-money simulation of the AI trading on its own from open to close. */
export function TraderScreen() {
  const nav = useNavigation<any>();
  const wide = useWide();
  const { data, loading, error, reload } = useAsync<PaperSnapshot>(() => api.paper(), []);
  const [saved, setSaved] = useState<PaperSnapshot["history"]>([]);

  // refresh every minute while the AI is trading
  useEffect(() => {
    if (!data?.tradingWindow) return;
    const t = setInterval(reload, 60_000);
    return () => clearInterval(t);
  }, [data?.tradingWindow, reload]);

  // Keep finished days on the phone: the free server forgets them when it restarts.
  useEffect(() => {
    let alive = true;
    (async () => {
      const raw = await AsyncStorage.getItem(HISTORY_KEY).catch(() => null);
      const local: PaperSnapshot["history"] = raw ? JSON.parse(raw) : [];
      const merged = new Map(local.map((h) => [h.date, h]));
      for (const h of data?.history ?? []) merged.set(h.date, h);
      const list = [...merged.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 120);
      if (data?.history?.length) await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(list)).catch(() => {});
      if (alive) setSaved(list);
    })();
    return () => {
      alive = false;
    };
  }, [data]);

  const s = data?.current ?? null;
  const total = useMemo(() => {
    if (!saved.length) return null;
    const pnl = saved.reduce((a, h) => a + h.pnl, 0);
    const spy = saved.filter((h) => h.spyPct != null).reduce((a, h) => a + (h.spyPct! / 100) * 10_000, 0);
    return { days: saved.length, pnl, spy, upDays: saved.filter((h) => h.pnl > 0).length, beatSpy: saved.filter((h) => h.spyPct != null && h.pnlPct > h.spyPct).length };
  }, [saved]);

  const status = !data
    ? null
    : data.tradingWindow
      ? { label: "AI IS TRADING", color: colors.up, bg: colors.upSoft }
      : data.marketOpen
        ? { label: "MARKET OPEN · WAITING", color: colors.delayed, bg: colors.delayedSoft }
        : { label: "MARKET CLOSED", color: colors.muted, bg: colors.neutralSoft };

  const hero = s && (
    <Card style={{ borderColor: s.pnl >= 0 ? "#123D2B" : "#4A1A1E" }}>
      <View style={styles.heroTop}>
        <Label>{s.status === "trading" ? `TODAY · ${s.date}` : `LAST SESSION · ${s.date}`}</Label>
        {status && (
          <View style={[styles.pill, { backgroundColor: status.bg }]}>
            {data?.tradingWindow && <View style={[styles.dot, { backgroundColor: status.color }]} />}
            <Text style={[styles.pillText, { color: status.color }]}>{status.label}</Text>
          </View>
        )}
      </View>
      <Text style={[styles.equity, type.num]}>{money(s.equity)}</Text>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <Text style={[styles.pnl, { color: changeColor(s.pnl) }, type.num]}>
          {s.pnl >= 0 ? "Profit " : "Loss "}
          {signedMoney(s.pnl)} ({pct(s.pnlPct)})
        </Text>
        {s.spyPct != null && (
          <Text style={styles.vs}>
            vs S&P 500 {pct(s.spyPct)} ·{" "}
            <Text style={{ color: s.pnlPct >= s.spyPct ? colors.up : colors.down, fontWeight: "700" }}>
              {s.pnlPct >= s.spyPct ? "beating" : "trailing"} the market
            </Text>
          </Text>
        )}
      </View>
      <Text style={styles.faint}>
        Started with {money(s.startEquity)} at {clock(s.startedAt)}
        {s.endedAt ? ` · closed ${clock(s.endedAt)}` : data?.lastRunAt ? ` · last decision ${ago(data.lastRunAt)}` : ""}
      </Text>
      <View style={{ marginTop: space.md }}>
        <EquityChart s={s} />
      </View>
    </Card>
  );

  const stats = s && (
    <Section title="SESSION STATS" icon="stats-chart-outline" style={wide ? { marginTop: 0 } : undefined}>
      <StatGrid>
        <Stat label="Cash" value={money(s.cash)} />
        <Stat label="Invested" value={money(s.equity - s.cash)} />
        <Stat label="Trades" value={String(s.trades)} hint={`${s.closedTrades} closed`} />
        <Stat label="Win rate" value={s.winRate == null ? "—" : `${(s.winRate * 100).toFixed(0)}%`} hint="closed trades in profit" />
        <Stat label="Best trade" value={s.best == null ? "—" : signedMoney(s.best)} color={colors.up} />
        <Stat label="Worst trade" value={s.worst == null ? "—" : signedMoney(s.worst)} color={colors.down} />
        <Stat label="Trading costs" value={money(s.slippageCost)} hint="simulated spread / slippage" />
      </StatGrid>
    </Section>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.body} refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} tintColor={colors.accent} />}>
        <Text style={styles.h1}>AI Trader</Text>
        <Text style={styles.sub}>The AI trades $10,000 of virtual money on its own, from the open to the close. Simulation only — no real money or orders.</Text>

        {error && <ErrorText text={error} />}
        {loading && !data ? (
          <Loading />
        ) : !s ? (
          <Card style={{ marginTop: space.lg }}>
            <Empty
              text={
                data?.marketOpen
                  ? "The market is open — the AI starts its first trades at 9:35 New York time. Pull down to refresh."
                  : "No session yet. The AI starts trading at the next market open (9:35 New York time)."
              }
              icon="hourglass-outline"
            />
          </Card>
        ) : (
          <>
            <View style={[{ marginTop: space.lg }, wide && styles.cols]}>
              <View style={wide ? { flex: 1.5 } : undefined}>{hero}</View>
              <View style={wide ? { flex: 1 } : undefined}>{stats}</View>
            </View>

            <Section title={`OPEN POSITIONS (${s.positions.length})`} icon="briefcase-outline">
              {s.positions.length ? (
                <Card style={{ padding: 0 }}>
                  {s.positions.map((p, i) => (
                    <Pressable key={p.symbol} onPress={() => nav.push("Asset", { symbol: p.symbol })} style={[styles.row, i < s.positions.length - 1 && styles.divider]}>
                      <SymbolBadge symbol={p.symbol} size={34} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.sym}>{p.symbol}</Text>
                        <Text style={styles.faint}>
                          {p.qty} sh @ {price(p.entryPrice)} · bought {clock(p.entryAt)}
                        </Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={[styles.val, type.num]}>{money(p.value)}</Text>
                        <Text style={[styles.small, { color: changeColor(p.pnl) }, type.num]}>
                          {signedMoney(p.pnl)} ({pct(p.pnlPct)})
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </Card>
              ) : (
                <Empty text={s.status === "closed" ? "All positions were closed at the end of the day." : "No open positions — the AI is in cash."} icon="wallet-outline" />
              )}
            </Section>

            <Section title={`TRADE LOG (${s.tradeLog.length})`} icon="receipt-outline">
              {s.tradeLog.length ? (
                <Card style={{ padding: 0 }}>
                  {s.tradeLog.map((t, i) => (
                    <View key={t.id} style={[styles.trade, i < s.tradeLog.length - 1 && styles.divider]}>
                      <View style={[styles.side, { backgroundColor: t.side === "BUY" ? colors.accentSoft : colors.neutralSoft }]}>
                        <Text style={[styles.sideText, { color: t.side === "BUY" ? colors.accent : colors.text }]}>{t.side}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.tradeTitle}>
                          {t.symbol} · {t.qty} × {price(t.price)} = {money(t.value)}
                        </Text>
                        <Text style={styles.faint}>
                          {clock(t.at)} · {t.reason}
                        </Text>
                      </View>
                      {t.realizedPnl != null && (
                        <Text style={[styles.small, { color: changeColor(t.realizedPnl), fontWeight: "800" }, type.num]}>{signedMoney(t.realizedPnl)}</Text>
                      )}
                    </View>
                  ))}
                </Card>
              ) : (
                <Empty text="No trades yet today." icon="receipt-outline" />
              )}
            </Section>
          </>
        )}

        <Section title="PAST DAYS" icon="calendar-outline">
          {total && (
            <StatGrid>
              <Stat label={`Total over ${total.days} day${total.days > 1 ? "s" : ""}`} value={signedMoney(total.pnl)} color={changeColor(total.pnl)} hint="each day starts at $10,000" />
              <Stat label="S&P 500 same days" value={signedMoney(total.spy)} color={changeColor(total.spy)} hint="holding SPY with $10,000" />
              <Stat label="Profitable days" value={`${total.upDays}/${total.days}`} />
              <Stat label="Days beating S&P 500" value={`${total.beatSpy}/${total.days}`} />
            </StatGrid>
          )}
          {saved.length ? (
            <Card style={{ padding: 0, marginTop: space.sm }}>
              {saved.map((h, i) => (
                <View key={h.date} style={[styles.trade, i < saved.length - 1 && styles.divider]}>
                  <Text style={[styles.tradeTitle, { flex: 1 }]}>{h.date}</Text>
                  <Text style={[styles.small, { color: changeColor(h.pnl), fontWeight: "800", minWidth: 90, textAlign: "right" }, type.num]}>{signedMoney(h.pnl)}</Text>
                  <Text style={[styles.small, { color: changeColor(h.pnlPct), minWidth: 64, textAlign: "right" }]}>{pct(h.pnlPct)}</Text>
                  <Text style={[styles.faint, { minWidth: 86, textAlign: "right", marginTop: 0 }]}>SPY {h.spyPct == null ? "—" : pct(h.spyPct)}</Text>
                </View>
              ))}
            </Card>
          ) : (
            <Text style={styles.faint}>Finished days appear here (saved on your phone).</Text>
          )}
        </Section>

        {data && (
          <Section title="HOW THE AI TRADES" icon="book-outline">
            <Card>
              {[
                `Starts each trading day with $${data.rules.startingCash.toLocaleString()} of virtual cash.`,
                `Every ${Math.round(data.rules.intervalMs / 60000)} minutes it ranks ~40 stocks and ETFs by the AI's estimated return to the close.`,
                `Buys up to ${data.rules.maxPositions} of them when the estimate is at least +${data.rules.minEstPct}% and the chance of rising is at least ${(data.rules.minProbUp * 100).toFixed(0)}%, keeping ${(data.rules.cashReserve * 100).toFixed(0)}% in cash.`,
                `Sells at −${data.rules.stopLossPct}% (stop-loss), +${data.rules.takeProfitPct}% (take-profit), or when the AI’s estimate turns negative.`,
                "Closes everything at 3:55 PM New York time — no positions overnight.",
                `Every fill pays ${(data.rules.slippage * 100).toFixed(2)}% in simulated trading costs.`,
              ].map((line, i) => (
                <View key={i} style={styles.rule}>
                  <Icon name="checkmark-circle-outline" size={14} color={colors.accent} />
                  <Text style={styles.ruleText}>{line}</Text>
                </View>
              ))}
              <Text style={[styles.faint, { marginTop: space.md }]}>
                This is a simulation with virtual money, using real prices. The AI model has not shown an edge over simply holding the market in its
                tests, so expect results close to random, minus trading costs. Not financial advice.
              </Text>
              {data.lastError && <Text style={[styles.faint, { color: colors.down }]}>Last error: {data.lastError}</Text>}
            </Card>
          </Section>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, paddingBottom: 56, width: "100%", maxWidth: 1280, alignSelf: "center" },
  cols: { flexDirection: "row", gap: space.lg, alignItems: "flex-start" },
  h1: { color: colors.text, fontSize: 24, fontWeight: "800", letterSpacing: -0.4 },
  sub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  equity: { color: colors.text, fontSize: 36, fontWeight: "800", letterSpacing: -1, marginTop: 6 },
  pnl: { fontSize: 17, fontWeight: "800" },
  vs: { color: colors.muted, fontSize: 12 },
  faint: { color: colors.faint, fontSize: 11, marginTop: 4 },
  legend: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, flexWrap: "wrap" },
  legendDot: { width: 10, height: 3, borderRadius: 2 },
  legendText: { color: colors.faint, fontSize: 11, marginRight: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  sym: { color: colors.text, fontWeight: "800", fontSize: 15 },
  val: { color: colors.text, fontWeight: "700", fontSize: 14 },
  small: { fontSize: 12, fontWeight: "600" },
  trade: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: space.md, paddingVertical: 10 },
  side: { borderRadius: radius.sm, paddingHorizontal: 7, paddingVertical: 3, minWidth: 42, alignItems: "center" },
  sideText: { fontSize: 10, fontWeight: "800" },
  tradeTitle: { color: colors.text, fontSize: 13, fontWeight: "600" },
  rule: { flexDirection: "row", gap: 8, marginTop: 6, alignItems: "flex-start" },
  ruleText: { color: colors.text, fontSize: 13, lineHeight: 18, flex: 1 },
});
