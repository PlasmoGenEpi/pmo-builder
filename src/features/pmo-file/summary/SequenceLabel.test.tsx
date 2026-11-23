import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithStore } from "@/features/shared/testing";

import { SequenceLabel } from "./SequenceLabel";

describe("SequenceLabel", () => {
  it("opens the full selectable sequence and copies it to the clipboard", async () => {
    const user = userEvent.setup();
    const seq = "ACGTACGTACGTACGTACGT";
    await renderWithStore(
      <SequenceLabel label="C12T" seq={seq} note="Generated from reference genome" />,
    );

    expect(screen.queryByText(seq)).not.toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: "C12T" });
    expect(trigger).toHaveAttribute("title", `${seq}\nGenerated from reference genome`);

    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Sequence for C12T" });
    expect(dialog).toBeVisible();
    const sequenceRegion = within(dialog).getByRole("region", { name: "Sequence" });
    expect(sequenceRegion).toHaveAttribute("tabindex", "0");
    const sequenceNode = within(sequenceRegion).getByText(seq);
    expect(sequenceNode).toBeVisible();
    expect(sequenceNode.className).toContain("select-all");
    expect(within(dialog).getByText("Generated from reference genome")).toBeVisible();
    expect(within(dialog).getByText("20 bases")).toBeVisible();

    await user.click(within(dialog).getByRole("button", { name: "Copy" }));

    expect(await navigator.clipboard.readText()).toBe(seq);
    expect(within(dialog).getByRole("button", { name: "Copied" })).toBeVisible();
    expect(within(dialog).getByRole("status")).toHaveTextContent("Sequence copied to clipboard.");
  });

  it("opens and copies from the keyboard and closes on Escape", async () => {
    const user = userEvent.setup();
    const seq = "TTGGCCAATTGG";
    await renderWithStore(<SequenceLabel label="most common" seq={seq} />);

    const trigger = screen.getByRole("button", { name: "most common" });
    expect(trigger).toHaveAttribute("title", seq);

    trigger.focus();
    await user.keyboard("{Enter}");

    const dialog = screen.getByRole("dialog", { name: "Sequence for most common" });
    expect(dialog).toBeVisible();
    expect(within(dialog).getByText(seq)).toBeVisible();

    const copyButton = within(dialog).getByRole("button", { name: "Copy" });
    copyButton.focus();
    await user.keyboard(" ");

    expect(await navigator.clipboard.readText()).toBe(seq);
    expect(within(dialog).getByRole("button", { name: "Copied" })).toBeVisible();

    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: "Sequence for most common" }),
    ).not.toBeInTheDocument();
  });

  it("tells the user how to copy when clipboard access fails", async () => {
    const user = userEvent.setup();
    const seq = "AACCGGTT";
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("Denied"));

    await renderWithStore(<SequenceLabel label="A1T" seq={seq} />);
    await user.click(screen.getByRole("button", { name: "A1T" }));

    const dialog = screen.getByRole("dialog", { name: "Sequence for A1T" });
    await user.click(within(dialog).getByRole("button", { name: "Copy" }));

    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "Could not copy. Select the sequence to copy it.",
    );
  });
});
