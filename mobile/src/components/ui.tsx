import { Ionicons } from "@expo/vector-icons";
import { type ComponentProps, type ReactNode, useEffect, useState } from "react";
import { ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { changeColor, changeSoft, colors, radius, space, type } from "../theme";

export type IconName = ComponentProps<typeof Ionicons>["name"];

export function Icon({ name, size = 18, color = colors.muted }: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={name} size={size} color={color} />;
}

export function Section({
  title,
  icon,
  right,
  children,
  style,
}: {
  title: string;
  icon?: IconName;
  right?: ReactNode;
  children: ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[{ marginTop: space.xl }, style]}>
      <View style={styles.sectionHeader}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {icon && <Icon name={icon} size={14} color={colors.muted} />}
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

export function Card({ children, style, onPress, tint }: { children: ReactNode; style?: ViewStyle | ViewStyle[]; onPress?: () => void; tint?: string }) {
  const s = [styles.card, tint ? { borderColor: tint } : null, style];
  if (onPress)
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [...s, pressed && { opacity: 0.75, transform: [{ scale: 0.995 }] }]}>
        {children}
      </Pressable>
    );
  return <View style={s}>{children}</View>;
}

export function Chip({
  label,
  active,
  onPress,
  color,
  icon,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  color?: string;
  icon?: IconName;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.chip,
        active && { backgroundColor: colors.accent, borderColor: colors.accent },
        color && !active ? { borderColor: color } : null,
        pressed && { opacity: 0.7 },
      ]}
    >
      {icon && <Icon name={icon} size={14} color={active ? "#fff" : color ?? colors.text} />}
      <Text style={[styles.chipText, active && { color: "#fff" }, color && !active ? { color } : null]}>{label}</Text>
    </Pressable>
  );
}

export function Button({
  label,
  onPress,
  icon,
  variant = "primary",
  busy,
}: {
  label: string;
  onPress?: () => void;
  icon?: IconName;
  variant?: "primary" | "secondary" | "ai";
  busy?: boolean;
}) {
  const bg = variant === "primary" ? colors.accent : variant === "ai" ? colors.ai : colors.cardAlt;
  return (
    <Pressable
      onPress={busy ? undefined : onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: bg }, variant === "secondary" && { borderWidth: 1, borderColor: colors.borderStrong }, pressed && { opacity: 0.8 }]}
    >
      {busy ? <ActivityIndicator color="#fff" size="small" /> : icon ? <Icon name={icon} size={16} color="#fff" /> : null}
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

export function ChipRow<T extends string>({
  options,
  value,
  onChange,
  labels,
}: {
  options: readonly T[];
  value: T | null;
  onChange: (v: T | null) => void;
  labels?: Partial<Record<T, string>>;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
      {options.map((o) => (
        <Chip key={o} label={labels?.[o] ?? o} active={value === o} onPress={() => onChange(value === o ? null : o)} />
      ))}
    </ScrollView>
  );
}

/** iOS-style segmented control. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  labels,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labels?: Partial<Record<T, string>>;
}) {
  return (
    <View style={styles.segment}>
      {options.map((o) => (
        <Pressable key={o} onPress={() => onChange(o)} style={[styles.segmentItem, value === o && styles.segmentActive]}>
          <Text style={[styles.segmentText, value === o && { color: colors.text }]}>{labels?.[o] ?? o}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Colored % change pill with arrow. */
export function ChangePill({ value, suffix = "%", size = "md" }: { value: number | null | undefined; suffix?: string; size?: "sm" | "md" }) {
  const c = changeColor(value);
  const arrow = value == null ? "" : value > 0 ? "▲ " : value < 0 ? "▼ " : "";
  return (
    <View style={[styles.pill, { backgroundColor: changeSoft(value) }, size === "sm" && { paddingHorizontal: 6, paddingVertical: 2 }]}>
      <Text style={[{ color: c, fontWeight: "700", fontSize: size === "sm" ? 11 : 13 }, type.num]}>
        {value == null ? "—" : `${arrow}${Math.abs(value).toFixed(2)}${suffix}`}
      </Text>
    </View>
  );
}

export function Stat({ label, value, color, hint }: { label: string; value: string; color?: string; hint?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, color ? { color } : null, type.num]} numberOfLines={1}>
        {value}
      </Text>
      {hint ? <Text style={styles.statHint}>{hint}</Text> : null}
    </View>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

