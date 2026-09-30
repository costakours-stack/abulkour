import { useMemo, useState } from "react";
import { type GestureResponderEvent, type LayoutChangeEvent, Platform, StyleSheet, Text, View } from "react-native";
import Svg, { G, Line, Path, Polygon, Rect, Text as SvgText } from "react-native-svg";
import type { Candle } from "../api/types";
import { compact, signed } from "../format";
import { bollinger, ema, macd, rsi, sma } from "../indicators";
import { colors, radius, space, type } from "../theme";
import { Chip, Segmented } from "./ui";

export interface Projection {
  basePrice: number;
  points: { days: number; pct: number; lowPct: number; highPct: number }[];
}

type Overlay = "sma20" | "sma50" | "sma200" | "ema20" | "bb";
type Pane = "volume" | "rsi" | "macd";

const OVERLAY_META: Record<Overlay, { label: string; color: string }> = {
  sma20: { label: "SMA 20", color: "#F5A524" },
  sma50: { label: "SMA 50", color: "#3D8BFF" },
  sma200: { label: "SMA 200", color: "#E879F9" },
  ema20: { label: "EMA 20", color: "#22D3EE" },
  bb: { label: "Bollinger", color: "#94A3B8" },
};

const AXIS_W = 58;
const PAD_T = 8;

function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

const fmtPrice = (v: number) => (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(2));

/**
 * Analysis chart: candles/line/area, volume, overlays (SMA/EMA/Bollinger),
 * RSI and MACD panes, crosshair with OHLC readout, S&P 500 comparison and the
 * AI forecast cone. `candles` may include warm-up bars before `displayFrom` so
 * indicators are correct from the first visible bar.
 */
