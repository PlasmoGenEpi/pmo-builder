import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { TargetSummary } from "@/domain/tools/types";
import { renderWithStore } from "@/features/shared/testing";

import { AlleleBars } from "./AlleleBars";

function allele(options: {
  readonly mhapId: number;
  readonly label: string;
  readonly count: number;
  readonly freq: number;
}): TargetSummary["alleles"][number] {
  return {
    mhapId: options.mhapId,
    seq: `ACGT${options.mhapId}`,
    label: { label: options.label, source: "alignment", note: null },
    count: options.count,
    freq: options.freq,
  };
}

describe("AlleleBars", () => {
  it("explains when no microhaplotypes were counted at a target", async () => {
    await renderWithStore(
      <AlleleBars target={{ name: "pfama1", samples: 0, alleles: [], heterozygosity: null }} />,
    );
    expect(screen.getByText("No microhaplotypes were counted at pfama1.")).toBeVisible();
  });

  it("shows each allele's share and count, capping the list at 20 bars", async () => {
    const alleles = Array.from({ length: 22 }, (_, index) =>
      allele({
        mhapId: index,
        label: index === 0 ? "Most common" : index === 1 ? "" : `A${index}G`,
        count: 22 - index,
        freq: (22 - index) / 253,
      }),
    );
    await renderWithStore(
      <AlleleBars target={{ name: "pfama1", samples: 22, alleles, heterozygosity: 0.9 }} />,
    );

    expect(screen.getByText("Microhaplotypes at pfama1, seen in 22 samples")).toBeVisible();
    const figure = screen.getByRole("figure");
    const items = within(figure).getAllByRole("listitem");
    expect(items).toHaveLength(20);
    const [first, second] = items;
    if (first === undefined || second === undefined) throw new Error("Expected at least two items");
    expect(within(first).getByText("Most common")).toBeVisible();
    expect(within(first).getByText("8.7% (22 samples)")).toBeVisible();
    expect(within(second).getByText("#1")).toBeVisible();
    expect(screen.getByText("2 rarer microhaplotypes are not drawn.")).toBeVisible();
  });
});
