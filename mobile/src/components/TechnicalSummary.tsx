import { StyleSheet, Text, View } from "react-native";
import type { Candle } from "../api/types";
import { technicalReadings, type Reading } from "../indicators";
import { colors, radius, space } from "../theme";
import { Card, Label } from "./ui";

const C: Record<Reading, string> = { bullish: colors.up, bearish: colors.down, neutral: colors.muted };

/** Indicator readings with a tally gauge. Readings describe the chart; they are not recommendations. */
export function TechnicalSummary({ candles }: { candles: Candle[] }) {
  const rows = technicalReadings(candles);
  if (!rows.length) return null;
  const bull = rows.filter((r) => r.reading === "bullish").length;
  const bear = rows.filter((r) => r.reading === "bearish").length;
  const neutral = rows.length - bull - bear;
  const score = (bull - bear) / rows.length; // -1..1
  const verdict = score > 0.35 ? "Mostly bullish readings" : score > 0.1 ? "Leaning bullish" : score < -0.35 ? "Mostly bearish readings" : score < -0.1 ? "Leaning bearish" : "Mixed readings";
  const vColor = score > 0.1 ? colors.up : score < -0.1 ? colors.down : colors.muted;

  return (
    <Card>
      <View style={styles.head}>
        <View>
          <Label>TECHNICAL SUMMARY</Label>
          <Text style={[styles.verdict, { color: vColor }]}>{verdict}</Text>
        </View>
        <View style={styles.tally}>
          <Text style={[styles.tallyN, { color: colors.up }]}>{bull}</Text>
          <Text style={[styles.tallyN, { color: colors.muted }]}>{neutral}</Text>
          <Text style={[styles.tallyN, { color: colors.down }]}>{bear}</Text>
        </View>
      </View>
      <View style={styles.gauge}>
        <View style={[styles.gSeg, { flex: bull || 0.001, backgroundColor: colors.up }]} />
        <View style={[styles.gSeg, { flex: neutral || 0.001, backgroundColor: colors.borderStrong }]} />
        <View style={[styles.gSeg, { flex: bear || 0.001, backgroundColor: colors.down }]} />
      </View>
      <View style={{ marginTop: space.md }}>
        {rows.map((r, i) => (
          <View key={r.name} style={[styles.row, i < rows.length - 1 && styles.divider]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{r.name}</Text>
              <Text style={styles.note}>{r.note}</Text>
            </View>
            <Text style={styles.value}>{r.value}</Text>
            <View style={[styles.badge, { backgroundColor: C[r.reading] + "22" }]}>
              <Text style={[styles.badgeText, { color: C[r.reading] }]}>{r.reading.toUpperCase()}</Text>
            </View>
          </View>
        ))}
      </View>
      <Text style={styles.foot}>Indicator readings describe recent price behaviour. They are not buy or sell recommendations.</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  verdict: { fontSize: 18, fontWeight: "800", marginTop: 4 },
  tally: { flexDirection: "row", gap: 12 },
  tallyN: { fontSize: 18, fontWeight: "800" },
  gauge: { flexDirection: "row", height: 6, borderRadius: 3, overflow: "hidden", marginTop: space.md, gap: 2 },
  gSeg: { height: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  name: { color: colors.text, fontSize: 13, fontWeight: "600" },
  note: { color: colors.faint, fontSize: 11, marginTop: 1 },
  value: { color: colors.text, fontSize: 13, fontWeight: "700", minWidth: 58, textAlign: "right" },
  badge: { borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 3, minWidth: 64, alignItems: "center" },
  badgeText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  foot: { color: colors.faint, fontSize: 11, marginTop: space.md },
});
