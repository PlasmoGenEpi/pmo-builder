import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as analytics from "@/analytics";
import { ToastProvider } from "@/ui";
import { installDomPolyfills } from "@/ui/testPolyfills";

import { UsageNotice } from "./UsageNotice";

beforeAll(installDomPolyfills);

const setEnabled = vi.fn<(enabled: boolean) => void>();

function renderNotice(needed: boolean) {
  vi.spyOn(analytics, "useUsageChoiceNeeded").mockReturnValue(needed);
  vi.spyOn(analytics, "useAnalyticsPreference").mockReturnValue({ enabled: false, setEnabled });
  return render(
    <ToastProvider>
      <UsageNotice />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  setEnabled.mockClear();
});

describe("UsageNotice", () => {
  it("asks, saying what is and is not sent, with two equal choices", () => {
    renderNotice(true);
    const notice = screen.getByRole("region", { name: "Help improve PMO Builder" });
    expect(notice).toHaveTextContent(
      "They never include your files, sample names or anything you type",
    );
    expect(notice).toHaveTextContent("Nothing is sent until you choose.");
    const send = within(notice).getByRole("button", { name: "Send usage counts" });
    const refuse = within(notice).getByRole("button", { name: "Don't send" });
    expect(send.className).toBe(refuse.className);
  });

  it("records the choice and says where to change it", async () => {
    const user = userEvent.setup();
    renderNotice(true);
    await user.click(screen.getByRole("button", { name: "Don't send" }));
    expect(setEnabled).toHaveBeenCalledExactlyOnceWith(false);
    expect(await screen.findByText("No usage counts will be sent")).toBeInTheDocument();
    expect(screen.getByText(/Change this any time/)).toBeInTheDocument();
  });

  it("opens the privacy details from the notice", async () => {
    const user = userEvent.setup();
    renderNotice(true);
    await user.click(screen.getByRole("button", { name: "See exactly what is sent" }));
    expect(
      await screen.findByRole("dialog", { name: "Your data stays on this device" }),
    ).toBeInTheDocument();
  });

  it("shows nothing when no choice is needed", () => {
    renderNotice(false);
    expect(
      screen.queryByRole("region", { name: "Help improve PMO Builder" }),
    ).not.toBeInTheDocument();
  });
});
