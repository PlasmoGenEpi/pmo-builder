import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { Notice } from "@/domain/types";
import type { AppStore } from "@/state";

import { groupNotices } from "./noticeGroups";
import { SectionResult } from "./SectionResult";
import { renderWithStore } from "./testing";

function notice(severity: Notice["severity"], code: string, message: string): Notice {
  return { severity, code, message };
}

const NOTICES: readonly Notice[] = [
  notice("warning", "rows/blank", "Row 3 has no reads."),
  notice("error", "rows/bad-reads", 'Row 4: reads "x" is not a number.'),
  notice("warning", "rows/blank", "Row 9 has no reads."),
  notice("error", "rows/bad-reads", 'Row 5: reads "y" is not a number.'),
  notice("error", "rows/bad-reads", 'Row 6: reads "z" is not a number.'),
  notice("info", "note", "A note."),
];

/** Puts the notices on the microhaplotypes section of the latest build. */
async function showNotices(store: AppStore, phase: "idle" | "pending" = "idle"): Promise<void> {
  await act(() => store.getState().actions.flush());
  const view = store.getState().build.view;
  if (view === null) throw new Error("no build");
  act(() =>
    store.setState({
      build: {
        phase,
        view: {
          ...view,
          sections: {
            ...view.sections,
            microhaplotypes: { status: "error", notices: NOTICES, summary: null },
          },
        },
      },
    }),
  );
}

const SPECIMEN_MISSING: Notice = {
  severity: "error",
  code: "merge/unresolved-names",
  message:
    'These specimen names are in the library sample table but not in the specimen table: "S9".',
  sections: ["librarySamples", "specimens"],
};

/** Puts notices on the whole-draft part of the latest build. */
async function showOverall(store: AppStore, notices: readonly Notice[]): Promise<void> {
  await act(() => store.getState().actions.flush());
  const view = store.getState().build.view;
  if (view === null) throw new Error("no build");
  act(() =>
    store.setState({
      build: { phase: "idle", view: { ...view, overall: { ...view.overall, notices } } },
    }),
  );
}

describe("groupNotices", () => {
  it("groups by kind, errors first, keeping first-seen order", () => {
    const groups = groupNotices(NOTICES);
    expect(groups.map((group) => [group.severity, group.notices.length])).toEqual([
      ["error", 3],
      ["warning", 2],
      ["info", 1],
    ]);
  });
});

describe("SectionResult", () => {
  it("says nothing has been entered before a table is added", async () => {
    const { store } = await renderWithStore(<SectionResult section="microhaplotypes" />);
    await act(() => store.getState().actions.flush());
    expect(screen.getByText(/Nothing here yet/)).toBeInTheDocument();
  });

  it("collapses notices of one kind into one message with a count", async () => {
    const { store } = await renderWithStore(<SectionResult section="microhaplotypes" />);
    await showNotices(store);
    const result = screen.getByRole("region", { name: "Result" });
    expect(within(result).getByText("Has errors")).toBeInTheDocument();
    expect(within(result).getByText("3 similar problems")).toBeInTheDocument();
    expect(within(result).getByText("2 similar warnings")).toBeInTheDocument();
    expect(within(result).getByText("A note.")).toBeInTheDocument();
    expect(within(result).queryByText('Row 6: reads "z" is not a number.')).toBeNull();

    // Errors come before warnings.
    const text = result.textContent ?? "";
    expect(text.indexOf("3 similar problems")).toBeLessThan(text.indexOf("2 similar warnings"));

    await userEvent.click(within(result).getByRole("button", { name: "Show all 3" }));
    expect(within(result).getByText('Row 6: reads "z" is not a number.')).toBeInTheDocument();
    expect(within(result).getByRole("button", { name: "Show fewer" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("shows problems from comparing tables on the section they point at, marked as such", async () => {
    const { store } = await renderWithStore(<SectionResult section="specimens" />);
    await showOverall(store, [
      SPECIMEN_MISSING,
      {
        severity: "error",
        code: "draft/required-section",
        message: "Specimens is needed and is not finished yet.",
        sections: ["specimens"],
      },
      {
        severity: "warning",
        code: "merge/other",
        message: "About the panel.",
        sections: ["panel"],
      },
    ]);
    const cross = screen.getByRole("region", { name: "Found by comparing tables" });
    expect(within(cross).getByText(SPECIMEN_MISSING.message)).toBeInTheDocument();
    // Notices that only restate a status, or point elsewhere, stay off this step.
    expect(screen.queryByText(/is needed and is not finished/)).toBeNull();
    expect(screen.queryByText("About the panel.")).toBeNull();
  });

  it("shows a notice that points at two sections on one page once, beside the first it names", async () => {
    const { store } = await renderWithStore(
      <>
        <SectionResult section="specimens" title="Specimens" />
        <SectionResult section="librarySamples" title="Library samples" />
      </>,
    );
    await showOverall(store, [SPECIMEN_MISSING]);
    expect(screen.getAllByText(SPECIMEN_MISSING.message)).toHaveLength(1);
    const samples = screen.getByRole("region", { name: "Library samples" });
    expect(within(samples).getByText(SPECIMEN_MISSING.message)).toBeInTheDocument();
  });

  it("leaves them out when asked", async () => {
    const { store } = await renderWithStore(
      <SectionResult section="specimens" showCrossSection={false} />,
    );
    await showOverall(store, [SPECIMEN_MISSING]);
    expect(screen.queryByText(SPECIMEN_MISSING.message)).toBeNull();
  });

  it("marks the result as updating while a rebuild is pending, keeping what it showed", async () => {
    const { store } = await renderWithStore(<SectionResult section="microhaplotypes" />);
    await showNotices(store, "pending");
    const result = screen.getByRole("region", { name: "Result" });
    expect(result).toHaveAttribute("aria-busy", "true");
    expect(within(result).getByText("3 similar problems")).toBeInTheDocument();
  });
});
