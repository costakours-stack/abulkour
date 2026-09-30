import { useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "../api/client";
import { Button, Card, Empty, Icon, Label, Loading, Section, Stat, StatGrid } from "../components/ui";
import { ago, dateTime } from "../format";
import { useAsync } from "../hooks";
import { changeColor, colors, radius, space } from "../theme";

/** The "brain" of the app: trained model, its honest track record, data coverage and training status. */
export function ModelScreen() {
  const { data, loading, reload } = useAsync(() => api.model(), []);
  const [err, setErr] = useState<string | null>(null);

  // poll while syncing/training
  useEffect(() => {
    if (!data?.training?.running && !data?.history?.syncing) return;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [data?.training?.running, data?.history?.syncing, reload]);

  if (loading && !data) return <View style={{ flex: 1, backgroundColor: colors.bg }}><Loading /></View>;
  const m = data?.active;
  const tr = data?.training;
  const hist = data?.history;
  const coverage = (hist?.symbols ?? []) as { symbol: string; firstDate: string; lastDate: string; bars: number }[];
  const earliest = coverage.reduce((min: string | null, s) => (!min || s.firstDate < min ? s.firstDate : min), null);
  const yr = (t: number) => new Date(t).getUTCFullYear();

  const train = async () => {
    setErr(null);
    try {
      await api.train();
      reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: 56 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={colors.accent} />}
    >
      <Card style={{ borderColor: "#2E2757" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={styles.iconWrap}>
            <Icon name="hardware-chip-outline" size={20} color={colors.ai} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{m ? m.version : "No trained model yet"}</Text>
            <Text style={styles.sub}>
              {m ? `Gradient-boosted trees · ${m.symbols.length} assets · ${yr(m.trainStart)}–${yr(m.trainEnd)} · ${m.dataSource}` : `Using ${data?.fallback} until training finishes`}
            </Text>
          </View>
        </View>

        {(tr?.running || hist?.syncing) && (
          <View style={{ marginTop: space.md }}>
            <Text style={styles.sub}>
              {hist?.syncing
                ? `Downloading price history ${hist.progress.done}/${hist.progress.total}${hist.progress.current ? ` · ${hist.progress.current}` : ""}`
                : `${tr.stage} · ${tr.pct}%`}
            </Text>
            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  { width: `${hist?.syncing ? (hist.progress.done / Math.max(1, hist.progress.total)) * 100 : tr.pct}%` },
                ]}
              />
            </View>
          </View>
        )}
        {tr?.error && <Text style={[styles.sub, { color: colors.down, marginTop: 8 }]}>Last training error: {tr.error}</Text>}
        {err && <Text style={[styles.sub, { color: colors.down, marginTop: 8 }]}>{err}</Text>}
        <View style={{ marginTop: space.md }}>
          <Button label={tr?.running || hist?.syncing ? "Working…" : "Sync data & retrain"} icon="refresh" variant="ai" busy={tr?.running || hist?.syncing} onPress={train} />
        </View>
      </Card>

      {m && (
        <Section title="OUT-OF-SAMPLE RESULTS" icon="ribbon-outline">
          <StatGrid>
            <Stat
              label="Direction hit rate"
              value={`${(m.metrics.overall.hitRate * 100).toFixed(1)}%`}
              hint={`always-up baseline ${(m.metrics.overall.baselineHitRate * 100).toFixed(1)}%`}
              color={changeColor(m.metrics.overall.hitRate - m.metrics.overall.baselineHitRate)}
            />
            <Stat label="Rank correlation (IC)" value={m.metrics.overall.ic.toFixed(3)} hint="predicted vs actual" />
            <Stat label="Mean abs. error" value={`${m.metrics.overall.maeReturnPct.toFixed(2)} pts`} hint="daily return" />
            <Stat label="Test days" value={m.metrics.overall.testRows.toLocaleString()} hint={`${m.metrics.folds.length} walk-forward periods`} />
          </StatGrid>
          <Text style={styles.note}>
            Walk-forward: each period is predicted by a model trained only on earlier data. Daily stock moves are mostly noise, so small edges
            over the baseline are normal. Large claimed edges would be a red flag.
          </Text>
          <Card style={{ marginTop: space.md, padding: 0 }}>
            {m.metrics.folds.map((f: any, i: number) => (
              <View key={f.label} style={[styles.foldRow, i < m.metrics.folds.length - 1 && styles.divider]}>
                <Text style={styles.foldLabel}>{f.label}</Text>
                <Text style={[styles.foldVal, { color: changeColor(f.hitRate - f.baselineHitRate) }]}>{(f.hitRate * 100).toFixed(1)}%</Text>
                <Text style={styles.foldBase}>base {(f.baselineHitRate * 100).toFixed(1)}%</Text>
                <Text style={styles.foldBase}>IC {f.ic.toFixed(3)}</Text>
              </View>
            ))}
          </Card>
        </Section>
      )}

      <Section title="PRICE HISTORY" icon="server-outline">
        <Card>
          <StatGrid>
            <Stat label="Source" value={hist?.source ?? "—"} />
            <Stat label="Earliest bar" value={earliest ?? "—"} />
            <Stat label="Assets" value={String(coverage.length)} />
            <Stat label="Total bars" value={coverage.reduce((s, c) => s + c.bars, 0).toLocaleString()} />
          </StatGrid>
          {hist?.source !== "tiingo" && (
            <View style={styles.tip}>
              <Icon name="information-circle" size={16} color={colors.delayed} />
              <Text style={styles.tipText}>
                Training uses {hist?.source === "polygon" ? "Polygon's 2-year" : "no"} history. Add a free TIINGO_API_KEY on the server to train on daily data back to 2000.
              </Text>
            </View>
          )}
        </Card>
      </Section>

      <Section title="NEWS → PRICE IMPACT" icon="newspaper-outline">
        <Card>
          <Text style={styles.body}>
            Each article’s sentiment, relevance and impact become an estimated next-session move for related stocks, scaled by each stock’s volatility.
          </Text>
          <StatGrid>
            <Stat label="Sensitivity k" value={data?.newsImpact?.k?.toFixed(2) ?? "—"} hint="vol-units per unit of signal" />
            <Stat
              label="Calibration"
              value={data?.newsImpact?.kFitted == null ? "Prior" : "Event study"}
              hint={`${data?.newsImpact?.sampleSize ?? 0} resolved reactions${data?.newsImpact?.fittedAt ? ` · ${ago(data.newsImpact.fittedAt)}` : ""}`}
            />
          </StatGrid>
        </Card>
      </Section>

      {data?.versions?.length > 1 && (
        <Section title="VERSIONS" icon="git-branch-outline">
          {data.versions.map((v: any) => (
            <Card key={v.version} style={{ marginBottom: space.sm }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={styles.title}>{v.version}</Text>
                {v.active && <Label color={colors.up}>ACTIVE</Label>}
              </View>
              <Text style={styles.sub}>
                {dateTime(v.createdAt)} · {v.dataSource} · hit {(v.overall.hitRate * 100).toFixed(1)}% vs {(v.overall.baselineHitRate * 100).toFixed(1)}%
              </Text>
            </Card>
          ))}
        </Section>
      )}
      {!m && !tr?.running && !hist?.syncing && <Empty text="Tap “Sync data & retrain” to build the model." icon="hardware-chip-outline" />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  iconWrap: { width: 38, height: 38, borderRadius: radius.md, backgroundColor: colors.aiSoft, alignItems: "center", justifyContent: "center" },
  title: { color: colors.text, fontSize: 15, fontWeight: "800" },
  sub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  body: { color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: space.md },
  note: { color: colors.faint, fontSize: 11, marginTop: 8, lineHeight: 16 },
  track: { height: 6, backgroundColor: colors.cardAlt, borderRadius: 3, marginTop: 6, overflow: "hidden" },
  fill: { height: 6, backgroundColor: colors.ai, borderRadius: 3 },
  foldRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingVertical: 10, gap: 10 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  foldLabel: { color: colors.text, fontWeight: "700", width: 70 },
  foldVal: { fontWeight: "800", width: 60 },
  foldBase: { color: colors.faint, fontSize: 12, flex: 1 },
  tip: { flexDirection: "row", gap: 8, backgroundColor: colors.delayedSoft, borderRadius: radius.md, padding: 10, marginTop: space.md },
  tipText: { color: colors.text, fontSize: 12, flex: 1, lineHeight: 17 },
});
