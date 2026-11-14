/**
 * Browser APIs that jsdom lacks but Radix and the primitives use. Test files
 * call this once at the top. Not part of the app bundle.
 */
export function installDomPolyfills(): void {
  if (!("ResizeObserver" in globalThis)) {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    Object.defineProperty(globalThis, "ResizeObserver", { value: ResizeObserverStub });
  }
  const proto = Element.prototype;
  if (typeof proto.scrollIntoView !== "function") proto.scrollIntoView = () => {};
  if (typeof proto.hasPointerCapture !== "function") proto.hasPointerCapture = () => false;
  if (typeof proto.releasePointerCapture !== "function") proto.releasePointerCapture = () => {};
  window.scrollTo = () => {};
  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string): MediaQueryList => {
        const list: MediaQueryList = {
          matches: false,
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        };
        return list;
      },
    });
  }
}
