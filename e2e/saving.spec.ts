/**
 * Saving the draft in the browser: an edit made just before the page goes
 * is kept, and two tabs on the same draft never overwrite each other.
 */
import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures/privacy";

const NOTICE = "This draft is open in another tab";

function projectName(page: Page) {
  return page.getByRole("textbox", { name: /^Project name/ });
}

async function openProject(page: Page): Promise<void> {
  await page.goto("/#/build/project");
  await expect(page.getByRole("heading", { level: 1, name: "Project" })).toBeVisible();
}

test("keeps a project name typed just before the page reloads", async ({ page }) => {
  await openProject(page);
  // Typed, not left: the field has not committed it yet when the page goes.
  await projectName(page).pressSequentially("Typed then reloaded");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Project" })).toBeVisible();
  await expect(projectName(page)).toHaveValue("Typed then reloaded");
});

test("lets one tab edit the draft at a time, and hands over without losing work", async ({
  page: first,
}) => {
  await openProject(first);
  await projectName(first).fill("From the first tab");
  await projectName(first).blur();

  const second = await first.context().newPage();
  await openProject(second);
  await expect(second.getByText(NOTICE)).toBeVisible();
  await expect(second.getByRole("button", { name: /Open in another tab/ })).toBeVisible();
  await expect(first.getByText(NOTICE)).toHaveCount(0);

  // The first tab has a change it has not saved yet when the second takes over.
  await projectName(first).fill("Changed just before");
  await projectName(first).blur();
  await second.getByRole("button", { name: "Use this tab instead" }).click();
  await expect(first.getByText(NOTICE)).toBeVisible();
  await expect(second.getByText(NOTICE)).toHaveCount(0);
  await expect(projectName(second)).toHaveValue("Changed just before");

  // Only the second tab saves now.
  await projectName(second).fill("Saved by the second tab");
  await projectName(second).blur();
  await projectName(first).fill("Not saved by the first tab");
  await projectName(first).blur();
  await second.waitForTimeout(1500);
  await second.reload();
  await expect(projectName(second)).toHaveValue("Saved by the second tab");
  await expect(second.getByText(NOTICE)).toHaveCount(0);
});
