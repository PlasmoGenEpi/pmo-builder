import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { TargetSummary } from "@/domain/tools/types";
import { renderWithStore } from "@/features/shared/testing";

import { AlleleBars } from "./AlleleBars";

function allele(options: {
  readonly mhapId: number;
  readonly label: string;
  readonly count: number;
  readonly freq: number;
  readonly seq?: string;
  readonly note?: string | null;
}): TargetSummary["alleles"][number] {
  return {
    mhapId: options.mhapId,
    seq: options.seq ?? `ACGT${options.mhapId}`,
    label: { label: options.label, source: "alignment", note: options.note ?? null },
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

  it("opens and copies a microhaplotype's full sequence from its label", async () => {
    const user = userEvent.setup();
    const fullSeq = "ATGCTAGCTAGCTAGCTAGCTA";
    await renderWithStore(
      <AlleleBars
        target={{
          name: "pfama1",
          samples: 5,
          alleles: [
            allele({
              mhapId: 0,
              label: "C12T",
              seq: fullSeq,
              note: "Compared to 3D7",
              count: 5,
              freq: 1,
            }),
          ],
          heterozygosity: 0,
        }}
      />,
    );

    expect(screen.getByText(/Choose a label to open and copy the whole sequence\./)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "C12T" }));

    const dialog = screen.getByRole("dialog", { name: "Sequence for C12T" });
    expect(within(dialog).getByText(fullSeq)).toBeVisible();
    expect(within(dialog).getByText("Compared to 3D7")).toBeVisible();

    await user.click(within(dialog).getByRole("button", { name: "Copy" }));
    expect(await navigator.clipboard.readText()).toBe(fullSeq);
    expect(within(dialog).getByRole("button", { name: "Copied" })).toBeVisible();
  });
});
