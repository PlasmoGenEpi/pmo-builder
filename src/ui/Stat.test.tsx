import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Stat } from "./Stat";

describe("Stat", () => {
  it("renders a static readout when no click handler is given", () => {
    render(<Stat label="Samples with data" value={12431} hint="98% of 12,684 library samples" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Samples with data")).toBeVisible();
    expect(screen.getByText("12,431")).toBeVisible();
    expect(screen.getByText("98% of 12,684 library samples")).toBeVisible();
  });

  it("renders a button tile with direct child spans when onClick is given", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn<() => void>();
    render(
      <Stat
        label="Samples with data"
        value={49}
        hint="98% of 50 library samples"
        onClick={onClick}
      />,
    );

    const tile = screen.getByRole("button", { name: /Samples with data/ });
    expect(tile).toHaveAttribute("type", "button");
    // Label, value and hint sit directly inside the tile element.
    expect(screen.getByText("Samples with data").parentElement).toBe(tile);
    expect(screen.getByText("49").parentElement).toBe(tile);
    expect(screen.getByText("98% of 50 library samples").parentElement).toBe(tile);

    await user.click(tile);
    expect(onClick).toHaveBeenCalledTimes(1);

    tile.focus();
    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});
