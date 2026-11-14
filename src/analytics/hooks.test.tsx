import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { createAnalytics } from "./analytics";
import { fakeEnvironment } from "./fakeEnvironment";
import { createAnalyticsHooks } from "./hooks";

function setup() {
  const fake = fakeEnvironment({ destination: "https://usage.example.org/" });
  const analytics = createAnalytics(fake.env);
  const hooks = createAnalyticsHooks(analytics);

  function Panel() {
    const status = hooks.useAnalyticsStatus();
    const { enabled, setEnabled } = hooks.useAnalyticsPreference();
    const { entries, pending } = hooks.useTransparencyLog();
    return (
      <div>
        <p>{status.state === "on" ? "Sending" : `Off: ${status.reason}`}</p>
        <label>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(change) => setEnabled(change.target.checked)}
          />
          Share usage counts
        </label>
        <p>{entries.length} records</p>
        <pre>{pending ?? "Nothing pending"}</pre>
      </div>
    );
  }
  render(<Panel />);
  return { analytics, fake };
}

describe("analytics hooks", () => {
  it("show the status and follow the user's switch", async () => {
    setup();
    expect(screen.getByText("Sending")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Share usage counts"));
    expect(screen.getByText("Off: switched-off")).toBeInTheDocument();
    expect(screen.getByLabelText("Share usage counts")).not.toBeChecked();
  });

  it("show the log and the pending record as they change", () => {
    const { analytics } = setup();
    expect(screen.getByText("Nothing pending")).toBeInTheDocument();
    act(() => {
      analytics.start();
      analytics.recordStepOpened("panel");
    });
    expect(screen.getByText("1 records")).toBeInTheDocument();
    expect(screen.getByText(/"steps":\["panel"\]/)).toBeInTheDocument();
  });
});
