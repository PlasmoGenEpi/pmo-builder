import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { Select } from "./Select";
import { installDomPolyfills } from "./testPolyfills";

beforeAll(() => {
  installDomPolyfills();
});

const OPTIONS = [
  { value: "country", label: "Country" },
  { value: "year", label: "Collection year" },
] as const;

describe("Select", () => {
  it("uses the standard control height by default", () => {
    render(
      <Select
        aria-label="Group specimens by"
        options={OPTIONS}
        value="country"
        onValueChange={vi.fn<(value: string) => void>()}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Group specimens by" });
    expect(trigger).toHaveClass("h-control", "text-base");
    expect(trigger).not.toHaveClass("h-control-sm");
  });

  it("uses the compact control height when size is sm", () => {
    render(
      <Select
        aria-label="Group specimens by"
        size="sm"
        options={OPTIONS}
        value="country"
        onValueChange={vi.fn<(value: string) => void>()}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Group specimens by" });
    expect(trigger).toHaveClass("h-control-sm", "text-sm");
    expect(trigger).not.toHaveClass("h-control");
  });
});