export function ProChart({
  candles,
  displayFrom,
  intraday,
  barDays = 1,
  projection,
  compare,
  compareLabel = "SPY",
  formatTime,
}: {
  candles: Candle[];
  displayFrom?: number;
  intraday?: boolean;
  /** trading days per bar (long ranges use multi-day bars) */
  barDays?: number;
  projection?: Projection | null;
  compare?: Candle[] | null;
  compareLabel?: string;
  formatTime: (t: number) => string;
}) {
  const [width, setWidth] = useState(0);
  const [kind, setKind] = useState<"candle" | "line" | "area">("candle");
  const [overlays, setOverlays] = useState<Set<Overlay>>(new Set(["sma50"]));
  const [panes, setPanes] = useState<Set<Pane>>(new Set(["volume"]));
  const [showCompare, setShowCompare] = useState(false);
  const [showForecast, setShowForecast] = useState(true);
  const [cursor, setCursor] = useState<number | null>(null);

  const toggle = <T,>(set: Set<T>, v: T, fn: (s: Set<T>) => void) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    fn(n);
  };

  // ---- data & indicators on the full series (incl. warm-up), then slice to the visible window
  const calc = useMemo(() => {
    const closes = candles.map((c) => c.c);
    const start = Math.max(0, displayFrom ? candles.findIndex((c) => c.t >= displayFrom) : 0);
    const series = {
      sma20: sma(closes, 20),
      sma50: sma(closes, 50),
      sma200: sma(closes, 200),
      ema20: ema(closes, 20),
      bb: bollinger(closes, 20, 2),
      rsi: rsi(closes, 14),
      macd: macd(closes),
    };
    return { start: start < 0 ? 0 : start, series };
  }, [candles, displayFrom]);

  const vis = candles.slice(calc.start);
  const n = vis.length;
  const forecastOn = !!projection && showForecast && !intraday && !showCompare;
  const futureSlots = forecastOn ? Math.ceil(Math.max(...projection!.points.map((p) => p.days)) / barDays) + 2 : 0;
  const slots = n + futureSlots;

  // compare: both series as % change from the first visible close
  const cmp = useMemo(() => {
    if (!showCompare || !compare?.length || !n) return null;
    const byT = new Map(compare.map((c) => [c.t, c.c]));
    const first = vis.find((c) => byT.has(c.t));
    if (!first) return null;
    const base = byT.get(first.t)!;
    return vis.map((c) => {
      const v = byT.get(c.t);
      return v === undefined ? NaN : (v / base - 1) * 100;
    });
  }, [showCompare, compare, vis, n]);

  if (!n) return null;
  const at = (arr: number[], i: number) => arr[calc.start + i];
  const plotW = Math.max(10, width - AXIS_W);
  const slotW = plotW / Math.max(1, slots);
  const x = (i: number) => (i + 0.5) * slotW;
  const effKind = showCompare ? "line" : kind;

  // main pane domain
  const mainH = 250;
  const pctMode = showCompare && !!cmp;
  const base0 = vis[0].c;
  const val = (v: number) => (pctMode ? (v / base0 - 1) * 100 : v);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const c = vis[i];
    lo = Math.min(lo, val(effKind === "candle" ? c.l : c.c));
    hi = Math.max(hi, val(effKind === "candle" ? c.h : c.c));
    if (!pctMode)
      for (const o of overlays) {
        const vals = o === "bb" ? [at(calc.series.bb.upper, i), at(calc.series.bb.lower, i)] : [at(calc.series[o], i)];
        for (const v of vals) {
          if (!Number.isFinite(v)) continue;
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      }
    if (cmp && Number.isFinite(cmp[i])) {
      lo = Math.min(lo, cmp[i]);
      hi = Math.max(hi, cmp[i]);
    }
  }
  if (forecastOn)
    for (const p of projection!.points) {
      lo = Math.min(lo, projection!.basePrice * (1 + p.lowPct / 100));
      hi = Math.max(hi, projection!.basePrice * (1 + p.highPct / 100));
    }
  const padY = (hi - lo) * 0.06 || 1;
  lo -= padY;
  hi += padY;
  const y = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * (mainH - PAD_T * 2);

  const linePath = (vals: (number | undefined)[]) => {
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (v === undefined || !Number.isFinite(v)) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const closeVals = vis.map((c) => val(c.c));
  const up = vis[n - 1].c >= vis[0].c;
  const trend = up ? colors.up : colors.down;
  const cur = cursor !== null && cursor < n ? cursor : n - 1;
  const cb = vis[cur];
  const prevC = cur > 0 ? vis[cur - 1].c : cb.o;

  const onMove = (e: GestureResponderEvent | any) => {
    const ne = e.nativeEvent;
    const px = Platform.OS === "web" ? ne.offsetX ?? ne.locationX : ne.locationX;
    if (typeof px !== "number") return;
    setCursor(Math.max(0, Math.min(n - 1, Math.floor(px / slotW))));
  };
  const interact = {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderGrant: onMove,
    onResponderMove: onMove,
    onResponderRelease: () => Platform.OS !== "web" && setCursor(null),
    ...(Platform.OS === "web" ? { onPointerMove: onMove, onPointerLeave: () => setCursor(null) } : {}),
  };

  const yTicks = niceTicks(lo, hi, 5);
  const xTickIdx = [0, Math.floor(n * 0.25), Math.floor(n * 0.5), Math.floor(n * 0.75), n - 1].filter((v, i, a) => a.indexOf(v) === i);

  // ---- sub panes
  const subH = 78;
  const paneList = (["volume", "rsi", "macd"] as Pane[]).filter((p) => panes.has(p));

  return (
    <View>
      {/* toolbar */}
      <View style={{ gap: space.sm }}>
        {!intraday && !showCompare && (
          <Segmented options={["candle", "line", "area"] as const} value={kind} onChange={setKind} labels={{ candle: "Candles", line: "Line", area: "Area" }} />
        )}
        <View style={styles.toolRow}>
          {(Object.keys(OVERLAY_META) as Overlay[]).map((o) => (
            <Chip key={o} label={OVERLAY_META[o].label} active={overlays.has(o)} onPress={() => toggle(overlays, o, setOverlays)} color={OVERLAY_META[o].color} />
          ))}
          <Chip label="Volume" icon="bar-chart-outline" active={panes.has("volume")} onPress={() => toggle(panes, "volume", setPanes)} />
          <Chip label="RSI" active={panes.has("rsi")} onPress={() => toggle(panes, "rsi", setPanes)} />
          <Chip label="MACD" active={panes.has("macd")} onPress={() => toggle(panes, "macd", setPanes)} />
          {!!compare?.length && <Chip label={`vs ${compareLabel}`} icon="git-compare-outline" active={showCompare} onPress={() => setShowCompare((s) => !s)} />}
          {!!projection && !intraday && (
            <Chip label="AI forecast" icon="sparkles-outline" active={showForecast && !showCompare} onPress={() => setShowForecast((s) => !s)} color={colors.ai} />
          )}
        </View>
      </View>

      {/* readout */}
      <View style={styles.readout}>
        <Text style={styles.readDate}>{formatTime(cb.t)}</Text>
        {pctMode ? (
          <Text style={[styles.readVal, type.num]}>
            <Text style={{ color: colors.text }}>This </Text>
            <Text style={{ color: closeVals[cur] >= 0 ? colors.up : colors.down }}>{closeVals[cur].toFixed(2)}%</Text>
            <Text style={{ color: colors.muted }}>   {compareLabel} </Text>
            <Text style={{ color: (cmp?.[cur] ?? 0) >= 0 ? colors.up : colors.down }}>{Number.isFinite(cmp?.[cur] ?? NaN) ? `${cmp![cur].toFixed(2)}%` : "—"}</Text>
          </Text>
        ) : (
          <Text style={[styles.readVal, type.num]}>
            <Text style={styles.k}>O </Text>{fmtPrice(cb.o)}  <Text style={styles.k}>H </Text>{fmtPrice(cb.h)}  <Text style={styles.k}>L </Text>{fmtPrice(cb.l)}  <Text style={styles.k}>C </Text>
            <Text style={{ color: cb.c >= prevC ? colors.up : colors.down }}>{fmtPrice(cb.c)} ({(((cb.c / prevC) - 1) * 100).toFixed(2)}%)</Text>
            {cb.v ? <Text style={styles.k}>  Vol </Text> : null}
            {cb.v ? compact(cb.v) : null}
          </Text>
        )}
        {!pctMode && overlays.size > 0 && (
          <Text style={[styles.readSub, type.num]}>
            {[...overlays].map((o) => {
              const v = o === "bb" ? at(calc.series.bb.mid, cur) : at(calc.series[o], cur);
              return (
                <Text key={o} style={{ color: OVERLAY_META[o].color }}>
                  {OVERLAY_META[o].label} {Number.isFinite(v) ? fmtPrice(v) : "—"}{"   "}
                </Text>
              );
            })}
          </Text>
        )}
      </View>

      <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 && (
          <>
            {/* main pane */}
            <View {...interact}>
              <Svg width={width} height={mainH}>
                {yTicks.map((t) => (
                  <G key={t}>
                    <Line x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke={colors.border} strokeWidth={1} />
                    <SvgText x={plotW + 6} y={y(t) + 4} fill={colors.faint} fontSize={10}>
                      {pctMode ? `${t.toFixed(1)}%` : fmtPrice(t)}
                    </SvgText>
                  </G>
                ))}

                {!pctMode && overlays.has("bb") && (
                  <>
                    <Path d={linePath(vis.map((_, i) => at(calc.series.bb.upper, i)))} stroke={OVERLAY_META.bb.color} strokeWidth={1} strokeOpacity={0.7} fill="none" />
                    <Path d={linePath(vis.map((_, i) => at(calc.series.bb.lower, i)))} stroke={OVERLAY_META.bb.color} strokeWidth={1} strokeOpacity={0.7} fill="none" />
                    <Path d={linePath(vis.map((_, i) => at(calc.series.bb.mid, i)))} stroke={OVERLAY_META.bb.color} strokeWidth={1} strokeDasharray="3,3" strokeOpacity={0.5} fill="none" />
                  </>
                )}

                {effKind === "area" && (
                  <Path d={`${linePath(closeVals)} L${x(n - 1)},${mainH} L${x(0)},${mainH} Z`} fill={trend} fillOpacity={0.12} />
                )}
                {effKind === "candle" ? (
                  vis.map((c, i) => {
                    const upBar = c.c >= c.o;
                    const col = upBar ? colors.up : colors.down;
                    const bw = Math.max(1, slotW * 0.62);
                    const top = y(Math.max(c.o, c.c));
                    const h = Math.max(1, Math.abs(y(c.o) - y(c.c)));
                    return (
                      <G key={c.t}>
                        <Line x1={x(i)} x2={x(i)} y1={y(c.h)} y2={y(c.l)} stroke={col} strokeWidth={1} />
                        <Rect x={x(i) - bw / 2} y={top} width={bw} height={h} fill={col} />
                      </G>
                    );
                  })
                ) : (
                  <Path d={linePath(closeVals)} stroke={pctMode ? colors.accent : trend} strokeWidth={2} fill="none" strokeLinejoin="round" />
                )}
                {cmp && <Path d={linePath(cmp)} stroke="#F5A524" strokeWidth={1.6} fill="none" />}

                {!pctMode &&
                  (["sma20", "sma50", "sma200", "ema20"] as const)
                    .filter((o) => overlays.has(o))
                    .map((o) => <Path key={o} d={linePath(vis.map((_, i) => at(calc.series[o], i)))} stroke={OVERLAY_META[o].color} strokeWidth={1.4} fill="none" />)}

                {forecastOn && (() => {
                  const p = projection!;
                  const x0 = x(n - 1);
                  const pts = [{ days: 0, pct: 0, lowPct: 0, highPct: 0 }, ...p.points].map((q) => ({
                    x: x0 + (q.days / barDays) * slotW,
                    mid: p.basePrice * (1 + q.pct / 100),
                    lo: p.basePrice * (1 + q.lowPct / 100),
                    hi: p.basePrice * (1 + q.highPct / 100),
                  }));
                  const band = [...pts.map((q) => `${q.x},${y(q.hi)}`), ...[...pts].reverse().map((q) => `${q.x},${y(q.lo)}`)].join(" ");
                  return (
                    <G>
                      <Line x1={x0} x2={x0} y1={0} y2={mainH} stroke={colors.ai} strokeOpacity={0.3} strokeDasharray="2,4" />
                      <Polygon points={band} fill={colors.ai} fillOpacity={0.12} />
                      <Path d={pts.map((q, i) => `${i ? "L" : "M"}${q.x},${y(q.mid)}`).join(" ")} stroke={colors.ai} strokeWidth={2} strokeDasharray="5,4" fill="none" />
                      {pts.slice(1).map((q, i) => (
                        <Rect key={i} x={q.x - 3} y={y(q.mid) - 3} width={6} height={6} fill={colors.ai} />
                      ))}
                    </G>
                  );
                })()}

                {/* last price tag */}
                {!pctMode && (
                  <G>
                    <Line x1={0} x2={plotW} y1={y(vis[n - 1].c)} y2={y(vis[n - 1].c)} stroke={trend} strokeDasharray="2,3" strokeOpacity={0.6} />
                    <Rect x={plotW + 1} y={y(vis[n - 1].c) - 9} width={AXIS_W - 2} height={18} rx={4} fill={trend} />
                    <SvgText x={plotW + 6} y={y(vis[n - 1].c) + 4} fill="#fff" fontSize={10} fontWeight="700">
                      {fmtPrice(vis[n - 1].c)}
                    </SvgText>
                  </G>
                )}

                {cursor !== null && (
                  <G>
                    <Line x1={x(cur)} x2={x(cur)} y1={0} y2={mainH} stroke={colors.muted} strokeDasharray="3,3" />
                    <Line x1={0} x2={plotW} y1={y(closeVals[cur])} y2={y(closeVals[cur])} stroke={colors.muted} strokeDasharray="3,3" />
                  </G>
                )}
              </Svg>
            </View>

            {/* sub panes */}
            {paneList.map((p) => (
              <View key={p} {...interact} style={styles.pane}>
                <Text style={styles.paneLabel}>
                  {p === "volume" ? `Volume ${compact(cb.v)}` : p === "rsi" ? `RSI 14  ${fmtNum(at(calc.series.rsi, cur))}` : `MACD  ${fmtNum(at(calc.series.macd.line, cur))} / ${fmtNum(at(calc.series.macd.signal, cur))}`}
                </Text>
                <SubPane pane={p} width={width} plotW={plotW} height={subH} n={n} x={x} slotW={slotW} vis={vis} at={at} series={calc.series} cursor={cursor === null ? null : cur} />
              </View>
            ))}

            {/* x axis */}
            <View style={{ height: 16, width: plotW }}>
              {xTickIdx.map((i) => (
                <Text key={i} style={[styles.xLabel, { left: Math.min(Math.max(0, x(i) - 30), plotW - 60) }]}>
                  {formatTime(vis[i].t)}
                </Text>
              ))}
            </View>
          </>
        )}
      </View>
      {forecastOn && (
        <View style={styles.foot}>
          <View style={styles.legend}>
            {projection!.points.map((p) => (
              <View key={p.days} style={styles.legendItem}>
                <Text style={styles.legendK}>{p.days === 1 ? "1 day" : p.days === 5 ? "1 week" : `${p.days} days`}</Text>
                <Text style={[styles.legendV, { color: p.pct >= 0.005 ? colors.up : p.pct <= -0.005 ? colors.down : colors.muted }]}>
                  {signed(p.pct, 2, "%")}
                </Text>
                <Text style={styles.legendR}>
                  {fmtPrice(projection!.basePrice * (1 + p.lowPct / 100))} – {fmtPrice(projection!.basePrice * (1 + p.highPct / 100))}
                </Text>
              </View>
            ))}
          </View>
          <Text style={styles.footText}>
            Purple cone: AI model estimate with its 80% likely price range. Wide bands mean high uncertainty; estimates are not guarantees.
          </Text>
        </View>
      )}
    </View>
  );
}

