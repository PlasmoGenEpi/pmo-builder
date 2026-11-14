import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithStore, textFile } from "@/features/shared/testing";

import { ProjectStep } from "./ProjectStep";

async function setup() {
  const user = userEvent.setup();
  const rendered = await renderWithStore(<ProjectStep />);
  await act(() => rendered.store.getState().actions.flush());
  return { ...rendered, user };
}

describe("ProjectStep", () => {
  it("shows one blank form straight away, not an empty list", async () => {
    await setup();
    expect(screen.getByRole("heading", { name: "Your project" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^Project name/ })).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Remove Your project" })).toBeNull();
    expect(screen.getByText(/Nothing here yet\. Fill in the project name/)).toBeInTheDocument();
  });

  it("reaches ready once the name and description are filled in", async () => {
    const { user } = await setup();
    await user.type(screen.getByRole("textbox", { name: /^Project name/ }), "Pf surveillance");
    await user.type(
      screen.getByRole("textbox", { name: /^Description/ }),
      "Malaria surveillance in Mozambique",
    );
    await user.tab();
    expect(await screen.findByText("This part is ready to go into the PMO.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pf surveillance" })).toBeInTheDocument();
    expect(screen.getByText("Complete")).toBeInTheDocument();
  });

  it("names the blank required field when only the name is given", async () => {
    const { user } = await setup();
    await user.type(screen.getByRole("textbox", { name: /^Project name/ }), "Study");
    await user.tab();
    expect(await screen.findByText("Project 1: fill in the description.")).toBeInTheDocument();
    expect(screen.getByText("1 field to fill in")).toBeInTheDocument();
  });

  it("keeps what was typed and the file when switching between the two ways in", async () => {
    const { user, store } = await setup();
    await user.type(screen.getByRole("textbox", { name: /^Project name/ }), "Typed study");
    await user.tab();

    await user.click(screen.getByRole("radio", { name: "From a file" }));
    expect(
      screen.getByText(/What you typed is kept, but only the file goes into the PMO\./),
    ).toBeInTheDocument();
    await user.upload(
      screen.getByLabelText("Choose project table file"),
      textFile("projects.csv", "project_name,project_description\nA,First\nB,Second\n"),
    );
    await screen.findByRole("heading", { name: "Match columns" });
    expect(await screen.findByText("This part is ready to go into the PMO.")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Type it in" }));
    expect(screen.getByRole("textbox", { name: /^Project name/ })).toHaveValue("Typed study");
    expect(
      screen.getByText(/Your file is kept, but only what you type here goes into the PMO\./),
    ).toBeInTheDocument();
    expect(store.getState().draft.project.table?.table.fileName).toBe("projects.csv");

    await user.click(screen.getByRole("radio", { name: "From a file" }));
    expect(screen.getByText("projects.csv")).toBeInTheDocument();
  });
});
