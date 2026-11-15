/**
 * The colours charts draw with, for code that paints them itself (canvas).
 * From the data-viz reference palette, and checked against this app's
 * surfaces (`#ffffff` light, `#15181d` dark) with its validator: single-series
 * marks pass the lightness band, chroma floor and 3:1 contrast; the ramps are
 * one hue, lightness monotone, with visible steps.
 *
 * Text never takes these colours; it stays in the text tokens.
 */

/** The theme a chart is drawn for. */
export type ChartTheme = "light" | "dark";

/** Sequential ramp, few to many, for magnitude (heatmaps). Seven steps. */
export const SEQUENTIAL: Readonly<Record<ChartTheme, readonly string[]>> = {
  // Blue steps 100 to 700: the lightest recedes toward the light surface.
  light: ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"],
  // The same steps the other way, so few recedes toward the dark surface.
  dark: ["#104281", "#1c5cab", "#2a78d6", "#5598e7", "#86b6ef", "#b7d3f6", "#cde2fb"],
};

/** One series of marks (bars), blue 450 on light and 400 on dark. */
export const SERIES: Readonly<Record<ChartTheme, string>> = {
  light: "#2a78d6",
  dark: "#3987e5",
};

/** A cell with no value: the chart's background, not a step of the ramp. */
export const EMPTY_CELL: Readonly<Record<ChartTheme, string>> = {
  light: "#eef0f3",
  dark: "#22262d",
};

/** Text drawn on a canvas, matching the muted text token. */
export const CANVAS_TEXT: Readonly<Record<ChartTheme, string>> = {
  light: "#5b6472",
  dark: "#a3aab5",
};

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** The colour at `position` (0 to 1) along a ramp, blending between its steps. */
export function rampColour(ramp: readonly string[], position: number): string {
  const scaled = Math.min(1, Math.max(0, position)) * (ramp.length - 1);
  const low = Math.floor(scaled);
  const high = Math.min(ramp.length - 1, low + 1);
  const mix = scaled - low;
  const [r1, g1, b1] = hexToRgb(ramp[low] ?? "#000000");
  const [r2, g2, b2] = hexToRgb(ramp[high] ?? "#000000");
  const channel = (a: number, b: number) => Math.round(a + (b - a) * mix);
  return `rgb(${channel(r1, r2)}, ${channel(g1, g2)}, ${channel(b1, b2)})`;
}
