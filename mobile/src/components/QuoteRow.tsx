import { Pressable, StyleSheet, Text, View } from "react-native";
import type { AnyQuote, NewsMomentum } from "../api/types";
import { hasPrice } from "../api/types";
import { price } from "../format";
import { effectiveStatus, useConnected, useNow } from "../hooks";
import { colors, radius, space, type } from "../theme";
import { Sparkline } from "./Sparkline";
import { ChangePill, Icon, SymbolBadge } from "./ui";

const STATUS_SHORT = { LIVE: "LIVE", DELAYED: "DELAYED", MARKET_CLOSED: "CLOSED", DATA_UNAVAILABLE: "NO DATA" } as const;
const STATUS_COLOR = { LIVE: colors.live, DELAYED: colors.delayed, MARKET_CLOSED: colors.closed, DATA_UNAVAILABLE: colors.unavailable } as const;

/** Watchlist row: badge, name, sparkline, price, change, status, news momentum. */
export function QuoteRow({
  symbol,
  name,
  quote,
  spark,
  momentum,
  onPress,
  last,
}: {
  symbol: string;
  name?: string;
  quote?: AnyQuote;
  spark?: number[];
  momentum?: NewsMomentum;
  onPress?: () => void;
  last?: boolean;
}) {
  const now = useNow(10_000);
  const connected = useConnected();
  const q = hasPrice(quote) ? quote : null;
  const { status } = effectiveStatus(quote, now, connected);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, !last && styles.divider, pressed && { backgroundColor: colors.cardAlt }]}>
      <SymbolBadge symbol={symbol} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.symbol}>{symbol}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
          <Text style={styles.name} numberOfLines={1}>
            {name && name !== symbol ? name : ""}
          </Text>
        </View>
        {momentum && momentum.articles24h > 0 && (
          <View style={styles.momentum}>
            <Icon name="newspaper-outline" size={11} color={colors.faint} />
            <Text style={styles.momentumText}>
              {momentum.articles24h} today · est.{" "}
              <Text style={{ color: momentum.estMovePct > 0 ? colors.up : momentum.estMovePct < 0 ? colors.down : colors.muted, fontWeight: "700" }}>
                {momentum.estMovePct > 0 ? "+" : ""}
                {momentum.estMovePct.toFixed(2)}%
              </Text>
            </Text>
          </View>
        )}
      </View>
      <Sparkline values={spark} />
      <View style={{ alignItems: "flex-end", gap: 4, minWidth: 86 }}>
        <Text style={[styles.price, type.num]}>{q ? price(q.price) : "—"}</Text>
        {q ? <ChangePill value={q.changePercent} size="sm" /> : null}
        <Text style={[styles.status, { color: STATUS_COLOR[status] }]}>
          {status === "LIVE" ? "● " : ""}
          {STATUS_SHORT[status]}
        </Text>
      </View>
    </Pressable>
  );
}

/** Compact index tile for the horizontal market strip. */
export function MarketTile({ label, symbol, note, quote, spark, onPress }: { label: string; symbol: string; note: string; quote?: AnyQuote; spark?: number[]; onPress?: () => void }) {
  const q = hasPrice(quote) ? quote : null;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileNote} numberOfLines={1}>
        {note}
      </Text>
      <Text style={[styles.tilePrice, type.num]}>{q ? price(q.price) : "—"}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
        <ChangePill value={q?.changePercent} size="sm" />
        <Sparkline values={spark} width={54} height={22} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.md },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  symbol: { color: colors.text, fontSize: 15, fontWeight: "800" },
  name: { color: colors.muted, fontSize: 12, flexShrink: 1 },
  momentum: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  momentumText: { color: colors.faint, fontSize: 11 },
  price: { color: colors.text, fontSize: 15, fontWeight: "700" },
  status: { fontSize: 9, fontWeight: "800", letterSpacing: 0.6 },
  tile: { width: 150, backgroundColor: colors.card, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: colors.border },
  tileLabel: { color: colors.text, fontWeight: "800", fontSize: 14 },
  tileNote: { color: colors.faint, fontSize: 10, marginTop: 1 },
  tilePrice: { color: colors.text, fontWeight: "800", fontSize: 18, marginTop: 8 },
});
