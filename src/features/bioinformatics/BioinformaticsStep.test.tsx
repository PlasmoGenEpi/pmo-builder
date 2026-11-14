import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithStore } from "@/features/shared/testing";

import { BioinformaticsStep } from "./BioinformaticsStep";

async function setup() {
  const user = userEvent.setup();
  const rendered = await renderWithStore(<BioinformaticsStep />);
  await act(() => rendered.store.getState().actions.flush());
  return { ...rendered, user };
}

function card(name: string): HTMLElement {
  const heading = screen.getByRole("heading", { name });
  const article = heading.closest("article");
  if (article === null) throw new Error(`no card for ${name}`);
  return article;
}

type User = ReturnType<typeof userEvent.setup>;

async function fillMethod(user: User, title: string, name: string, program: string) {
  const method = card(title);
  await user.type(within(method).getByRole("textbox", { name: /^Method name/ }), name);
  await user.type(within(method).getByRole("textbox", { name: /^Program/ }), program);
  await user.type(within(method).getByRole("textbox", { name: /^Version/ }), "v1.0.0");
  await user.tab();
}

describe("BioinformaticsStep", () => {
  it("starts with one blank method with one step, and one blank run", async () => {
    await setup();
    expect(screen.getByRole("heading", { name: "Methods" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Method 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Step 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Run 1" })).toBeInTheDocument();
    expect(screen.getByText(/Nothing here yet\. Add a method and a run/)).toBeInTheDocument();
  });

  it("reaches ready with one method of one step and one run, without choosing the method", async () => {
    const { user } = await setup();
    await user.type(screen.getByRole("textbox", { name: /^Program/ }), "dada2");
    await user.type(screen.getByRole("textbox", { name: /^Version/ }), "v1.26.0");
    await user.type(screen.getByRole("textbox", { name: /^Run name/ }), "run1");
    await user.tab();
    expect(screen.getByText("The only method above, so it is used.")).toBeInTheDocument();
    expect(await screen.findByText("This part is ready to go into the PMO.")).toBeInTheDocument();
  });

  it("offers to remove https:// from a program link the PMO format cannot hold", async () => {
    const { user, store } = await setup();
    await user.click(screen.getByRole("button", { name: /Arguments and link/ }));
    const link = screen.getByRole("textbox", { name: /^Program link/ });
    await user.type(link, "https://github.com/benjjneb/dada2");
    await user.tab();
    await user.click(screen.getByRole("button", { name: "Remove https://" }));
    expect(link).toHaveValue("github.com/benjjneb/dada2");
    expect(link).not.toHaveAttribute("aria-invalid");
    const step = store.getState().draft.bioinformatics.methods.records[0]?.steps[0];
    expect(step?.values.program_url).toBe("github.com/benjjneb/dada2");
  });

  it("asks before removing a method a run uses, then asks the run for another", async () => {
    const { user } = await setup();
    await fillMethod(user, "Method 1", "Pipeline A", "dada2");
    await user.click(screen.getByRole("button", { name: "Add a method" }));
    await fillMethod(user, "Method 2", "Pipeline B", "seekdeep");
    await user.type(screen.getByRole("textbox", { name: /^Run name/ }), "run1");
    await user.tab();

    await user.click(within(card("run1")).getByRole("combobox", { name: /^Method/ }));
    await user.click(await screen.findByRole("option", { name: "Pipeline B" }));
    expect(await screen.findByText("This part is ready to go into the PMO.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove Pipeline B" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(/The run run1 uses this method and will need another one\./),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    expect(
      within(card("run1")).getByText("The method this run used was removed. Choose another one."),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        "Run 1: the method chosen for this run is no longer there. Choose its method again.",
      ),
    ).toBeInTheDocument();
  });
});
