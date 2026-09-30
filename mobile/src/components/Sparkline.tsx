import Svg, { Path } from "react-native-svg";
import { colors } from "../theme";

/** Tiny trend line for list rows. Colored by the move over the window. */
export function Sparkline({ values, width = 72, height = 28 }: { values: number[] | undefined; width?: number; height?: number }) {
  if (!values || values.length < 2) return <Svg width={width} height={height} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (i: number) => (i / (values.length - 1)) * (width - 2) + 1;
  const y = (v: number) => 1 + (1 - (v - min) / (max - min || 1)) * (height - 2);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const up = values[values.length - 1] >= values[0];
  return (
    <Svg width={width} height={height}>
      <Path d={d} stroke={up ? colors.up : colors.down} strokeWidth={1.6} fill="none" strokeLinejoin="round" />
    </Svg>
  );
}
