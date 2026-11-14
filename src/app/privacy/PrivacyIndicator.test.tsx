import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { buttonClassName } from "@/ui";

import { PrivacyIndicator } from "./PrivacyIndicator";

describe("PrivacyIndicator", () => {
  it("is the design system's small secondary button", () => {
    render(<PrivacyIndicator />);
    const trigger = screen.getByRole("button", { name: "Your data stays on this device" });
    for (const name of buttonClassName({ variant: "secondary", size: "sm" }).split(" ")) {
      expect(trigger).toHaveClass(name);
    }
  });
});
