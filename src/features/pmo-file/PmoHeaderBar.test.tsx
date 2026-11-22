import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PmoHeaderBar } from "./PmoHeaderBar";

describe("PmoHeaderBar", () => {
  it("renders a working PMO file name as the h1 with size and actions in one header", () => {
    render(
      <PmoHeaderBar
        title="study.pmo.json.gz"
        titleTooltip="study.pmo.json.gz"
        monoTitle
        meta="42 KB"
        actions={<button type="button">Replace</button>}
      />,
    );
    const heading = screen.getByRole("heading", { level: 1, name: "study.pmo.json.gz" });
    expect(heading).toHaveAttribute("title", "study.pmo.json.gz");
    const bar = heading.closest("header");
    expect(bar).not.toBeNull();
    if (bar === null) return;
    expect(within(bar).getByText("42 KB")).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Replace" })).toBeInTheDocument();
  });

  it("supports a non-monospace title, subtitle and alert message for published or error states", () => {
    render(
      <PmoHeaderBar
        title="Malaria surveillance in Mozambique"
        subtitle="A. Silva, B. Costa"
        tone="error"
        error="Could not read the replacement file."
        actions={<a href="#/published/123">Dataset page</a>}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Malaria surveillance in Mozambique" }),
    ).toBeInTheDocument();
    expect(screen.getByText("A. Silva, B. Costa")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dataset page" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not read the replacement file.");
  });
});
