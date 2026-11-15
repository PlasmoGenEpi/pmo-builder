import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { Combobox, type ComboboxOption } from "./Combobox";
import { Field } from "./Field";
import { installDomPolyfills } from "./testPolyfills";

beforeAll(installDomPolyfills);

const OPTIONS: ComboboxOption[] = [
  { value: "SampleID", label: "SampleID", description: "example_sample_47" },
  { value: "Locus", label: "Locus", description: "Pf3D7_01_v3-145388" },
  { value: "ASV", label: "ASV", description: "GATATGTTTAAATAT" },
  { value: "Reads", label: "Reads", description: "13" },
];

function Harness({
  initial = null,
  onChange,
}: {
  initial?: string | null;
  onChange: (value: string | null) => void;
}) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <Field label="Target name" hint="The column that names each target.">
      <Combobox
        options={OPTIONS}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
    </Field>
  );
}

function setup(initial: string | null = null) {
  const onChange = vi.fn<(value: string | null) => void>();
  const user = userEvent.setup();
  render(<Harness initial={initial} onChange={onChange} />);
  const input = screen.getByRole("combobox", { name: "Target name" });
  return { user, input, onChange };
}

describe("Combobox", () => {
  it("is labelled by its field and described by the hint", () => {
    const { input } = setup();
    expect(input).toHaveAccessibleDescription("The column that names each target.");
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("opens with the arrow key, moves with arrows and chooses with Enter", async () => {
    const { user, input, onChange } = setup();
    await user.click(input);
    await user.keyboard("{Escape}");
    expect(input).toHaveAttribute("aria-expanded", "false");

    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-expanded", "true");
    const listbox = screen.getByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "(current choice)None",
      "SampleIDexample_sample_47",
      "LocusPf3D7_01_v3-145388",
      "ASVGATATGTTTAAATAT",
      "Reads13",
    ]);
    // Starts on the current choice, "None".
    expect(input).toHaveAttribute("aria-activedescendant", options[0]?.id);

    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", options[2]?.id);
    expect(options[2]).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("Locus");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveValue("Locus");
  });

  it("filters by label and secondary text, and keeps None at the top", async () => {
    const { user, input, onChange } = setup();
    await user.type(input, "gatat");
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent("None");
    expect(options[1]).toHaveTextContent("ASV");
    expect(screen.getByText("1 match")).toBeInTheDocument();

    // The first real match is active, so Enter picks it.
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("ASV");
  });

  it("says when nothing matches", async () => {
    const { user, input } = setup();
    await user.type(input, "zzz");
    expect(screen.getByText("Nothing matches your search.")).toBeInTheDocument();
  });

  it("chooses None to clear the value, by keyboard and by mouse", async () => {
    const { user, input, onChange } = setup("Reads");
    expect(input).toHaveValue("Reads");

    await user.click(input);
    await user.keyboard("{PageUp}{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("placeholder", "None");

    await user.click(input);
    await user.click(screen.getByRole("option", { name: /SampleID/ }));
    expect(onChange).toHaveBeenLastCalledWith("SampleID");
    await user.click(input);
    await user.click(screen.getByRole("option", { name: /None/ }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("closes on Escape without changing the value", async () => {
    const { user, input, onChange } = setup("Locus");
    await user.click(input);
    await user.keyboard("{ArrowDown}{Escape}");
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue("Locus");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
