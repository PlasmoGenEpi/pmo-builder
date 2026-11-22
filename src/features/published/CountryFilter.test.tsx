import { I18nProvider } from "@lingui/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { i18n } from "@/i18n";
import { installDomPolyfills } from "@/ui/testPolyfills";

import { CountryFilter } from "./CountryFilter";

beforeAll(installDomPolyfills);

function Wrapper({ children }: { readonly children: ReactNode }) {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

const COUNTRIES = ["Eswatini", "Kenya", "Mozambique", "Uganda"];
const COUNTS = new Map<string, number>([
  ["Eswatini", 1],
  ["Kenya", 12],
  ["Mozambique", 2],
  ["Uganda", 0],
]);

const EMPTY: readonly string[] = [];

function Controlled({ initial = EMPTY }: { readonly initial?: readonly string[] }) {
  const [selected, setSelected] = useState<readonly string[]>(initial);
  return (
    <CountryFilter
      countries={COUNTRIES}
      selected={selected}
      counts={COUNTS}
      onChange={setSelected}
    />
  );
}

describe("CountryFilter", () => {
  it("shows counts per country and allows choosing and clearing several countries", async () => {
    const user = userEvent.setup();
    render(<Controlled />, { wrapper: Wrapper });

    const trigger = screen.getByRole("button", { name: "Country: Any country" });
    expect(trigger).toHaveTextContent("Any country");

    await user.click(trigger);
    const kenya = await screen.findByRole("checkbox", { name: "Kenya (12)" });
    const uganda = screen.getByRole("checkbox", { name: "Uganda (0)" });
    expect(kenya).not.toBeChecked();
    expect(uganda).not.toBeChecked();

    await user.click(kenya);
    expect(screen.getByRole("button", { name: "Country: Kenya" })).toHaveTextContent("Kenya");

    await user.click(screen.getByRole("checkbox", { name: "Mozambique (2)" }));
    expect(screen.getByRole("button", { name: "Country: 2 countries" })).toHaveTextContent(
      "2 countries",
    );

    await user.click(screen.getByRole("button", { name: "Clear countries" }));
    expect(screen.getByRole("button", { name: "Country: Any country" })).toBeInTheDocument();
  });

  it("filters the list of countries inside the popover and reports when none match", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(countries: readonly string[]) => void>();
    render(
      <CountryFilter countries={COUNTRIES} selected={[]} counts={COUNTS} onChange={onChange} />,
      { wrapper: Wrapper },
    );

    await user.click(screen.getByRole("button", { name: "Country: Any country" }));
    const search = await screen.findByRole("searchbox", { name: "Filter countries" });
    await user.type(search, "moz");

    expect(screen.getByRole("checkbox", { name: "Mozambique (2)" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Kenya (12)" })).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "zzzz");
    expect(screen.getByText("No matching country")).toBeInTheDocument();
  });
});
