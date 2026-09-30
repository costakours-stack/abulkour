import { StyleSheet, Text, View } from "react-native";
import type { Prediction } from "../api/types";
import { featureLabel } from "../featureLabels";
import { ago, clock, dateTime, pct, price } from "../format";
import { changeColor, colors, radius, space, type } from "../theme";
import { Card, ChangePill, Icon, Label, ProbabilityBar } from "./ui";

/** Horizontal split bar showing how much of the estimate comes from technicals vs news. */
function ComponentBar({ label, value, max }: { label: string; value: number; max: number }) {
  const w = Math.min(1, Math.abs(value) / (max || 1));
  return (
    <View style={{ marginTop: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={styles.compLabel}>{label}</Text>
        <Text style={[styles.compVal, { color: changeColor(value) }, type.num]}>{pct(value)}</Text>
      </View>
      <View style={styles.compTrack}>
        <View style={styles.compMid} />
        <View style={[styles.compFill, { width: `${w * 50}%`, backgroundColor: changeColor(value) }, value >= 0 ? { left: "50%" } : { right: "50%" }]} />
      </View>
    </View>
  );
}

/** Range bar: low..high with the estimate marked, zero line shown. */
function RangeBar({ lo, mid, hi }: { lo: number; mid: number; hi: number }) {
  const min = Math.min(lo, 0), max = Math.max(hi, 0);
  const pos = (v: number) => `${((v - min) / (max - min || 1)) * 100}%` as const;
  return (
    <View style={styles.rangeTrack}>
      <View style={[styles.rangeBand, { left: pos(lo), width: `${((hi - lo) / (max - min || 1)) * 100}%` }]} />
      <View style={[styles.rangeZero, { left: pos(0) }]} />
      <View style={[styles.rangeMid, { left: pos(mid), backgroundColor: changeColor(mid) }]} />
    </View>
  );
}

export function horizonsOf(p: Prediction) {
  const f = p.features;
  const out = [
    { key: "1D", label: "Next close", pct: p.predictedReturnPct, lo: f.interval_lo_pct, hi: f.interval_hi_pct, pUp: p.probabilityUp },
    { key: "1W", label: "5 trading days", pct: f.fc5_pct, lo: f.fc5_lo, hi: f.fc5_hi, pUp: f.fc5_pup },
    { key: "1M", label: "20 trading days", pct: f.fc20_pct, lo: f.fc20_lo, hi: f.fc20_hi, pUp: f.fc20_pup },
  ];
  return out.filter((h) => h.pct !== undefined && Number.isFinite(h.pct));
}

export function driversOf(p: Prediction) {
  return Object.entries(p.features)
    .filter(([k]) => k.startsWith("why_"))
    .map(([k, v]) => {
      const name = k.slice(4);
      return { name, contributionPct: v, ...featureLabel(name, p.features[`tech_${name}`]) };
    })
    .sort((a, b) => Math.abs(b.contributionPct) - Math.abs(a.contributionPct));
}

/** AI outlook: estimates for 3 horizons with likely ranges, P(up), breakdown, drivers and traceability. */
export function PredictionCard({ p, onPress, compact }: { p: Prediction; onPress?: () => void; compact?: boolean }) {
  const tech = p.features.component_technical_pct;
  const news = p.features.component_news_pct;
  const hasComponents = tech !== undefined && news !== undefined;
  const max = Math.max(Math.abs(tech ?? 0), Math.abs(news ?? 0), 0.25);
  const horizons = horizonsOf(p);
  const drivers = driversOf(p).slice(0, 5);

  if (compact) {
    return (
      <Card onPress={onPress} style={styles.compact}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={styles.symbol}>{p.symbol}</Text>
          <ChangePill value={p.predictedReturnPct} />
        </View>
        <Text style={styles.meta}>next close · P(up) {(p.probabilityUp * 100).toFixed(0)}%</Text>
        {hasComponents && (
          <Text style={styles.meta}>
            tech {pct(tech)} · news {pct(news)}
          </Text>
        )}
        <Text style={styles.faint}>{ago(p.predictionTimestamp)}</Text>
      </Card>
    );
  }

  return (
    <Card onPress={onPress} style={{ marginBottom: space.sm }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <Label color={colors.ai}>MODEL ESTIMATE · NEXT CLOSE</Label>
          <Text style={[styles.big, { color: changeColor(p.predictedReturnPct) }, type.num]}>{pct(p.predictedReturnPct)}</Text>
          <Text style={styles.meta}>
            {price(p.basePrice)} → {price(p.basePrice * (1 + p.predictedReturnPct / 100))}
            {Number.isFinite(p.features.interval_lo_pct)
              ? `  ·  80% range ${pct(p.features.interval_lo_pct)} to ${pct(p.features.interval_hi_pct)}`
              : ""}
          </Text>
        </View>
        <View style={styles.conf}>
          <Text style={styles.confVal}>{(p.confidence * 100).toFixed(0)}</Text>
          <Text style={styles.confLabel}>confidence</Text>
        </View>
      </View>

      <View style={{ marginTop: space.md }}>
        <ProbabilityBar p={p.probabilityUp} />
      </View>

      {horizons.length > 1 && (
        <View style={styles.hz}>
          {horizons.map((h) => (
            <View key={h.key} style={styles.hzCell}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
                <Text style={styles.hzKey}>{h.key}</Text>
                <Text style={[styles.hzVal, { color: changeColor(h.pct) }, type.num]}>{pct(h.pct)}</Text>
              </View>
              {Number.isFinite(h.lo) && <RangeBar lo={h.lo} mid={h.pct} hi={h.hi} />}
              <Text style={styles.hzSub}>
                {Number.isFinite(h.lo) ? `${pct(h.lo, 1)} … ${pct(h.hi, 1)}` : h.label}
                {Number.isFinite(h.pUp) ? ` · P↑ ${(h.pUp * 100).toFixed(0)}%` : ""}
              </Text>
            </View>
          ))}
        </View>
      )}

      {hasComponents && (
        <View style={{ marginTop: space.sm }}>
          <ComponentBar label="Technical model" value={tech} max={max} />
          <ComponentBar label={`News impact (${p.features.news_articles_since_close ?? 0} new articles)`} value={news} max={max} />
        </View>
      )}

      {drivers.length > 0 && (
        <View style={{ marginTop: space.md }}>
          <Label>WHY · WHAT MOVED THE TECHNICAL ESTIMATE</Label>
          {drivers.map((d) => (
            <View key={d.name} style={styles.driver}>
              <Icon name={d.contributionPct >= 0 ? "arrow-up" : "arrow-down"} size={12} color={changeColor(d.contributionPct)} />
              <Text style={styles.driverName}>{d.label}</Text>
              <Text style={styles.driverVal}>{d.value}</Text>
              <Text style={[styles.driverC, { color: changeColor(d.contributionPct) }, type.num]}>
                {d.contributionPct >= 0 ? "+" : ""}
                {d.contributionPct.toFixed(3)}%
              </Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.trace}>
        <Icon name="time-outline" size={12} color={colors.faint} />
        <Text style={styles.faint}>
          {dateTime(p.predictionTimestamp)} · data {clock(p.marketDataTimestamp)} · news {p.latestNewsTimestamp ? clock(p.latestNewsTimestamp) : "none"} · {p.modelVersion}
        </Text>
      </View>
      <Text style={styles.faint}>Trigger: {p.trigger}</Text>

      <View style={{ marginTop: 8 }}>
        {p.outcome ? (
          <View style={[styles.outcome, { backgroundColor: p.outcome.directionCorrect ? colors.upSoft : colors.downSoft }]}>
            <Icon name={p.outcome.directionCorrect ? "checkmark-circle" : "close-circle"} size={14} color={p.outcome.directionCorrect ? colors.up : colors.down} />
            <Text style={styles.outcomeText}>
              Actual {pct(p.outcome.actualReturnPct)} ({price(p.outcome.actualPrice)}) · {p.outcome.directionCorrect ? "direction correct" : "direction wrong"} · error{" "}
              {p.outcome.absError.toFixed(2)} pts
            </Text>
          </View>
        ) : (
          <Label color={colors.faint}>OUTCOME PENDING</Label>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  compact: { width: 170, padding: space.md },
  symbol: { color: colors.text, fontWeight: "800", fontSize: 15 },
  big: { fontSize: 34, fontWeight: "800", letterSpacing: -0.8, marginTop: 2 },
  meta: { color: colors.muted, fontSize: 12, marginTop: 3 },
  faint: { color: colors.faint, fontSize: 11, marginTop: 3, flexShrink: 1 },
  conf: { alignItems: "center", backgroundColor: colors.aiSoft, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 6 },
  confVal: { color: colors.ai, fontSize: 20, fontWeight: "800" },
  confLabel: { color: colors.ai, fontSize: 10, fontWeight: "600" },
  compLabel: { color: colors.muted, fontSize: 12 },
  compVal: { fontSize: 12, fontWeight: "800" },
  compTrack: { height: 6, backgroundColor: colors.cardAlt, borderRadius: 3, marginTop: 4, overflow: "hidden" },
  compMid: { position: "absolute", left: "50%", width: 1, top: 0, bottom: 0, backgroundColor: colors.borderStrong },
  compFill: { position: "absolute", top: 0, bottom: 0, borderRadius: 3 },
  hz: { flexDirection: "row", gap: space.sm, marginTop: space.md },
  hzCell: { flex: 1, backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: 10 },
  hzKey: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  hzVal: { fontSize: 15, fontWeight: "800" },
  hzSub: { color: colors.faint, fontSize: 10, marginTop: 5 },
  rangeTrack: { height: 6, backgroundColor: colors.bg, borderRadius: 3, marginTop: 8 },
  rangeBand: { position: "absolute", top: 0, bottom: 0, backgroundColor: colors.aiSoft, borderRadius: 3 },
  rangeZero: { position: "absolute", top: -2, bottom: -2, width: 1, backgroundColor: colors.borderStrong },
  rangeMid: { position: "absolute", top: -2, width: 4, height: 10, marginLeft: -2, borderRadius: 2 },
  driver: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5 },
  driverName: { color: colors.text, fontSize: 12, flex: 1 },
  driverVal: { color: colors.muted, fontSize: 12, minWidth: 56, textAlign: "right" },
  driverC: { fontSize: 12, fontWeight: "700", minWidth: 64, textAlign: "right" },
  trace: { flexDirection: "row", gap: 5, alignItems: "center", marginTop: space.md },
  outcome: { flexDirection: "row", gap: 6, alignItems: "center", borderRadius: radius.sm, padding: 8 },
  outcomeText: { color: colors.text, fontSize: 12, flex: 1 },
});
