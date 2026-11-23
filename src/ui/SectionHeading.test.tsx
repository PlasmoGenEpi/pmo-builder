import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { stubMatchMedia } from "@/test/matchMedia";

import { SectionHeading, jumpToHeading } from "./SectionHeading";

describe("jumpToHeading", () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
    vi.restoreAllMocks();
  });

  it("scrolls smoothly and focuses the heading without scrolling again when motion is allowed", () => {
    stubMatchMedia(false);
    render(<SectionHeading id="target-section" title="Heterozygosity by target" />);
    const heading = screen.getByRole("heading", { name: "Heterozygosity by target" });
    const scrollIntoView = vi.fn<(arg?: boolean | ScrollIntoViewOptions) => void>();
    heading.scrollIntoView = scrollIntoView;
    const focusSpy = vi.spyOn(heading, "focus");

    jumpToHeading("target-section");

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    expect(heading).toHaveFocus();
  });

  it("uses auto scroll behavior when prefers-reduced-motion is enabled", () => {
    stubMatchMedia(true);
    render(<SectionHeading id="target-section" title="Microhaplotypes by group" />);
    const heading = screen.getByRole("heading", { name: "Microhaplotypes by group" });
    const scrollIntoView = vi.fn<(arg?: boolean | ScrollIntoViewOptions) => void>();
    heading.scrollIntoView = scrollIntoView;

    jumpToHeading("target-section");

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "auto" });
    expect(heading).toHaveFocus();
  });

  it("does nothing when no heading matches the id", () => {
    stubMatchMedia(false);
    expect(() => jumpToHeading("missing-heading")).not.toThrow();
  });
});
