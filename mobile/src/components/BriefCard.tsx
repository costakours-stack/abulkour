import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { api } from "../api/client";
import type { AnalystBrief } from "../api/types";
import { ago } from "../format";
import { colors, radius, sentimentColor, space } from "../theme";
import { Button, Card, Icon, Label } from "./ui";

const STANCE = {
  bullish: { color: colors.up, bg: colors.upSoft, icon: "trending-up" as const },
  neutral: { color: colors.muted, bg: colors.neutralSoft, icon: "remove" as const },
  bearish: { color: colors.down, bg: colors.downSoft, icon: "trending-down" as const },
};

/** Claude "AI Analyst" brief. Loads on demand; labeled as AI interpretation. */
export function BriefCard({ symbol }: { symbol: string }) {
  const [brief, setBrief] = useState<AnalystBrief | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (force = false) => {
    setBusy(true);
    setNote(null);
    try {
      const r = await api.brief(symbol, force);
      if (r.available && r.brief) setBrief(r.brief);
      else setNote(r.reason ?? "AI Analyst unavailable.");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card tint={colors.aiSoft} style={{ borderColor: "#2E2757" }}>
      <View style={styles.head}>
        <View style={styles.aiBadge}>
          <Icon name="sparkles" size={13} color={colors.ai} />
          <Text style={styles.aiText}>AI ANALYST</Text>
        </View>
        {brief && <Text style={styles.faint}>{ago(brief.generatedAt)} · {brief.model}</Text>}
      </View>

      {!brief ? (
        <>
          <Text style={styles.body}>
            Claude reads {symbol}’s price action, the model’s estimate and its track record, and recent news, then writes an outlook with drivers and risks.
          </Text>
          {note && <Text style={[styles.faint, { color: colors.delayed, marginTop: 8 }]}>{note}</Text>}
          <View style={{ marginTop: space.md }}>
            <Button label="Generate AI brief" icon="sparkles" variant="ai" busy={busy} onPress={() => load(false)} />
          </View>
        </>
      ) : (
        <>
          <View style={[styles.stance, { backgroundColor: STANCE[brief.stance].bg }]}>
            <Icon name={STANCE[brief.stance].icon} size={16} color={STANCE[brief.stance].color} />
            <Text style={[styles.stanceText, { color: STANCE[brief.stance].color }]}>{brief.stance.toUpperCase()}</Text>
            <Text style={styles.faint}>confidence {(brief.confidence * 100).toFixed(0)}%</Text>
          </View>
          <Text style={styles.headline}>{brief.headline}</Text>
          <Text style={styles.body}>{brief.summary}</Text>

          <Label>KEY DRIVERS</Label>
          {brief.drivers.map((d, i) => (
            <View key={i} style={styles.driver}>
              <View style={[styles.driverDot, { backgroundColor: sentimentColor(d.direction) }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.driverTitle}>{d.title}</Text>
                <Text style={styles.driverDetail}>{d.detail}</Text>
              </View>
            </View>
          ))}

          <View style={{ marginTop: space.md }}>
            <Label>RISKS</Label>
            {brief.risks.map((r, i) => (
              <Text key={i} style={styles.bullet}>•  {r}</Text>
            ))}
          </View>
          {brief.watchNext.length > 0 && (
            <View style={{ marginTop: space.md }}>
              <Label>WATCH NEXT</Label>
              {brief.watchNext.map((r, i) => (
                <Text key={i} style={styles.bullet}>•  {r}</Text>
              ))}
            </View>
          )}
          <Text style={[styles.faint, { marginTop: space.md }]}>AI interpretation of the data shown in this app. Not financial advice.</Text>
          <View style={{ marginTop: space.sm }}>
            <Button label="Refresh brief" icon="refresh" variant="secondary" busy={busy} onPress={() => load(true)} />
          </View>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: space.sm },
  aiBadge: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.aiSoft, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  aiText: { color: colors.ai, fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
  faint: { color: colors.faint, fontSize: 11 },
  body: { color: colors.muted, fontSize: 14, lineHeight: 20, marginVertical: 6 },
  stance: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  stanceText: { fontWeight: "800", fontSize: 12, letterSpacing: 0.6 },
  headline: { color: colors.text, fontSize: 17, fontWeight: "800", marginTop: 10 },
  driver: { flexDirection: "row", gap: 10, marginTop: 8 },
  driverDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  driverTitle: { color: colors.text, fontWeight: "700", fontSize: 13 },
  driverDetail: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  bullet: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 4 },
});
