// Design tokens. Dark, high-contrast "terminal" look with restrained accents.

export const colors = {
  bg: "#07090D",
  card: "#0F131B",
  cardAlt: "#161C27",
  elevated: "#1B2230",
  border: "#1F2735",
  borderStrong: "#2A3446",
  text: "#F1F4F9",
  muted: "#9AA4B5",
  faint: "#5F6B7E",
  accent: "#3D8BFF",
  accentSoft: "rgba(61,139,255,0.14)",
  up: "#16C784",
  upSoft: "rgba(22,199,132,0.14)",
  down: "#EA3943",
  downSoft: "rgba(234,57,67,0.14)",
  neutral: "#9AA4B5",
  neutralSoft: "rgba(154,164,181,0.12)",
  live: "#16C784",
  delayed: "#F5A524",
  delayedSoft: "rgba(245,165,36,0.14)",
  closed: "#9AA4B5",
  unavailable: "#EA3943",
  ai: "#8B7CF6",
  aiSoft: "rgba(139,124,246,0.14)",
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 };

export const type = {
  display: { fontSize: 34, fontWeight: "800" as const, letterSpacing: -0.8 },
  h1: { fontSize: 24, fontWeight: "800" as const, letterSpacing: -0.4 },
  h2: { fontSize: 18, fontWeight: "700" as const, letterSpacing: -0.2 },
  title: { fontSize: 15, fontWeight: "700" as const },
  body: { fontSize: 14, fontWeight: "400" as const, lineHeight: 20 },
  small: { fontSize: 12, fontWeight: "500" as const },
  micro: { fontSize: 10, fontWeight: "800" as const, letterSpacing: 0.8 },
  num: { fontVariant: ["tabular-nums" as const] },
};

export const sentimentColor = (s?: string | null) =>
  s === "positive" ? colors.up : s === "negative" ? colors.down : colors.neutral;

export const changeColor = (x?: number | null) => (x == null ? colors.muted : x > 0 ? colors.up : x < 0 ? colors.down : colors.muted);
export const changeSoft = (x?: number | null) => (x == null || x === 0 ? colors.neutralSoft : x > 0 ? colors.upSoft : colors.downSoft);
