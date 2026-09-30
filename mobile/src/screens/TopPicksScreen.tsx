import { useNavigation } from "@react-navigation/native";
import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../api/client";
import type { TopPick } from "../api/types";
import { hasPrice } from "../api/types";
import { Sparkline } from "../components/Sparkline";
import { Button, Card, ChangePill, Empty, ErrorText, Icon, Label, Loading, Segmented, Stat, StatGrid, SymbolBadge } from "../components/ui";
import { featureLabel } from "../featureLabels";
import { ago, pct, price } from "../format";
import { useAsync, useWide } from "../hooks";
import { changeColor, colors, radius, space, type } from "../theme";

function PickCard({ p, onPress }: { p: TopPick; onPress: () => void }) {
  const q = hasPrice(p.quote) ? p.quote : null;
  const min = Math.min(p.lowPct, 0), max = Math.max(p.highPct, 0);
  const pos = (v: number) => `${((v - min) / (max - min || 1)) * 100}%` as const;
  return (
    <Card onPress={onPress} style={{ flex: 1 }}>
      <View style={styles.top}>
        <View style={styles.rank}>
          <Text style={styles.rankText}>{p.rank}</Text>
        </View>
        <SymbolBadge symbol={p.symbol} size={38} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={styles.symbol}>{p.symbol}</Text>
            <View style={styles.typeTag}>
              <Text style={styles.typeText}>{p.type.toUpperCase()}</Text>
            </View>
          </View>
          <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
        </View>
        <Sparkline values={p.spark} width={64} height={26} />
      </View>

      <View style={styles.estRow}>
        <View>
          <Label color={colors.ai}>EST. NEXT CLOSE</Label>
          <Text style={[styles.est, { color: changeColor(p.estPct) }, type.num]}>{pct(p.estPct)}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[styles.price, type.num]}>{price(q?.price ?? p.basePrice)}</Text>
          {q ? <ChangePill value={q.changePercent} size="sm" /> : <Text style={styles.faint}>last close</Text>}
        </View>
      </View>

      <View style={styles.rangeTrack}>
        <View style={[styles.rangeBand, { left: pos(p.lowPct), width: `${((p.highPct - p.lowPct) / (max - min || 1)) * 100}%` }]} />
        <View style={[styles.rangeZero, { left: pos(0) }]} />
        <View style={[styles.rangeMid, { left: pos(p.estPct) }]} />
      </View>
      <Text style={styles.faint}>
        80% likely range {pct(p.lowPct)} to {pct(p.highPct)} · P(up) {(p.probabilityUp * 100).toFixed(0)}%
      </Text>

      <View style={styles.grid}>
        <View style={styles.cell}>
          <Text style={styles.cellK}>Technical</Text>
          <Text style={[styles.cellV, { color: changeColor(p.technicalPct) }]}>{pct(p.technicalPct, 3)}</Text>
        </View>
        <View style={styles.cell}>
          <Text style={styles.cellK}>News</Text>
          <Text style={[styles.cellV, { color: changeColor(p.newsPct) }]}>{pct(p.newsPct)}</Text>
        </View>
        <View style={styles.cell}>
          <Text style={styles.cellK}>1 week</Text>
          <Text style={[styles.cellV, { color: changeColor(p.fc5Pct) }]}>{p.fc5Pct != null ? pct(p.fc5Pct) : "—"}</Text>
        </View>
        <View style={styles.cell}>
          <Text style={styles.cellK}>1 month</Text>
          <Text style={[styles.cellV, { color: changeColor(p.fc20Pct) }]}>{p.fc20Pct != null ? pct(p.fc20Pct) : "—"}</Text>
        </View>
      </View>

      {(p.drivers.length > 0 || p.newsEvents > 0) && (
        <View style={styles.chips}>
          {p.newsEvents > 0 && (
            <View style={styles.chip}>
              <Icon name="newspaper-outline" size={11} color={colors.muted} />
              <Text style={styles.chipText}>{p.newsEvents} related articles since close</Text>
            </View>
          )}
          {p.drivers.slice(0, 2).map((d) => (
            <View key={d.feature} style={styles.chip}>
              <Icon name={d.contributionPct >= 0 ? "arrow-up" : "arrow-down"} size={11} color={changeColor(d.contributionPct)} />
              <Text style={styles.chipText}>{featureLabel(d.feature).label}</Text>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

/** Top 10 stocks/ETFs by the model's estimated return to the next close, with an honest track record. */
export function TopPicksScreen() {
  const nav = useNavigation<any>();
  const wide = useWide();
  const { data, loading, error, reload } = useAsync(() => api.topPicks(), []);
  const [filter, setFilter] = useState<"all" | "stock" | "etf">("all");
  const [busy, setBusy] = useState(false);

  const rescan = async () => {
    setBusy(true);
    try {
      await api.rescan();
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const scan = data?.scan;
  const picks = (scan?.picks ?? []).filter((p) => filter === "all" || p.type === filter);
  const t = data?.track.summary;
  const m = data?.model;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top"]}>
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.body}
      refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} tintColor={colors.accent} />}
    >
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.h1}>AI Top Picks</Text>
          <Text style={styles.sub}>
            Highest model-estimated return to the next close
            {scan ? ` · ${scan.universeSize} stocks & ETFs scanned ${ago(scan.createdAt)}` : ""}
          </Text>
        </View>
        <View style={{ width: 130 }}>
          <Button label="Rescan" icon="refresh" variant="secondary" busy={busy} onPress={rescan} />
        </View>
      </View>

      {error && <ErrorText text={error} />}
      {loading && !data ? (
        <Loading />
      ) : (
        <>
          <Card style={{ borderColor: "#3A2F12", backgroundColor: "#15120A", marginTop: space.lg }}>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <Icon name="shield-checkmark-outline" size={16} color={colors.delayed} />
              <Text style={styles.honestTitle}>How much to trust this list</Text>
            </View>
            <Text style={styles.honestText}>
              {m
                ? `Out-of-sample, the 1-day model called direction right ${(m.hitRate * 100).toFixed(1)}% of the time vs ${(m.baselineHitRate * 100).toFixed(1)}% for always guessing “up” (trained on ${m.dataSource} data). `
                : "The model is still training. "}
              {t
                ? `Past lists averaged ${pct(t.picksAvgPct)} the next day vs ${pct(t.universeAvgPct)} for everything scanned, beating the field on ${(t.beatUniverseShare * 100).toFixed(0)}% of ${t.days} days.`
                : "The list’s own track record appears here as past scans resolve (from the next close onward)."}
            </Text>
            <Text style={styles.honestFoot}>{data?.disclaimer}</Text>
          </Card>

          <View style={{ marginTop: space.lg }}>
            <Segmented options={["all", "stock", "etf"] as const} value={filter} onChange={setFilter} labels={{ all: "All", stock: "Stocks", etf: "ETFs" }} />
          </View>

          {picks.length ? (
            <View style={[styles.list, wide && styles.listWide]}>
              {picks.map((p) => (
                <View key={p.symbol} style={wide ? styles.colWide : undefined}>
                  <PickCard p={p} onPress={() => nav.push("Asset", { symbol: p.symbol, tab: "AI" })} />
                </View>
              ))}
            </View>
          ) : (
            <Empty
              text={scan ? "The model doesn’t estimate a gain for any scanned asset right now." : "No scan yet. Tap Rescan."}
              icon="trending-up-outline"
            />
          )}

          {!!data?.track.scans.length && (
            <View style={{ marginTop: space.xl }}>
              <Label>PAST LISTS · NEXT-DAY RESULT</Label>
              <Card style={{ marginTop: space.sm, padding: 0 }}>
                <View style={[styles.tr, styles.trHead]}>
                  <Text style={[styles.td, { flex: 1.4 }]}>Scan</Text>
                  <Text style={styles.td}>Top picks</Text>
                  <Text style={styles.td}>All scanned</Text>
                  <Text style={styles.td}>Picks up</Text>
                </View>
                {data.track.scans.map((s) => (
                  <View key={s.scanId} style={styles.tr}>
                    <Text style={[styles.tdv, { flex: 1.4 }]}>{new Date(s.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</Text>
                    <Text style={[styles.tdv, { color: changeColor(s.picksAvgPct) }]}>{pct(s.picksAvgPct)}</Text>
                    <Text style={[styles.tdv, { color: changeColor(s.universeAvgPct) }]}>{pct(s.universeAvgPct)}</Text>
                    <Text style={styles.tdv}>{(s.picksUpShare * 100).toFixed(0)}%</Text>
                  </View>
                ))}
              </Card>
            </View>
          )}

          {t && (
            <View style={{ marginTop: space.lg }}>
              <StatGrid>
                <Stat label="Picks avg next day" value={pct(t.picksAvgPct)} color={changeColor(t.picksAvgPct)} />
                <Stat label="All scanned avg" value={pct(t.universeAvgPct)} color={changeColor(t.universeAvgPct)} />
                <Stat label="Days beating the field" value={`${(t.beatUniverseShare * 100).toFixed(0)}%`} hint={`${t.days} days`} />
              </StatGrid>
            </View>
          )}
          <Text style={styles.faint}>Scan model: {scan?.modelVersion ?? "—"}. Tap a pick for its chart, full forecast and news.</Text>
        </>
      )}
    </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, paddingBottom: 56, width: "100%", maxWidth: 1200, alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: space.md },
  h1: { color: colors.text, fontSize: 24, fontWeight: "800", letterSpacing: -0.4 },
  sub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  honestTitle: { color: colors.delayed, fontWeight: "800", fontSize: 13 },
  honestText: { color: colors.text, fontSize: 13, lineHeight: 19, marginTop: 6 },
  honestFoot: { color: colors.faint, fontSize: 11, marginTop: 6 },
  list: { gap: space.md, marginTop: space.md },
  listWide: { flexDirection: "row", flexWrap: "wrap" },
  colWide: { width: "49.3%" },
  top: { flexDirection: "row", alignItems: "center", gap: 10 },
  rank: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.aiSoft, alignItems: "center", justifyContent: "center" },
  rankText: { color: colors.ai, fontWeight: "800", fontSize: 12 },
  symbol: { color: colors.text, fontWeight: "800", fontSize: 16 },
  typeTag: { backgroundColor: colors.cardAlt, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  typeText: { color: colors.muted, fontSize: 9, fontWeight: "800" },
  name: { color: colors.muted, fontSize: 12, marginTop: 1 },
  estRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: space.md },
  est: { fontSize: 28, fontWeight: "800", letterSpacing: -0.6, marginTop: 2 },
  price: { color: colors.text, fontSize: 15, fontWeight: "700", marginBottom: 3 },
  faint: { color: colors.faint, fontSize: 11, marginTop: 6 },
  rangeTrack: { height: 6, backgroundColor: colors.cardAlt, borderRadius: 3, marginTop: space.md },
  rangeBand: { position: "absolute", top: 0, bottom: 0, backgroundColor: colors.aiSoft, borderRadius: 3 },
  rangeZero: { position: "absolute", top: -2, bottom: -2, width: 1, backgroundColor: colors.borderStrong },
  rangeMid: { position: "absolute", top: -2, width: 4, height: 10, marginLeft: -2, borderRadius: 2, backgroundColor: colors.up },
  grid: { flexDirection: "row", gap: 6, marginTop: space.md },
  cell: { flex: 1, backgroundColor: colors.cardAlt, borderRadius: radius.sm, padding: 8 },
  cellK: { color: colors.faint, fontSize: 10, fontWeight: "700" },
  cellV: { fontSize: 13, fontWeight: "800", marginTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: space.md },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.cardAlt, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { color: colors.muted, fontSize: 11 },
  tr: { flexDirection: "row", paddingHorizontal: space.lg, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  trHead: { backgroundColor: colors.cardAlt },
  td: { flex: 1, color: colors.faint, fontSize: 11, fontWeight: "700" },
  tdv: { flex: 1, color: colors.text, fontSize: 13, fontWeight: "600" },
});
