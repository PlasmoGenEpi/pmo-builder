import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { describe, expect, it } from "vitest";

import { StepLink } from "./StepLink";

describe("StepLink", () => {
  it("links to a step by its id and navigates through the router", async () => {
    const user = userEvent.setup();
    const location = memoryLocation({ path: "/", record: true });
    render(
      <Router hook={location.hook}>
        <StepLink step="librarySamples" />
        <StepLink step="panel" variant="arrow">
          Fix the panel
        </StepLink>
      </Router>,
    );
    const link = screen.getByRole("link", { name: "Go to Library samples" });
    expect(link).toHaveAttribute("href", "/library-samples");
    await user.click(screen.getByRole("link", { name: "Fix the panel" }));
    expect(location.history).toEqual(["/", "/panel"]);
  });
});
