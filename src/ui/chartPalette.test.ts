import { describe, expect, it } from "vitest";

import { SEQUENTIAL_CELL, rampColour, type ChartTheme } from "@/ui";

function srgbToLinear(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of an sRGB colour per WCAG 2.x. */
function relativeLuminance([r, g, b]: readonly [number, number, number]): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** Parses `rgb(r, g, b)` or `#rrggbb` into RGB channels. */
function parseColour(colour: string): [number, number, number] {
  if (colour.startsWith("#")) {
    const value = Number.parseInt(colour.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }
  const match = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/.exec(colour);
  if (match === null) throw new Error(`Unexpected colour format: ${colour}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** WCAG 2.x contrast ratio between two colours. */
function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(parseColour(a));
  const lb = relativeLuminance(parseColour(b));
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** `--c-text` and `--c-surface` tokens from `src/styles/themes.css`. */
const THEME_TOKENS: Readonly<
  Record<ChartTheme, { readonly text: string; readonly surface: string }>
> = {
  light: { text: "#171a21", surface: "#ffffff" },
  dark: { text: "#eceef2", surface: "#15181d" },
};

describe("SEQUENTIAL_CELL", () => {
  it.each(["light", "dark"] as const)(
    "keeps WCAG AA (>= 4.5:1) contrast against body text at every point in [0, 1] in the %s theme",
    (theme) => {
      const ramp = SEQUENTIAL_CELL[theme];
      const { text } = THEME_TOKENS[theme];
      for (let step = 0; step <= 20; step += 1) {
        const position = step / 20;
        const background = rampColour(ramp, position);
        expect(contrastRatio(text, background)).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it("moves monotonically away from the surface colour as value increases from 0 to 1", () => {
    const lightSurfaceLum = relativeLuminance(parseColour(THEME_TOKENS.light.surface));
    const lightSamples = [0, 0.25, 0.5, 0.75, 1].map((value) =>
      relativeLuminance(parseColour(rampColour(SEQUENTIAL_CELL.light, value))),
    );
    expect(lightSamples[0]).toBeLessThan(lightSurfaceLum);
    for (let i = 1; i < lightSamples.length; i += 1) {
      expect(lightSamples[i]).toBeLessThan(lightSamples[i - 1] ?? 0);
    }

    const darkSurfaceLum = relativeLuminance(parseColour(THEME_TOKENS.dark.surface));
    const darkSamples = [0, 0.25, 0.5, 0.75, 1].map((value) =>
      relativeLuminance(parseColour(rampColour(SEQUENTIAL_CELL.dark, value))),
    );
    expect(darkSamples[0]).toBeGreaterThan(darkSurfaceLum);
    for (let i = 1; i < darkSamples.length; i += 1) {
      expect(darkSamples[i]).toBeGreaterThan(darkSamples[i - 1] ?? 0);
    }
  });
});
