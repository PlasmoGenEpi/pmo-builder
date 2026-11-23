import { act, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SectionResult } from "./SectionResult";
import { renderWithStore } from "./testing";

describe("SectionResult streaming progress", () => {
  it("renders a ProgressBar for microhaplotypes while reading and hides it when idle", async () => {
    const { store } = await renderWithStore(
      <>
        <SectionResult section="microhaplotypes" title="Allele result" />
        <SectionResult section="specimens" title="Specimens result" />
      </>,
    );
    await act(() => store.getState().actions.flush());

    expect(screen.queryByRole("progressbar")).toBeNull();

    act(() => {
      store.setState({
        progress: {
          phase: "reading",
          stage: "checking",
          bytesRead: 250,
          totalBytes: 1_000,
          rowsRead: 5_000,
        },
      });
    });

    const mhapRegion = screen.getByRole("region", { name: "Allele result" });
    const specimensRegion = screen.getByRole("region", { name: "Specimens result" });
    const bar = within(mhapRegion).getByRole("progressbar", {
      name: "Checking the allele table",
    });
    expect(bar).toHaveAttribute("aria-valuenow", "25");
    expect(within(mhapRegion).getByText("25%")).toBeInTheDocument();
    expect(within(specimensRegion).queryByRole("progressbar")).toBeNull();

    act(() => {
      store.setState({
        progress: {
          phase: "reading",
          stage: "building",
          bytesRead: 750,
          totalBytes: 1_000,
          rowsRead: 15_000,
        },
      });
    });

    const buildingBar = within(mhapRegion).getByRole("progressbar", {
      name: "Building the allele table",
    });
    expect(buildingBar).toHaveAttribute("aria-valuenow", "75");
    expect(within(mhapRegion).getByText("75%")).toBeInTheDocument();

    act(() => {
      store.setState({ progress: { phase: "idle" } });
    });

    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
