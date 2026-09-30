import { StyleSheet, Text, View } from "react-native";
import type { AnyQuote, DataStatus } from "../api/types";
import { hasPrice } from "../api/types";
import { clock } from "../format";
import { effectiveStatus, useConnected, useNow } from "../hooks";
import { colors } from "../theme";

const LABEL: Record<DataStatus, string> = {
  LIVE: "LIVE",
  DELAYED: "DELAYED",
  MARKET_CLOSED: "MARKET CLOSED",
  DATA_UNAVAILABLE: "DATA UNAVAILABLE",
};
const COLOR: Record<DataStatus, string> = {
  LIVE: colors.live,
  DELAYED: colors.delayed,
  MARKET_CLOSED: colors.closed,
  DATA_UNAVAILABLE: colors.unavailable,
};

/** LIVE / DELAYED / MARKET CLOSED / DATA UNAVAILABLE pill, optionally with "Last updated: HH:MM:SS". */
export function StatusBadge({ quote, detailed = false, compact = false }: { quote: AnyQuote | null | undefined; detailed?: boolean; compact?: boolean }) {
  const now = useNow(5000);
  const connected = useConnected();
  const { status, reason } = effectiveStatus(quote, now, connected);
  const color = COLOR[status];
  return (
    <View>
      <View style={[styles.pill, { borderColor: color }]}>
        {status === "LIVE" && <View style={[styles.dot, { backgroundColor: color }]} />}
        <Text style={[styles.text, { color }, compact && { fontSize: 9 }]}>{LABEL[status]}</Text>
      </View>
      {detailed && (
        <View style={{ marginTop: 6 }}>
          {hasPrice(quote) && <Text style={styles.meta}>Last updated: {clock(quote.dataTimestamp)}</Text>}
          {status === "DELAYED" && hasPrice(quote) && quote.delayMinutes > 0 && <Text style={styles.warn}>Delayed market data.</Text>}
          {status !== "LIVE" && <Text style={styles.meta}>{reason}</Text>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    gap: 5,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 10, fontWeight: "700", letterSpacing: 0.6 },
  meta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  warn: { color: colors.delayed, fontSize: 12, marginTop: 2, fontWeight: "600" },
});
