import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";

function renderDialog(onConfirm: () => void | Promise<void>) {
  render(
    <ConfirmDialog
      trigger={<Button>Remove table</Button>}
      title="Remove the panel table?"
      description="The table and its column choices are removed."
      confirmLabel="Remove table"
      tone="danger"
      onConfirm={onConfirm}
    />,
  );
  return userEvent.setup();
}

describe("ConfirmDialog", () => {
  it("opens from its trigger with focus on Cancel", async () => {
    const user = renderDialog(vi.fn<() => void>());
    await user.click(screen.getByRole("button", { name: "Remove table" }));
    const dialog = screen.getByRole("alertdialog", { name: "Remove the panel table?" });
    expect(dialog).toHaveAccessibleDescription("The table and its column choices are removed.");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("does nothing when cancelled", async () => {
    const onConfirm = vi.fn<() => void>();
    const user = renderDialog(onConfirm);
    await user.click(screen.getByRole("button", { name: "Remove table" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("does nothing when closed with Escape", async () => {
    const onConfirm = vi.fn<() => void>();
    const user = renderDialog(onConfirm);
    await user.click(screen.getByRole("button", { name: "Remove table" }));
    await user.keyboard("{Escape}");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("confirms, waits for the action, then closes", async () => {
    const resolvers: (() => void)[] = [];
    const onConfirm = vi.fn<() => Promise<void>>(
      () => new Promise<void>((resolve) => resolvers.push(resolve)),
    );
    const user = renderDialog(onConfirm);
    await user.click(screen.getByRole("button", { name: "Remove table" }));
    const dialog = screen.getByRole("alertdialog");
    const confirm = screen
      .getAllByRole("button", { name: "Remove table" })
      .find((button) => dialog.contains(button));
    if (confirm === undefined) throw new Error("No confirm button");
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(confirm).toHaveAttribute("aria-busy", "true");
    for (const resolve of resolvers) resolve();
    await screen.findByRole("button", { name: "Remove table" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
