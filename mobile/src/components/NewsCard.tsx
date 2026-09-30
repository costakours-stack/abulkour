import { useNavigation } from "@react-navigation/native";
import * as WebBrowser from "expo-web-browser";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Article, PriceImpact } from "../api/types";
import { ago, cap } from "../format";
import { useNow } from "../hooks";
import { colors, radius, sentimentColor, space, type } from "../theme";
import { Icon } from "./ui";

export const openArticle = (url: string) => WebBrowser.openBrowserAsync(url).catch(() => {});

const RELATION_TAG: Record<string, string> = { holding: "via holding", sector: "sector", macro: "macro" };

/** "AAPL ▲ +0.42%" — estimated next-session move from this article (model estimate). */
export function ImpactChip({ impact, onPress }: { impact: PriceImpact; onPress?: () => void }) {
  const c = impact.direction === "up" ? colors.up : impact.direction === "down" ? colors.down : colors.muted;
  const bg = impact.direction === "up" ? colors.upSoft : impact.direction === "down" ? colors.downSoft : colors.neutralSoft;
  const arrow = impact.direction === "up" ? "▲" : impact.direction === "down" ? "▼" : "•";
  return (
    <Pressable onPress={onPress} hitSlop={4} style={[styles.impact, { backgroundColor: bg }]}>
      <Text style={styles.impactSym}>{impact.symbol}</Text>
      <Text style={[styles.impactVal, { color: c }, type.num]}>
        {arrow} {impact.estMovePct > 0 ? "+" : ""}
        {impact.estMovePct.toFixed(2)}%
      </Text>
    </Pressable>
  );
}

/** Source · time / headline / summary / estimated price impact per related asset / sentiment. */
export function NewsCard({ article: a, focusSymbol, fresh }: { article: Article; focusSymbol?: string; fresh?: boolean }) {
  const now = useNow(30_000);
  const nav = useNavigation<any>();
  const an = a.analysis;
  const byRules = an?.analyzer.startsWith("rules") ?? false;
  const focusRel = focusSymbol ? a.relations.find((r) => r.symbol === focusSymbol) : undefined;
  const impacts = (a.priceImpact ?? []).filter((p) => p.direction !== "flat" || p.symbol === focusSymbol);
  const impactSyms = new Set(impacts.map((p) => p.symbol));
  const others = a.relations.filter((r) => !impactSyms.has(r.symbol)).slice(0, 5);
  const also = a.alsoReportedBy ?? [];

  return (
    <Pressable
      onPress={() => nav.push("Article", { id: a.id, focusSymbol })}
      style={({ pressed }) => [styles.card, fresh && styles.fresh, pressed && { opacity: 0.8 }]}
    >
      <View style={styles.top}>
        <View style={[styles.dot, { backgroundColor: sentimentColor(an?.sentiment) }]} />
        <Text style={styles.source} numberOfLines={1}>
          {a.source}
          <Text style={styles.time}>  ·  {ago(a.publishedAt, now)}</Text>
        </Text>
        {an?.impact === "high" && (
          <View style={styles.highTag}>
            <Icon name="flash" size={10} color={colors.delayed} />
            <Text style={styles.highText}>HIGH IMPACT</Text>
          </View>
        )}
        {fresh && <Text style={styles.newTag}>NEW</Text>}
      </View>

      <Text style={styles.headline}>{a.headline}</Text>

      {an ? (
        <Text style={styles.summary} numberOfLines={3}>
          {an.summary}
        </Text>
      ) : (
        <Text style={styles.pending}>Analyzing…</Text>
      )}

      {focusRel && focusRel.relation !== "direct" && (
        <View style={styles.relation}>
          <Icon name="git-branch-outline" size={12} color={colors.accent} />
          <Text style={styles.relationText}>{focusRel.label}</Text>
        </View>
      )}

      {(impacts.length > 0 || others.length > 0) && (
        <View style={styles.chips}>
          {impacts.map((p) => (
            <ImpactChip key={p.symbol} impact={p} onPress={() => nav.push("Asset", { symbol: p.symbol })} />
          ))}
          {others.map((r) => (
            <Pressable key={r.symbol} onPress={() => nav.push("Asset", { symbol: r.symbol })} hitSlop={4} style={styles.ticker}>
              <Text style={styles.tickerText}>
                {r.symbol}
                {RELATION_TAG[r.relation] ? <Text style={styles.tickerTag}> {RELATION_TAG[r.relation]}</Text> : null}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {an ? `${byRules ? "Keyword" : "AI"} sentiment ${cap(an.sentiment)} ${an.sentimentScore > 0 ? "+" : ""}${an.sentimentScore.toFixed(2)}` : ""}
          {impacts.length ? "  ·  est. moves are model estimates" : ""}
        </Text>
        <Pressable onPress={() => openArticle(a.url)} hitSlop={8} style={styles.open}>
          <Icon name="open-outline" size={14} color={colors.accent} />
          <Text style={styles.openText}>Source</Text>
        </Pressable>
      </View>

      {also.length > 0 && (
        <Text style={styles.also} numberOfLines={1}>
          Also reported by {also.slice(0, 3).map((o) => o.source).join(", ")}
          {also.length > 3 ? ` +${also.length - 3}` : ""}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: colors.border, marginBottom: space.sm + 2 },
  fresh: { borderColor: colors.accent },
  top: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  source: { color: colors.text, fontSize: 12, fontWeight: "700", flexShrink: 1 },
  time: { color: colors.faint, fontWeight: "500" },
  highTag: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: colors.delayedSoft, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 2 },
  highText: { color: colors.delayed, fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  newTag: { color: colors.accent, fontSize: 10, fontWeight: "800" },
  headline: { color: colors.text, fontSize: 16, fontWeight: "700", marginTop: 8, lineHeight: 22 },
  summary: { color: colors.muted, fontSize: 13, marginTop: 6, lineHeight: 19 },
  pending: { color: colors.faint, fontSize: 12, marginTop: 6, fontStyle: "italic" },
  relation: { flexDirection: "row", gap: 6, alignItems: "center", marginTop: 8 },
  relationText: { color: colors.accent, fontSize: 12, flex: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  impact: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4 },
  impactSym: { color: colors.text, fontWeight: "800", fontSize: 12 },
  impactVal: { fontWeight: "800", fontSize: 12 },
  ticker: { backgroundColor: colors.cardAlt, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4 },
  tickerText: { color: colors.text, fontWeight: "700", fontSize: 12 },
  tickerTag: { color: colors.faint, fontWeight: "500" },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10, gap: 8 },
  footerText: { color: colors.faint, fontSize: 11, flex: 1 },
  open: { flexDirection: "row", alignItems: "center", gap: 4 },
  openText: { color: colors.accent, fontSize: 12, fontWeight: "700" },
  also: { color: colors.faint, fontSize: 11, marginTop: 6 },
});
