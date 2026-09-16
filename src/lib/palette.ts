/** Chart colors resolved to concrete hex for ECharts and MapLibre, mirroring
 * the CSS custom properties in theme.css (the validated reference palette). */

export const dark = () =>
  window.matchMedia("(prefers-color-scheme: dark)").matches;

export interface ChartTheme {
  surface: string;
  page: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  grid: string;
  baseline: string;
  series1: string;
  series2: string;
  series3: string;
}

const LIGHT: ChartTheme = {
  surface: "#fcfcfb",
  page: "#f9f9f7",
  textPrimary: "#0b0b0b",
  textSecondary: "#52514e",
  textMuted: "#898781",
  grid: "#e1e0d9",
  baseline: "#c3c2b7",
  series1: "#2a78d6",
  series2: "#eb6834",
  series3: "#1baf7a",
};

const DARK: ChartTheme = {
  surface: "#1a1a19",
  page: "#0d0d0d",
  textPrimary: "#ffffff",
  textSecondary: "#c3c2b7",
  textMuted: "#898781",
  grid: "#2c2c2a",
  baseline: "#383835",
  series1: "#3987e5",
  series2: "#d95926",
  series3: "#199e70",
};

export const chartTheme = (): ChartTheme => (dark() ? DARK : LIGHT);

export const STATUS_COLORS: Record<string, string> = {
  ok: "#0ca30c",
  short_window: "#fab219",
  incomplete_gauges: "#ec835a",
  unstable: "#d03b3b",
  error: "#d03b3b",
  not_triggered: "#898781",
  failed_validation_or_trigger: "#898781",
};

export const STATUS_LABELS: Record<string, string> = {
  ok: "ok",
  short_window: "short window",
  incomplete_gauges: "incomplete gauges",
  unstable: "unstable",
  error: "error",
  not_triggered: "not triggered",
  failed_validation_or_trigger: "failed validation/trigger",
};

export const statusColor = (s: string) => STATUS_COLORS[s] ?? "#898781";
export const statusLabel = (s: string) => STATUS_LABELS[s] ?? s;

/** Sequential blue ramp (magnitude), light -> dark, from the reference palette. */
export const BLUE_RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
/** Second sequential context (depth toggle): orange, light -> dark. */
export const ORANGE_RAMP = ["#fbe0d4", "#f6b795", "#f18d5b", "#eb6834", "#c94e1d", "#a03c14", "#772b0c"];

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** Interpolated color from a ramp for x in [0, 1]. */
export function rampColor(ramp: string[], x: number): string {
  const t = Math.max(0, Math.min(1, x)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(t));
  const f = t - i;
  const a = hexToRgb(ramp[i]);
  const b = hexToRgb(ramp[i + 1]);
  const c = a.map((v, k) => Math.round(v + f * (b[k] - v)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export const rampCss = (ramp: string[]) =>
  `linear-gradient(to right, ${ramp.join(", ")})`;
