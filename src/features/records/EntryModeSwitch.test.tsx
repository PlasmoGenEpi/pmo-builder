import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type { EntryMode } from "@/domain/draft";
import { renderWithStore } from "@/features/shared/testing";
import { TextField } from "@/ui";

import { EntryModeSwitch } from "./EntryModeSwitch";

/** Both sides keep their own state above the switch, as the draft does. */
function Harness() {
  const [mode, setMode] = useState<EntryMode>("manual");
  const [typed, setTyped] = useState("");
  const [file, setFile] = useState("");
  return (
    <EntryModeSwitch
      label="How to enter things"
      mode={mode}
      onModeChange={setMode}
      manualHasContent={typed !== ""}
      tableHasContent={file !== ""}
      manual={<TextField label="Typed" value={typed} onChange={(e) => setTyped(e.target.value)} />}
      table={<TextField label="File" value={file} onChange={(e) => setFile(e.target.value)} />}
    />
  );
}

describe("EntryModeSwitch", () => {
  it("shows one side at a time, keeps both, and says the other is kept", async () => {
    const user = userEvent.setup();
    await renderWithStore(<Harness />);
    await user.type(screen.getByRole("textbox", { name: "Typed" }), "abc");
    await user.click(screen.getByRole("radio", { name: "From a file" }));
    expect(screen.queryByRole("textbox", { name: "Typed" })).toBeNull();
    expect(
      screen.getByText("What you typed is kept, but only the file goes into the PMO."),
    ).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "File" }), "f.csv");
    await user.click(screen.getByRole("radio", { name: "Type it in" }));
    expect(screen.getByRole("textbox", { name: "Typed" })).toHaveValue("abc");
    expect(
      screen.getByText("Your file is kept, but only what you type here goes into the PMO."),
    ).toBeInTheDocument();
  });
});