/** Horizontal bar 0..1 with a midline, e.g. probability of an up move. */
export function ProbabilityBar({ p }: { p: number }) {
  const pct = Math.round(p * 100);
  const color = p > 0.52 ? colors.up : p < 0.48 ? colors.down : colors.neutral;
  return (
    <View>
      <View style={styles.probTrack}>
        <View style={[styles.probFill, { width: `${pct}%`, backgroundColor: color }]} />
        <View style={styles.probMid} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
        <Text style={styles.statHint}>Down</Text>
        <Text style={[styles.statHint, { color, fontWeight: "700" }]}>P(up) {pct}%</Text>
        <Text style={styles.statHint}>Up</Text>
      </View>
    </View>
  );
}

export function Skeleton({ height = 16, width = "100%", style }: { height?: number; width?: number | `${number}%`; style?: ViewStyle }) {
  const [o] = useState(() => new Animated.Value(0.4));
  useEffect(() => {
    const a = Animated.loop(
      Animated.sequence([
        Animated.timing(o, { toValue: 0.9, duration: 700, useNativeDriver: true }),
        Animated.timing(o, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    a.start();
    return () => a.stop();
  }, [o]);
  return <Animated.View style={[{ height, width, borderRadius: 6, backgroundColor: colors.elevated, opacity: o }, style]} />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <Card style={{ marginBottom: space.sm, gap: 10 }}>
      <Skeleton width="40%" height={12} />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "70%" : "100%"} height={14} />
      ))}
    </Card>
  );
}

export function Loading() {
  return (
    <View style={{ padding: 16 }}>
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard lines={2} />
    </View>
  );
}

export function Empty({ text, icon = "file-tray-outline" }: { text: string; icon?: IconName }) {
  return (
    <View style={{ alignItems: "center", padding: 20, gap: 8 }}>
      <Icon name={icon} size={26} color={colors.faint} />
      <Text style={{ color: colors.muted, textAlign: "center", fontSize: 13 }}>{text}</Text>
    </View>
  );
}

export function ErrorText({ text }: { text: string }) {
  return (
    <View style={styles.error}>
      <Icon name="alert-circle" size={16} color={colors.down} />
      <Text style={{ color: colors.text, flex: 1, fontSize: 13 }}>{text}</Text>
    </View>
  );
}

export function Label({ children, color = colors.muted }: { children: ReactNode; color?: string }) {
  return <Text style={[type.micro, { color }]}>{children}</Text>;
}

/** Circular symbol avatar. */
export function SymbolBadge({ symbol, size = 36 }: { symbol: string; size?: number }) {
  const hue = [...symbol].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: `hsla(${hue},55%,45%,0.22)`, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: `hsl(${hue},70%,72%)`, fontWeight: "800", fontSize: size * 0.3 }}>{symbol.slice(0, 4)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: space.sm + 2 },
  sectionTitle: { color: colors.muted, fontSize: 12, fontWeight: "800", letterSpacing: 1.1 },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: colors.border },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: { color: colors.text, fontSize: 13, fontWeight: "600" },
  button: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 16 },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  segment: { flexDirection: "row", backgroundColor: colors.card, borderRadius: radius.md, padding: 3, borderWidth: 1, borderColor: colors.border },
  segmentItem: { flex: 1, alignItems: "center", paddingVertical: 7, borderRadius: radius.sm },
  segmentActive: { backgroundColor: colors.elevated },
  segmentText: { color: colors.muted, fontWeight: "700", fontSize: 12 },
  pill: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3, alignSelf: "flex-start" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  stat: { backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: space.md, flexGrow: 1, flexBasis: "46%" },
  statLabel: { color: colors.muted, fontSize: 11, fontWeight: "600" },
  statValue: { color: colors.text, fontSize: 16, fontWeight: "800", marginTop: 3 },
  statHint: { color: colors.faint, fontSize: 11, marginTop: 2 },
  probTrack: { height: 8, borderRadius: 4, backgroundColor: colors.cardAlt, overflow: "hidden" },
  probFill: { height: 8, borderRadius: 4 },
  probMid: { position: "absolute", left: "50%", top: -2, bottom: -2, width: 2, backgroundColor: colors.borderStrong },
  error: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    backgroundColor: colors.downSoft,
    borderRadius: radius.md,
    padding: space.md,
    marginVertical: space.sm,
  },
});
