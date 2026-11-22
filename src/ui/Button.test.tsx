import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Download } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { Button, buttonClassName } from "./Button";

describe("buttonClassName", () => {
  it("keeps single-line height and no-wrap by default", () => {
    const classes = buttonClassName({ variant: "secondary", size: "sm" }).split(" ");
    expect(classes).toContain("whitespace-nowrap");
    expect(classes).toContain("h-control-sm");
    expect(classes).not.toContain("whitespace-normal");
    expect(classes).not.toContain("min-h-control-sm");
  });

  it("allows labels to wrap and grow in height when wrap is true", () => {
    for (const [size, minHeight, fixedHeight] of [
      ["sm", "min-h-control-sm", "h-control-sm"],
      ["md", "min-h-control", "h-control"],
      ["lg", "min-h-control-lg", "h-control-lg"],
    ] as const) {
      const classes = buttonClassName({ variant: "ghost", size, wrap: true }).split(" ");
      expect(classes).toContain("whitespace-normal");
      expect(classes).toContain("max-w-full");
      expect(classes).toContain(minHeight);
      expect(classes).not.toContain("whitespace-nowrap");
      expect(classes).not.toContain(fixedHeight);
    }
  });
});

describe("Button", () => {
  it("renders a wrapping button whose leading icon does not shrink and still handles clicks", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn<() => void>();
    render(
      <Button variant="ghost" size="sm" wrap icon={Download} onClick={onClick}>
        Samples with data
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Samples with data" });
    expect(button).toHaveClass("whitespace-normal", "min-h-control-sm");
    expect(button).not.toHaveClass("whitespace-nowrap", "h-control-sm");

    const icon = button.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveClass("shrink-0");

    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
