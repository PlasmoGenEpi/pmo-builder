import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Disclosure } from "./Disclosure";

function chevronOf(name: string): Element | null {
  return screen.getByRole("button", { name }).querySelector("svg");
}

describe("Disclosure", () => {
  it("shows each chevron by its own state when one disclosure is inside another", async () => {
    const user = userEvent.setup();
    render(
      <Disclosure title="Panel" defaultOpen>
        <Disclosure title="Optional fields">
          <p>Field list</p>
        </Disclosure>
      </Disclosure>,
    );

    expect(chevronOf("Panel")).toHaveAttribute("data-state", "open");
    expect(chevronOf("Optional fields")).toHaveAttribute("data-state", "closed");
    expect(screen.queryByText("Field list")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Optional fields" }));
    expect(chevronOf("Optional fields")).toHaveAttribute("data-state", "open");
    expect(screen.getByText("Field list")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Panel" }));
    expect(chevronOf("Panel")).toHaveAttribute("data-state", "closed");
  });

  it("follows the open prop when controlled", () => {
    const { rerender } = render(
      <Disclosure title="Extra columns" open={false}>
        <p>Columns</p>
      </Disclosure>,
    );
    expect(chevronOf("Extra columns")).toHaveAttribute("data-state", "closed");
    rerender(
      <Disclosure title="Extra columns" open>
        <p>Columns</p>
      </Disclosure>,
    );
    expect(chevronOf("Extra columns")).toHaveAttribute("data-state", "open");
  });
});