function fmtNum(v: number) {
  return Number.isFinite(v) ? v.toFixed(2) : "—";
}

function SubPane({
  pane, width, plotW, height, n, x, slotW, vis, at, series, cursor,
}: {
  pane: Pane; width: number; plotW: number; height: number; n: number; x: (i: number) => number; slotW: number; vis: Candle[];
  at: (arr: number[], i: number) => number; series: any; cursor: number | null;
}) {
  const P = 4;
  let content: React.ReactNode = null;
  if (pane === "volume") {
    const maxV = Math.max(...vis.map((c) => c.v), 1);
    const bw = Math.max(1, slotW * 0.62);
    content = vis.map((c, i) => {
      const h = (c.v / maxV) * (height - P);
      return <Rect key={c.t} x={x(i) - bw / 2} y={height - h} width={bw} height={h} fill={c.c >= c.o ? colors.up : colors.down} fillOpacity={0.45} />;
    });
  } else if (pane === "rsi") {
    const yy = (v: number) => P + (1 - v / 100) * (height - 2 * P);
    const d = vis
      .map((_, i) => at(series.rsi, i))
      .map((v, i) => (Number.isFinite(v) ? `${i && Number.isFinite(at(series.rsi, i - 1)) ? "L" : "M"}${x(i).toFixed(1)},${yy(v).toFixed(1)}` : ""))
      .join("");
    content = (
      <>
        <Rect x={0} y={yy(70)} width={plotW} height={yy(30) - yy(70)} fill={colors.ai} fillOpacity={0.06} />
        {[30, 50, 70].map((l) => (
          <G key={l}>
            <Line x1={0} x2={plotW} y1={yy(l)} y2={yy(l)} stroke={colors.border} strokeDasharray={l === 50 ? "2,4" : "4,3"} />
            <SvgText x={plotW + 6} y={yy(l) + 4} fill={colors.faint} fontSize={10}>{l}</SvgText>
          </G>
        ))}
        <Path d={d} stroke={colors.ai} strokeWidth={1.5} fill="none" />
      </>
    );
  } else {
    const line: number[] = vis.map((_, i) => at(series.macd.line, i));
    const sig: number[] = vis.map((_, i) => at(series.macd.signal, i));
    const hist: number[] = vis.map((_, i) => at(series.macd.hist, i));
    const all = [...line, ...sig, ...hist].filter(Number.isFinite);
    const m = Math.max(...all.map(Math.abs), 1e-9);
    const yy = (v: number) => height / 2 - (v / m) * (height / 2 - P);
    const path = (arr: number[]) => arr.map((v, i) => (Number.isFinite(v) ? `${i && Number.isFinite(arr[i - 1]) ? "L" : "M"}${x(i).toFixed(1)},${yy(v).toFixed(1)}` : "")).join("");
    const bw = Math.max(1, slotW * 0.62);
    content = (
      <>
        <Line x1={0} x2={plotW} y1={height / 2} y2={height / 2} stroke={colors.border} />
        {hist.map((v, i) =>
          Number.isFinite(v) ? (
            <Rect key={i} x={x(i) - bw / 2} y={Math.min(yy(v), height / 2)} width={bw} height={Math.abs(yy(v) - height / 2)} fill={v >= 0 ? colors.up : colors.down} fillOpacity={0.5} />
          ) : null,
        )}
        <Path d={path(line)} stroke="#3D8BFF" strokeWidth={1.4} fill="none" />
        <Path d={path(sig)} stroke="#F5A524" strokeWidth={1.2} fill="none" />
      </>
    );
  }
  return (
    <Svg width={width} height={height}>
      {content}
      {cursor !== null && cursor < n && <Line x1={x(cursor)} x2={x(cursor)} y1={0} y2={height} stroke={colors.muted} strokeDasharray="3,3" />}
    </Svg>
  );
}

const styles = StyleSheet.create({
  toolRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  readout: { marginTop: space.md, marginBottom: 6, minHeight: 40 },
  readDate: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  readVal: { color: colors.text, fontSize: 13, fontWeight: "600", marginTop: 2 },
  readSub: { fontSize: 11, marginTop: 2 },
  k: { color: colors.faint, fontWeight: "600" },
  pane: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: 4, paddingTop: 2 },
  paneLabel: { color: colors.faint, fontSize: 10, fontWeight: "700", marginBottom: 2 },
  xLabel: { position: "absolute", width: 60, textAlign: "center", color: colors.faint, fontSize: 10 },
  foot: { marginTop: 10, backgroundColor: colors.aiSoft, borderRadius: radius.sm, padding: 10 },
  footText: { color: colors.faint, fontSize: 11, lineHeight: 15, marginTop: 8 },
  legend: { flexDirection: "row", gap: 8 },
  legendItem: { flex: 1 },
  legendK: { color: colors.ai, fontSize: 10, fontWeight: "800" },
  legendV: { fontSize: 15, fontWeight: "800", marginTop: 2 },
  legendR: { color: colors.muted, fontSize: 11, marginTop: 1 },
});
