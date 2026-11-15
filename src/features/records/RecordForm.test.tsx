import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PROJECT_FORM_FIELDS } from "@/domain/draft";
import { renderWithStore } from "@/features/shared/testing";
import { useActions, useDraftSection, type AppStore } from "@/state";

import { splitOneLineList } from "./checks";
import { RecordForm } from "./RecordForm";

/** The first project record of the draft, in a record form. */
function FirstProject() {
  const { records } = useDraftSection("project");
  const actions = useActions();
  const record = records[0];
  if (record === undefined) return null;
  return (
    <RecordForm
      fields={PROJECT_FORM_FIELDS}
      values={record.values}
      onValueChange={(key, value) =>
        actions.setValue({ list: "projects", id: record.id, key, value })
      }
      fixes={{ project_contributors: splitOneLineList }}
      extra={{
        entries: record.extra,
        onUpdate: (recipe) =>
          actions.updateItem({
            list: "projects",
            id: record.id,
            recipe: (current) => ({ ...current, extra: recipe(current.extra) }),
          }),
      }}
    />
  );
}

function firstRecord(store: AppStore) {
  const record = store.getState().draft.project.records[0];
  if (record === undefined) throw new Error("no record");
  return record;
}

async function setup() {
  const user = userEvent.setup();
  const rendered = await renderWithStore(<FirstProject />);
  return { ...rendered, user };
}

describe("RecordForm", () => {
  it("shows required fields first and keeps optional ones collapsed", async () => {
    const { user } = await setup();
    expect(screen.getByRole("textbox", { name: /^Project name/ })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^Description/ })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /^BioProject accession/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: /More details/ }));
    expect(screen.getByRole("textbox", { name: /^BioProject accession/ })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^Contributors/ })).toBeInTheDocument();
  });

  it("says a required field is blank once it is left, and checks the format", async () => {
    const { user } = await setup();
    const name = screen.getByRole("textbox", { name: /^Project name/ });
    await user.click(name);
    await user.tab();
    expect(screen.getByText("Fill in “Project name”. The PMO needs it.")).toBeInTheDocument();
    expect(name).toHaveAttribute("aria-invalid", "true");

    await user.type(name, "My study: 2024");
    await user.tab();
    expect(
      screen.getByText(/can only hold letters, numbers, spaces and \. _ -/),
    ).toBeInTheDocument();

    await user.clear(name);
    await user.type(name, "My study 2024");
    expect(name).not.toHaveAttribute("aria-invalid");
  });

  it("keeps keystrokes local and commits on blur", async () => {
    const { user, store } = await setup();
    const name = screen.getByRole("textbox", { name: /^Project name/ });
    await user.type(name, "Study");
    expect(name).toHaveValue("Study");
    expect(firstRecord(store).values.project_name).toBe("");
    await user.tab();
    expect(firstRecord(store).values.project_name).toBe("Study");
  });

  it("commits after a pause, and on unmount without losing the last keystroke", async () => {
    const { user, store, unmount } = await setup();
    const description = screen.getByRole("textbox", { name: /^Description/ });
    await user.type(description, "Survey");
    await waitFor(() => expect(firstRecord(store).values.project_description).toBe("Survey"));
    await user.type(description, "s");
    unmount();
    expect(firstRecord(store).values.project_description).toBe("Surveys");
  });

  it("adds other details as name and value pairs, and flags a name used by a field", async () => {
    const { user, store } = await setup();
    await user.click(screen.getByRole("button", { name: /More details/ }));
    await user.click(screen.getByRole("button", { name: "Add a detail" }));
    await user.type(screen.getByRole("textbox", { name: "Name of detail 1" }), "funding");
    await user.type(screen.getByRole("textbox", { name: "Value of detail 1" }), "Grant 12");
    await user.tab();
    expect(firstRecord(store).extra).toMatchObject([{ key: "funding", value: "Grant 12" }]);

    const key = screen.getByRole("textbox", { name: "Name of detail 1" });
    await user.clear(key);
    await user.type(key, "project_type");
    await user.tab();
    expect(
      screen.getByText('"project_type" is already a field above. Fill in that field instead.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove detail 1" }));
    expect(firstRecord(store).extra).toEqual([]);
  });

  it("offers to put contributors typed on one line on their own lines", async () => {
    const { user, store } = await setup();
    await user.click(screen.getByRole("button", { name: /More details/ }));
    const contributors = screen.getByRole("textbox", { name: /^Contributors/ });
    await user.type(contributors, "Jane Doe, John Smith");
    await user.tab();
    await user.click(screen.getByRole("button", { name: "Put each one on its own line" }));
    expect(firstRecord(store).values.project_contributors).toBe("Jane Doe\nJohn Smith");
  });
});
