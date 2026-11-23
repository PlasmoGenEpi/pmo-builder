import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { summarisePmo } from "@/domain/build/merge";
import { richPmo } from "@/domain/tools/testing";
import { choicesOf } from "@/domain/tools/workingPmo";
import { renderWithStore } from "@/features/shared/testing";

import { SubsetPanel } from "./SubsetPanel";

function makeChoicesAndSummary() {
  const base = richPmo();
  const pmo = {
    ...base,
    specimen_info: [
      {
        ...base.specimen_info[0],
        specimen_name: "spec1",
        collection_country: "Mozambique",
        geo_admin1: "Maputo",
        collection_date: "2019-01",
      },
      {
        ...base.specimen_info[1],
        specimen_name: "spec2",
        collection_country: "Ghana",
        geo_admin1: "Gaza",
        collection_date: "2020-02",
      },
      {
        ...base.specimen_info[2],
        specimen_name: "neg",
        collection_country: "Kenya",
        geo_admin1: "Nairobi",
        collection_date: "2021-03",
      },
    ],
  };
  return { choices: choicesOf(pmo), original: summarisePmo(pmo) };
}

describe("SubsetPanel", () => {
  it("restores focus cleanly when removing metadata conditions instead of dropping to document.body", async () => {
    const { choices, original } = makeChoicesAndSummary();
    const user = userEvent.setup();
    await renderWithStore(
      <SubsetPanel
        choices={choices}
        original={original}
        onShowSummary={() => undefined}
        onShowTables={() => undefined}
        onPublish={null}
      />,
    );

    await user.click(screen.getByRole("radio", { name: /Specimens with certain values/ }));
    await user.click(screen.getByRole("button", { name: "Add a condition" }));
    await user.click(screen.getByRole("button", { name: "Add a condition" }));

    const removeButtons = screen.getAllByRole("button", { name: /^Remove the condition on / });
    expect(removeButtons).toHaveLength(3);
    const secondRemove = removeButtons[1];
    const thirdRemove = removeButtons[2];
    if (secondRemove === undefined || thirdRemove === undefined) {
      throw new Error("expected three remove condition buttons");
    }

    // Removing the middle condition moves focus to the next condition's remove button.
    await user.click(secondRemove);
    expect(document.activeElement).not.toBe(document.body);
    expect(thirdRemove).toHaveFocus();

    // Removing the second of the two remaining conditions focuses the remaining Field selector.
    await user.click(thirdRemove);
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByRole("combobox", { name: "Field" })).toHaveFocus();
  });

  it("places Specimens and Targets tick checklists inside distinct named section regions", async () => {
    const { choices, original } = makeChoicesAndSummary();
    const user = userEvent.setup();
    await renderWithStore(
      <SubsetPanel
        choices={choices}
        original={original}
        onShowSummary={() => undefined}
        onShowTables={() => undefined}
        onPublish={null}
      />,
    );

    await user.click(screen.getByRole("radio", { name: "Specimens I tick" }));
    await user.click(screen.getByRole("radio", { name: /Targets I tick/ }));

    const specimensRegion = screen.getByRole("region", { name: "Specimens" });
    const targetsRegion = screen.getByRole("region", { name: "Targets" });
    expect(within(specimensRegion).getByRole("button", { name: "Tick all" })).toBeInTheDocument();
    expect(within(targetsRegion).getByRole("button", { name: "Tick all" })).toBeInTheDocument();
  });
});
