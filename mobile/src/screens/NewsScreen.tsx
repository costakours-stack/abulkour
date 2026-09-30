import { useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { api, type NewsQuery } from "../api/client";
import type { Article } from "../api/types";
import { NewsCard } from "../components/NewsCard";
import { Chip, ChipRow, Empty, ErrorText, Label } from "../components/ui";
import { useLiveNews } from "../hooks";
import { colors } from "../theme";

const SENTIMENTS = ["positive", "neutral", "negative"] as const;
const TIMES = ["1h", "24h", "7d"] as const;
const CATEGORIES = ["earnings", "m&a", "analyst", "regulatory", "macro", "product", "company"] as const;
const SECTORS = ["technology", "semiconductors", "communication", "consumer", "financials", "energy", "healthcare"] as const;
const ASSET_TYPES = ["stock", "etf"] as const;
const RELEVANCE = ["0.5", "0.75"] as const;
const SORTS = ["newest", "relevance"] as const;

const CATEGORY_LABELS: Record<string, string> = {
  earnings: "Earnings", "m&a": "M&A", analyst: "Analyst up/downgrades", regulatory: "Regulatory", macro: "Macroeconomic",
  product: "Product", company: "Company",
};

/** "All News": latest financial news with filters, search, and live updates. */
export function NewsScreen() {
  const nav = useNavigation<any>();
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [symbol, setSymbol] = useState("");
  const [sentiment, setSentiment] = useState<(typeof SENTIMENTS)[number] | null>(null);
  const [since, setSince] = useState<(typeof TIMES)[number] | null>(null);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number] | null>(null);
  const [sector, setSector] = useState<(typeof SECTORS)[number] | null>(null);
  const [assetType, setAssetType] = useState<(typeof ASSET_TYPES)[number] | null>(null);
  const [minRel, setMinRel] = useState<(typeof RELEVANCE)[number] | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [sort, setSort] = useState<(typeof SORTS)[number]>("newest");
  const [sources, setSources] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  const [articles, setArticles] = useState<Article[]>([]);
  const [related, setRelated] = useState<{ symbol: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.newsMeta().then((m) => setSources(m.sources)).catch(() => {});
  }, []);

  const filter: NewsQuery = useMemo(
    () => ({
      symbol: symbol.trim().toUpperCase() || undefined,
      sentiment: sentiment ?? undefined,
      since: since ?? undefined,
      category: category ?? undefined,
      sector: sector ?? undefined,
      assetType: assetType ?? undefined,
      minRelevance: minRel ? Number(minRel) : undefined,
      source: source ?? undefined,
      sort,
      limit: 60,
    }),
    [symbol, sentiment, since, category, sector, assetType, minRel, source, sort],
  );

  const [nonce, setNonce] = useState(0);
  const load = useCallback(() => {
    setLoading(true);
    setNonce((n) => n + 1);
  }, []);

  // Fetch when the query/filters change or on pull-to-refresh; stale responses are ignored.
  useEffect(() => {
    let current = true;
    const run = submitted
      ? api.searchNews(submitted, filter).then((r) => ({ articles: r.articles, related: r.relatedAssets }))
      : api.news(filter).then((articles) => ({ articles, related: [] as { symbol: string; name: string }[] }));
    run
      .then((r) => {
        if (!current) return;
        setArticles(r.articles);
        setRelated(r.related);
        setError(null);
      })
      .catch((e: Error) => current && setError(e.message))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [submitted, filter, nonce]);

  // New articles appear automatically when they match the active filters.
  const accept = useCallback(
    (a: Article) => {
      if (submitted) return false; // search results are a snapshot
      if (filter.symbol && !a.relations.some((r) => r.symbol === filter.symbol)) return false;
      if (filter.sentiment && a.analysis?.sentiment !== filter.sentiment) return false;
      if (filter.category && a.analysis?.category !== filter.category) return false;
      if (filter.sector && !a.sectors.includes(filter.sector)) return false;
      if (filter.source && a.source.toLowerCase() !== filter.source.toLowerCase()) return false;
      if (filter.minRelevance && (a.analysis?.relevanceScore ?? 0) < filter.minRelevance) return false;
      if (filter.assetType === "etf" && a.relatedEtfs.length === 0) return false;
      if (filter.assetType === "stock" && !a.relations.some((r) => r.relation === "direct")) return false;
      return true;
    },
    [filter, submitted],
  );
  const live = useLiveNews("news:all", articles, accept);
  const activeCount = [symbol, sentiment, since, category, sector, assetType, minRel, source].filter(Boolean).length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.header}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => setSubmitted(query.trim())}
          placeholder='Search news: "Apple", "AI stocks", "oil", "Federal Reserve"'
          placeholderTextColor={colors.faint}
          style={styles.search}
          returnKeyType="search"
          autoCorrect={false}
        />
        <View style={styles.row}>
          {!!submitted && <Chip label={`× "${submitted}"`} onPress={() => { setQuery(""); setSubmitted(""); }} />}
          <Chip label={`Filters${activeCount ? ` (${activeCount})` : ""}`} active={showFilters} onPress={() => setShowFilters((s) => !s)} />
          <ChipRow options={SORTS} value={sort} onChange={(v) => setSort(v ?? "newest")} labels={{ newest: "Newest", relevance: "Most relevant" }} />
        </View>

        {showFilters && (
          <View style={{ gap: 6, marginTop: 6 }}>
            <TextInput
              value={symbol}
              onChangeText={setSymbol}
              placeholder="Asset (e.g. AAPL, SPY)"
              placeholderTextColor={colors.faint}
              style={[styles.search, { paddingVertical: 6 }]}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <Label>TYPE</Label>
            <ChipRow options={ASSET_TYPES} value={assetType} onChange={setAssetType} labels={{ stock: "Stocks", etf: "ETFs" }} />
            <Label>SENTIMENT (AI)</Label>
            <ChipRow options={SENTIMENTS} value={sentiment} onChange={setSentiment} labels={{ positive: "Positive", neutral: "Neutral", negative: "Negative" }} />
            <Label>TIME</Label>
            <ChipRow options={TIMES} value={since} onChange={setSince} labels={{ "1h": "Last 1 hour", "24h": "Last 24 hours", "7d": "Last 7 days" }} />
            <Label>CATEGORY</Label>
            <ChipRow options={CATEGORIES} value={category} onChange={setCategory} labels={CATEGORY_LABELS} />
            <Label>SECTOR</Label>
            <ChipRow options={SECTORS} value={sector} onChange={setSector} />
            <Label>RELEVANCE (AI)</Label>
            <ChipRow options={RELEVANCE} value={minRel} onChange={setMinRel} labels={{ "0.5": "≥ 0.5", "0.75": "≥ 0.75" }} />
            {sources.length > 0 && (
              <>
                <Label>SOURCE</Label>
                <ChipRow options={sources} value={source} onChange={setSource} />
              </>
            )}
          </View>
        )}

        {related.length > 0 && (
          <View style={[styles.row, { flexWrap: "wrap", marginTop: 8 }]}>
            <Text style={{ color: colors.muted, fontSize: 12 }}>Related assets:</Text>
            {related.slice(0, 10).map((r) => (
              <Pressable key={r.symbol} onPress={() => nav.push("Asset", { symbol: r.symbol })}>
                <Text style={styles.ticker}>{r.symbol}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {error && <ErrorText text={error} />}
      <FlatList
        data={live.items}
        keyExtractor={(a) => a.id}
        renderItem={({ item }) => <NewsCard article={item} fresh={live.freshIds.has(item.id)} focusSymbol={filter.symbol} />}
        contentContainerStyle={{ padding: 16, paddingTop: 8 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
        ListEmptyComponent={!loading ? <Empty text="No articles match these filters." /> : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { padding: 16, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: colors.border },
  search: { backgroundColor: colors.card, color: colors.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  ticker: { color: colors.text, fontWeight: "700", backgroundColor: colors.cardAlt, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, fontSize: 12 },
});
