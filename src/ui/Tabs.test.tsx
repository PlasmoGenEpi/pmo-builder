import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { Tabs, type TabItem } from "./Tabs";
import { installDomPolyfills } from "./testPolyfills";

let resizeCallbacks: ResizeObserverCallback[] = [];

class CapturingResizeObserver {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(): void {
    resizeCallbacks.push(this.callback);
  }
  unobserve(): void {}
  disconnect(): void {
    resizeCallbacks = resizeCallbacks.filter((entry) => entry !== this.callback);
  }
}

function triggerResize(): void {
  act(() => {
    for (const callback of resizeCallbacks) {
      callback([], new CapturingResizeObserver(() => {}));
    }
  });
}

beforeAll(() => {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: CapturingResizeObserver,
  });
  installDomPolyfills();
});

afterEach(() => {
  resizeCallbacks = [];
});

const SAMPLE_TABS: readonly TabItem[] = [
  { value: "overview", label: "Overview", content: <p>Overview panel</p> },
  { value: "summary", label: "Summary", content: <p>Summary panel</p> },
  { value: "compare", label: "Compare", content: <p>Compare panel</p> },
  { value: "tables", label: "Tables", content: <p>Tables panel</p> },
  { value: "subset", label: "Subset", content: <p>Subset panel</p> },
  { value: "publish", label: "Publish to Zenodo", content: <p>Publish panel</p> },
];

/** Sets jsdom layout metrics on the scrollable tab list. */
function setScrollMetrics(
  element: HTMLElement,
  metrics: {
    readonly clientWidth: number;
    readonly scrollWidth: number;
    readonly scrollLeft: number;
  },
): void {
  Object.defineProperty(element, "clientWidth", {
    configurable: true,
    value: metrics.clientWidth,
  });
  Object.defineProperty(element, "scrollWidth", {
    configurable: true,
    value: metrics.scrollWidth,
  });
  Object.defineProperty(element, "scrollLeft", {
    configurable: true,
    writable: true,
    value: metrics.scrollLeft,
  });
}

function fadeOf(container: HTMLElement, edge: "left" | "right"): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-fade="${edge}"]`);
}

describe("Tabs", () => {
  it("shows no edge fades when all tabs fit", () => {
    const { container } = render(<Tabs label="Views" tabs={SAMPLE_TABS} />);
    const list = screen.getByRole("tablist", { name: "Views" });
    setScrollMetrics(list, { clientWidth: 600, scrollWidth: 500, scrollLeft: 0 });
    fireEvent.scroll(list);

    expect(fadeOf(container, "left")).toHaveAttribute("data-state", "hidden");
    expect(fadeOf(container, "right")).toHaveAttribute("data-state", "hidden");
  });

  it("shows a fade only on edges with more tabs as the strip scrolls", () => {
    const { container } = render(<Tabs label="Views" tabs={SAMPLE_TABS} />);
    const list = screen.getByRole("tablist", { name: "Views" });

    // Start of overflowing strip: right fade visible, left hidden.
    setScrollMetrics(list, { clientWidth: 358, scrollWidth: 557, scrollLeft: 0 });
    fireEvent.scroll(list);
    expect(fadeOf(container, "left")).toHaveAttribute("data-state", "hidden");
    expect(fadeOf(container, "right")).toHaveAttribute("data-state", "visible");

    // Middle of strip: both fades visible.
    setScrollMetrics(list, { clientWidth: 358, scrollWidth: 557, scrollLeft: 100 });
    fireEvent.scroll(list);
    expect(fadeOf(container, "left")).toHaveAttribute("data-state", "visible");
    expect(fadeOf(container, "right")).toHaveAttribute("data-state", "visible");

    // End of strip: left fade visible, right cleared.
    setScrollMetrics(list, { clientWidth: 358, scrollWidth: 557, scrollLeft: 199 });
    fireEvent.scroll(list);
    expect(fadeOf(container, "left")).toHaveAttribute("data-state", "visible");
    expect(fadeOf(container, "right")).toHaveAttribute("data-state", "hidden");
  });

  it("updates the fades when the strip resizes", () => {
    const { container } = render(<Tabs label="Views" tabs={SAMPLE_TABS} />);
    const list = screen.getByRole("tablist", { name: "Views" });

    // Narrow viewport: overflows to the right.
    setScrollMetrics(list, { clientWidth: 358, scrollWidth: 557, scrollLeft: 0 });
    triggerResize();
    expect(fadeOf(container, "right")).toHaveAttribute("data-state", "visible");

    // Widen viewport so all tabs fit: right fade clears.
    setScrollMetrics(list, { clientWidth: 700, scrollWidth: 557, scrollLeft: 0 });
    triggerResize();
    expect(fadeOf(container, "right")).toHaveAttribute("data-state", "hidden");
    expect(fadeOf(container, "left")).toHaveAttribute("data-state", "hidden");
  });

  it("keeps the fades decorative, non-blocking, and motion-safe while tabs switch", async () => {
    const user = userEvent.setup();
    const { container } = render(<Tabs label="Views" tabs={SAMPLE_TABS} />);

    for (const edge of ["left", "right"] as const) {
      const fade = fadeOf(container, edge);
      expect(fade).toHaveAttribute("aria-hidden", "true");
      expect(fade).toHaveClass("pointer-events-none");
      expect(fade).toHaveClass("motion-reduce:transition-none");
    }

    await user.click(screen.getByRole("tab", { name: "Publish to Zenodo" }));
    expect(screen.getByRole("tab", { name: "Publish to Zenodo" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Publish panel")).toBeVisible();
  });
});
