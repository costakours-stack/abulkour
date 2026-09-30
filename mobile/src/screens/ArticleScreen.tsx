import { useNavigation, useRoute } from "@react-navigation/native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "../api/client";
import { ImpactChip, openArticle } from "../components/NewsCard";
import { Card, Chip, ErrorText, Label, Loading } from "../components/ui";
import { ago, cap, dateTime } from "../format";
import { useAsync } from "../hooks";
import { colors, sentimentColor } from "../theme";

/** Article detail: FACT (what the source says) clearly separated from AI ANALYSIS (the model's interpretation). */
export function ArticleScreen() {
  const route = useRoute<any>();
  const nav = useNavigation<any>();
  const { id, focusSymbol } = route.params as { id: string; focusSymbol?: string };
  const { data: a, error, loading } = useAsync(() => api.article(id), [id]);
  if (loading) return <Loading />;
  if (error || !a) return <ErrorText text={error ?? "Article not found"} />;
  const an = a.analysis;

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <Label color={colors.text}>FACT</Label>
      <Card style={{ marginTop: 6 }}>
        <Text style={styles.headline}>{a.headline}</Text>
        <Text style={styles.meta}>
          {a.source} · published {dateTime(a.publishedAt)} ({ago(a.publishedAt)})
        </Text>
        <Text style={styles.meta}>Retrieved {dateTime(a.retrievedAt)} via {a.provider}</Text>
        {!!a.providerSnippet && (
          <Text style={styles.snippet}>
            <Text style={styles.snippetLabel}>Publisher excerpt: </Text>
            {a.providerSnippet.length > 300 ? `${a.providerSnippet.slice(0, 297)}…` : a.providerSnippet}
          </Text>
        )}
        <View style={{ marginTop: 12 }}>
          <Chip label="Read the original article ↗" active onPress={() => openArticle(a.url)} />
        </View>
        {!!a.alsoReportedBy?.length && (
          <View style={{ marginTop: 12 }}>
            <Text style={styles.meta}>Also reported by:</Text>
            {a.alsoReportedBy.map((o) => (
              <Pressable key={o.url} onPress={() => openArticle(o.url)}>
                <Text style={styles.link}>{o.source} ↗</Text>
              </Pressable>
            ))}
          </View>
        )}
      </Card>

      <Label color={colors.text}>RELATED ASSETS</Label>
      <Card style={{ marginTop: 6, marginBottom: 20 }}>
        {a.relations.length === 0 && <Text style={styles.meta}>No specific stocks or ETFs identified.</Text>}
        {a.relations.map((r) => (
          <Pressable key={r.symbol} onPress={() => nav.push("Asset", { symbol: r.symbol })} style={styles.relRow}>
            <Text style={[styles.ticker, r.symbol === focusSymbol && { borderColor: colors.accent }]}>{r.symbol}</Text>
            <Text style={styles.relLabel}>{r.label}</Text>
          </Pressable>
        ))}
      </Card>

      <Label color={colors.ai}>AI ANALYSIS — MODEL INTERPRETATION, NOT FACT</Label>
      <Card style={{ marginTop: 6, borderColor: "#3B2F66" }}>
        {!an ? (
          <Text style={styles.meta}>Analysis pending.</Text>
        ) : (
          <>
            <Text style={styles.body}>{an.summary}</Text>
            <View style={styles.grid}>
              <Stat k="Sentiment" v={`${cap(an.sentiment)} (${an.sentimentScore > 0 ? "+" : ""}${an.sentimentScore.toFixed(2)})`} color={sentimentColor(an.sentiment)} />
              <Stat k="Relevance" v={an.relevanceScore.toFixed(2)} />
              <Stat k="Impact" v={cap(an.impact)} color={an.impact === "high" ? colors.delayed : undefined} />
              <Stat k="Category" v={an.category} />
            </View>
            <Text style={styles.reasonLabel}>Why it may be relevant</Text>
            <Text style={styles.body}>{an.reason}</Text>

            {an.symbolImpacts.length > 0 && (
              <>
                <Text style={styles.reasonLabel}>Potential impact (model estimate)</Text>
                {an.symbolImpacts.map((i) => (
                  <Text key={i.symbol} style={styles.body}>
                    {i.symbol}: model estimates a{" "}
                    <Text style={{ color: sentimentColor(i.direction), fontWeight: "700" }}>{i.direction}</Text> potential impact (confidence{" "}
                    {i.confidence.toFixed(2)}).
                  </Text>
                ))}
                <Text style={styles.meta}>This is an estimate of possible direction, not a forecast that the price will move.</Text>
              </>
            )}
            <Text style={[styles.meta, { marginTop: 10 }]}>
              Analyzer: {an.analyzer}
              {an.analyzer.startsWith("rules") ? " (keyword rules, no language model)" : ""} · {dateTime(an.analyzedAt)}
            </Text>
          </>
        )}
      </Card>

      {!!a.priceImpact?.length && (
        <>
          <View style={{ marginTop: 20 }}>
            <Label color={colors.ai}>ESTIMATED PRICE IMPACT — MODEL ESTIMATE</Label>
          </View>
          <Card style={{ marginTop: 6 }}>
            {a.priceImpact.map((p) => (
              <Pressable key={p.symbol} onPress={() => nav.push("Asset", { symbol: p.symbol })} style={styles.impactRow}>
                <ImpactChip impact={p} />
                <Text style={styles.impactRange}>
                  likely range {p.lowPct > 0 ? "+" : ""}
                  {p.lowPct.toFixed(2)}% to {p.highPct > 0 ? "+" : ""}
                  {p.highPct.toFixed(2)}%
                </Text>
              </Pressable>
            ))}
            <Text style={styles.meta}>
              Estimated next-session move vs the market that this article alone may cause, scaled by each stock’s volatility.
              Method: {a.priceImpact[0].method}. The model estimates a potential impact; it does not predict what will happen.
            </Text>
          </Card>
        </>
      )}
    </ScrollView>
  );
}

function Stat({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statK}>{k}</Text>
      <Text style={[styles.statV, color ? { color } : null]}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headline: { color: colors.text, fontSize: 19, fontWeight: "800", lineHeight: 25 },
  meta: { color: colors.muted, fontSize: 12, marginTop: 4 },
  snippet: { color: "#C3C9D6", fontSize: 13, marginTop: 10, lineHeight: 18 },
  snippetLabel: { color: colors.muted, fontWeight: "700" },
  link: { color: colors.accent, fontSize: 13, marginTop: 4 },
  relRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 5 },
  ticker: { color: colors.text, fontWeight: "800", borderWidth: 1, borderColor: colors.border, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, minWidth: 54, textAlign: "center" },
  relLabel: { color: colors.muted, fontSize: 12, flex: 1 },
  body: { color: colors.text, fontSize: 14, lineHeight: 20, marginTop: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  stat: { backgroundColor: colors.cardAlt, borderRadius: 8, padding: 8, minWidth: "46%", flexGrow: 1 },
  statK: { color: colors.muted, fontSize: 11 },
  statV: { color: colors.text, fontSize: 14, fontWeight: "700", marginTop: 2 },
  reasonLabel: { color: colors.ai, fontSize: 12, fontWeight: "700", marginTop: 14 },
  impactRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  impactRange: { color: colors.muted, fontSize: 12, flex: 1 },
});
