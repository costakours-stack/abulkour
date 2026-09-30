import { useRoute } from "@react-navigation/native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "../api/client";
import { openArticle } from "../components/NewsCard";
import { PredictionCard } from "../components/PredictionCard";
import { Card, ErrorText, Label, Loading } from "../components/ui";
import { dateTime } from "../format";
import { useAsync } from "../hooks";
import { colors, sentimentColor } from "../theme";

/** Everything a prediction was based on: model, timestamps, features, the exact news it saw, and the actual result. */
export function PredictionTraceScreen() {
  const { id } = useRoute<any>().params as { id: string };
  const { data: p, error, loading } = useAsync(() => api.predictionTrace(id), [id]);
  if (loading) return <Loading />;
  if (error || !p) return <ErrorText text={error ?? "Not found"} />;

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <PredictionCard p={p} />

      <Label>TRACEABILITY</Label>
      <Card style={{ marginTop: 6, marginBottom: 16 }}>
        <KV k="Prediction ID" v={p.id} />
        <KV k="Model version" v={p.modelVersion} />
        <KV k="Prediction timestamp" v={dateTime(p.predictionTimestamp)} />
        <KV k="Market data timestamp" v={dateTime(p.marketDataTimestamp)} />
        <KV k="Latest news timestamp" v={p.latestNewsTimestamp ? dateTime(p.latestNewsTimestamp) : "none"} />
        <KV k="Horizon" v="Next regular-session close" />
        <KV k="Trigger" v={p.trigger} />
        <KV k="Actual result" v={p.outcome ? `${p.outcome.actualReturnPct.toFixed(2)}% at ${dateTime(p.outcome.priceTimestamp)}` : "pending"} />
      </Card>

      <Label>FEATURES</Label>
      <Card style={{ marginTop: 6, marginBottom: 16 }}>
        {Object.entries(p.features).map(([k, v]) => (
          <KV key={k} k={k} v={String(v)} />
        ))}
      </Card>

      <Label>NEWS AVAILABLE TO THE MODEL ({p.newsUsed.length})</Label>
      <Text style={styles.note}>Only articles available before the prediction timestamp can be used.</Text>
      {p.newsUsed.map((a) => (
        <Pressable key={a.id} onPress={() => openArticle(a.url)}>
          <Card style={{ marginTop: 8 }}>
            <Text style={styles.headline}>{a.headline}</Text>
            <Text style={styles.note}>
              {a.source} · published {dateTime(a.publishedAt)} · available {dateTime(a.availableAt)}
              {a.sentiment ? " · " : ""}
              {a.sentiment && <Text style={{ color: sentimentColor(a.sentiment) }}>{a.sentiment}</Text>}
            </Text>
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.k}>{k}</Text>
      <Text style={styles.v} selectable>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  kv: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, gap: 12 },
  k: { color: colors.muted, fontSize: 12 },
  v: { color: colors.text, fontSize: 12, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  note: { color: colors.faint, fontSize: 11, marginTop: 4 },
  headline: { color: colors.text, fontSize: 14, fontWeight: "600" },
});
