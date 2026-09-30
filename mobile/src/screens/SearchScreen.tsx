import { useNavigation } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "../api/client";
import { Card, Empty } from "../components/ui";
import { colors } from "../theme";

const POPULAR = ["AAPL", "NVDA", "MSFT", "TSLA", "AMZN", "SPY", "QQQ", "JEPQ", "VOO", "SMH"];

/** Search any stock or ETF. */
export function SearchScreen() {
  const nav = useNavigation<any>();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ symbol: string; name: string; type: string }[]>([]);

  useEffect(() => {
    const term = q.trim();
    if (!term) return;
    const t = setTimeout(() => api.searchAssets(term).then(setResults).catch(() => setResults([])), 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: 16 }}>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Search stocks & ETFs (AAPL, Apple, SPY, JEPQ…)"
        placeholderTextColor={colors.faint}
        style={styles.input}
        autoCorrect={false}
        autoFocus
        returnKeyType="search"
        onSubmitEditing={() => q.trim() && nav.push("Asset", { symbol: (results[0]?.symbol ?? q.trim()).toUpperCase() })}
      />
      {!q.trim() ? (
        <>
          <Text style={styles.label}>POPULAR</Text>
          <View style={styles.chips}>
            {POPULAR.map((s) => (
              <Text key={s} style={styles.chip} onPress={() => nav.push("Asset", { symbol: s })}>
                {s}
              </Text>
            ))}
          </View>
        </>
      ) : (
        <FlatList
          data={q.trim() ? results : []}
          keyExtractor={(r) => r.symbol}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Card onPress={() => nav.push("Asset", { symbol: item.symbol })} style={{ marginTop: 8, flexDirection: "row", justifyContent: "space-between" }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.symbol}>{item.symbol}</Text>
                <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
              </View>
              <Text style={styles.type}>{item.type === "etf" ? "ETF" : "Stock"}</Text>
            </Card>
          )}
          ListEmptyComponent={<Empty text="No matches yet." />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { backgroundColor: colors.card, color: colors.text, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border, fontSize: 16 },
  label: { color: colors.muted, fontSize: 12, fontWeight: "800", letterSpacing: 1.2, marginTop: 20 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  chip: { color: colors.text, fontWeight: "700", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, overflow: "hidden" },
  symbol: { color: colors.text, fontWeight: "800", fontSize: 16 },
  name: { color: colors.muted, fontSize: 12, marginTop: 2 },
  type: { color: colors.muted, fontSize: 12, alignSelf: "center" },
});
