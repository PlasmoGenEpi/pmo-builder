import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { describe, expect, it } from "vitest";

import { NameCheck, listNames } from "./NameCheck";

function renderCheck(known: readonly string[] | null, names: readonly string[] | null = ["P1"]) {
  render(
    <Router hook={memoryLocation({ path: "/" }).hook}>
      <dl>
        <NameCheck
          label="Projects named in this table"
          names={names}
          noneMessage="No project column is matched yet."
          stepId="project"
          known={known}
          emptyMessage={(stepTitle) => `The ${stepTitle} step has no projects yet.`}
          emptyAdvice="Add them there to keep the link."
        />
      </dl>
    </Router>,
  );
}

describe("NameCheck", () => {
  it("says when every name is found, with a link to the step", () => {
    renderCheck(["P1", "P2"]);
    expect(screen.getByText("All found on the Project step.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Project" })).toHaveAttribute(
      "href",
      "/build/project",
    );
  });

  it("lists the names that are missing", () => {
    renderCheck(["P2"], ["P1", "P2", "P3"]);
    expect(screen.getByText("Not on the Project step: P1, P3.")).toBeInTheDocument();
  });

  it("adds the advice when the step has none yet", () => {
    renderCheck(null);
    expect(
      screen.getByText("The Project step has no projects yet. Add them there to keep the link."),
    ).toBeInTheDocument();
  });

  it("says what is missing when the table names none", () => {
    renderCheck(["P1"], []);
    expect(screen.getByText("No project column is matched yet.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("lists names with a count of the rest", () => {
    expect(listNames(["a", "b", "c", "d"], 2)).toBe("a, b and 2 more");
  });
});
