import { useId, useState } from "react";
import { type LayoutChangeEvent, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Stop } from "react-native-svg";
import { colors } from "../theme";

export interface Point {
  t: number;
  v: number;
}

/** Price line chart with a soft area fill and optional markers (e.g. prediction times). */
export function LineChart({
  points,
  height = 200,
  markers = [],
  formatX,
}: {
  points: Point[];
  height?: number;
  markers?: { t: number; color: string }[];
  formatX?: (t: number) => string;
}) {
  const [width, setWidth] = useState(0);
  const gradientId = `grad-${useId().replace(/:/g, "")}`; // unique per chart, several can share a screen
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  if (points.length < 2) return <View style={{ height }} onLayout={onLayout} />;

  const pad = 8;
  const vs = points.map((p) => p.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const x = (t: number) => pad + ((t - t0) / (t1 - t0 || 1)) * (width - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / (max - min || 1)) * (height - pad * 2);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const up = points[points.length - 1].v >= points[0].v;
  const stroke = up ? colors.up : colors.down;
  const area = `${d} L${x(t1)},${height} L${x(t0)},${height} Z`;

  return (
    <View onLayout={onLayout}>
      {width > 0 && (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={stroke} stopOpacity={0.28} />
              <Stop offset="1" stopColor={stroke} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Path d={area} fill={`url(#${gradientId})`} />
          <Path d={d} stroke={stroke} strokeWidth={2} fill="none" strokeLinejoin="round" />
          {markers
            .filter((m) => m.t >= t0 && m.t <= t1)
            .map((m, i) => {
              const nearest = points.reduce((a, b) => (Math.abs(b.t - m.t) < Math.abs(a.t - m.t) ? b : a));
              return (
                <G key={i}>
                  <Line x1={x(m.t)} x2={x(m.t)} y1={0} y2={height} stroke={m.color} strokeOpacity={0.35} strokeDasharray="3,3" />
                  <Circle cx={x(m.t)} cy={y(nearest.v)} r={3.5} fill={m.color} />
                </G>
              );
            })}
        </Svg>
      )}
      <View style={styles.axis}>
        <Text style={styles.axisText}>{formatX ? formatX(t0) : ""}</Text>
        <Text style={styles.axisText}>
          L {min.toFixed(2)} · H {max.toFixed(2)}
        </Text>
        <Text style={styles.axisText}>{formatX ? formatX(t1) : ""}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  axis: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  axisText: { color: colors.faint, fontSize: 11 },
});
