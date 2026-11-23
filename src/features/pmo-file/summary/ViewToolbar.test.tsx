import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useState } from "react";
import { describe, expect, it } from "vitest";

import { MinReadsField, SectionJumps } from "./ViewToolbar";

const noop = () => undefined;

function ControlledMinReads({
  initial = null,
  maxReads,
}: {
  readonly initial?: number | null;
  readonly maxReads: number | null;
}) {
  const [value, setValue] = useState<number | null>(initial);
  return <MinReadsField value={value} maxReads={maxReads} onValueChange={setValue} />;
}

describe("MinReadsField", () => {
  it("shows the file's largest read count visibly and describes the input with it", () => {
    render(<MinReadsField value={null} maxReads={1279} onValueChange={noop} />);

    const input = screen.getByLabelText("Minimum reads per microhaplotype");
    const hint = screen.getByText("Leave empty to count them all. The most in this file is 1,279.");

    expect(hint).toBeVisible();
    expect(hint).not.toHaveClass("sr-only");
    expect(input).toHaveAccessibleDescription(
      "Leave empty to count them all. The most in this file is 1,279.",
    );
  });

  it("omits the largest read count when maxReads is null or zero", () => {
    const { rerender } = render(
      <MinReadsField value={null} maxReads={null} onValueChange={noop} />,
    );

    expect(screen.getByText("Leave empty to count them all.")).toBeVisible();
    expect(screen.queryByText(/The most in this file/)).toBeNull();

    rerender(<MinReadsField value={null} maxReads={0} onValueChange={noop} />);
    expect(screen.getByText("Leave empty to count them all.")).toBeVisible();
    expect(screen.queryByText(/The most in this file/)).toBeNull();
  });

  it("offers common cutoffs up to maxReads and sets or clears the input on press", async () => {
    const user = userEvent.setup();
    render(<ControlledMinReads maxReads={1279} />);

    const group = screen.getByRole("group", { name: "Common minimum read counts" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["All", "10", "50", "100", "500"]);

    const allButton = within(group).getByRole("button", { name: "All" });
    const hundredButton = within(group).getByRole("button", { name: "100" });
    const input = screen.getByLabelText("Minimum reads per microhaplotype");

    expect(allButton).toHaveAttribute("aria-pressed", "true");
    expect(hundredButton).toHaveAttribute("aria-pressed", "false");

    await user.click(hundredButton);
    expect(input).toHaveValue("100");
    expect(hundredButton).toHaveAttribute("aria-pressed", "true");
    expect(allButton).toHaveAttribute("aria-pressed", "false");

    // Typing a custom value leaves no preset pressed.
    await user.clear(input);
    await user.type(input, "25");
    expect(input).toHaveValue("25");
    for (const button of buttons) {
      expect(button).toHaveAttribute("aria-pressed", "false");
    }

    // Pressing All clears the input back to empty.
    await user.click(allButton);
    expect(input).toHaveValue("");
    expect(allButton).toHaveAttribute("aria-pressed", "true");
  });

  it("omits cutoffs above the file's largest read count", () => {
    const { rerender } = render(<MinReadsField value={null} maxReads={90} onValueChange={noop} />);

    const group = screen.getByRole("group", { name: "Common minimum read counts" });
    expect(
      within(group)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["All", "10", "50"]);

    // A cutoff equal to maxReads is still offered.
    rerender(<MinReadsField value={null} maxReads={50} onValueChange={noop} />);
    expect(
      within(group)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["All", "10", "50"]);

    // When every common cutoff exceeds maxReads, none are offered.
    rerender(<MinReadsField value={null} maxReads={5} onValueChange={noop} />);
    expect(screen.queryByRole("group", { name: "Common minimum read counts" })).toBeNull();
  });

  it("clears invalid typed text and its error when clicking the already-active cutoff button", async () => {
    const user = userEvent.setup();
    render(<ControlledMinReads maxReads={1279} />);

    const group = screen.getByRole("group", { name: "Common minimum read counts" });
    const allButton = within(group).getByRole("button", { name: "All" });
    const fiftyButton = within(group).getByRole("button", { name: "50" });
    const input = screen.getByLabelText("Minimum reads per microhaplotype");

    expect(input).not.toHaveAttribute("placeholder");

    // With All already active, typing invalid text and pressing All clears both text and error.
    await user.type(input, "abc");
    expect(screen.getByText("Enter a number.")).toBeVisible();
    await user.click(allButton);
    expect(screen.getByLabelText("Minimum reads per microhaplotype")).toHaveValue("");
    expect(screen.queryByText("Enter a number.")).toBeNull();

    // With 50 active, typing invalid text and pressing 50 resets back to 50.
    await user.click(fiftyButton);
    const inputAt50 = screen.getByLabelText("Minimum reads per microhaplotype");
    expect(inputAt50).toHaveValue("50");
    await user.type(inputAt50, "x");
    expect(screen.getByText("Enter a number.")).toBeVisible();
    await user.click(fiftyButton);
    expect(screen.getByLabelText("Minimum reads per microhaplotype")).toHaveValue("50");
    expect(screen.queryByText("Enter a number.")).toBeNull();
  });

  it("forwards inputRef to the numeric input", () => {
    const inputRef = createRef<HTMLInputElement>();
    render(<MinReadsField value={null} maxReads={500} onValueChange={noop} inputRef={inputRef} />);

    expect(inputRef.current).toBe(screen.getByLabelText("Minimum reads per microhaplotype"));
  });
});

describe("SectionJumps", () => {
  it("shows left and right overflow fade overlays as the jump strip scrolls horizontally", () => {
    render(
      <SectionJumps
        jumps={[
          { id: "s1", label: "Reads grid" },
          { id: "s2", label: "Samples" },
          { id: "s3", label: "Targets and alleles" },
          { id: "s4", label: "Pipeline stages" },
        ]}
      />,
    );

    const nav = screen.getByRole("navigation", { name: "On this page" });
    const scrollBox = nav.querySelector("div");
    const leftFade = nav.querySelector('[data-fade="left"]');
    const rightFade = nav.querySelector('[data-fade="right"]');
    if (scrollBox === null || leftFade === null || rightFade === null) {
      throw new Error("Expected scroll container and edge fade elements");
    }

    let scrollLeft = 0;
    Object.defineProperty(scrollBox, "clientWidth", { value: 200, configurable: true });
    Object.defineProperty(scrollBox, "scrollWidth", { value: 420, configurable: true });
    Object.defineProperty(scrollBox, "scrollLeft", {
      get: () => scrollLeft,
      set: (value: number) => {
        scrollLeft = value;
      },
      configurable: true,
    });

    fireEvent.scroll(scrollBox);
    expect(leftFade).toHaveAttribute("data-state", "hidden");
    expect(rightFade).toHaveAttribute("data-state", "visible");

    scrollLeft = 80;
    fireEvent.scroll(scrollBox);
    expect(leftFade).toHaveAttribute("data-state", "visible");
    expect(rightFade).toHaveAttribute("data-state", "visible");

    scrollLeft = 220;
    fireEvent.scroll(scrollBox);
    expect(leftFade).toHaveAttribute("data-state", "visible");
    expect(rightFade).toHaveAttribute("data-state", "hidden");
  });
});
