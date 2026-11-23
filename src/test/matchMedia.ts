import { vi } from "vitest";

/**
 * Stubs `window.matchMedia` for tests that check `(prefers-reduced-motion: reduce)`.
 * Not part of the app bundle.
 */
export function stubMatchMedia(reducedMotion: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn<(query: string) => MediaQueryList>((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" && reducedMotion,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })),
  });
}
