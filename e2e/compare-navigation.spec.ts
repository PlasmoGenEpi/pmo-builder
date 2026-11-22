/**
 * End-to-end tests for the Compare tab's toolbar alignment, jump links, and
 * target-selection navigation at 1280 px.
 */
import { expect, test } from "./fixtures/privacy";
import { openBuiltExample } from "./support/pmoFile";
import { BUILD_TIMEOUT } from "./support/review";

test("Compare toolbar controls sit on one line at matching height at 1280 px, and jump links and target selection move focus", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openBuiltExample({ page, tab: "compare" });

  const hetHeading = page.getByRole("heading", { name: "Heterozygosity by target" });
  await expect(hetHeading).toBeVisible({ timeout: BUILD_TIMEOUT });

  // Both toolbar inputs sit on one horizontal line at the same height.
  const groupSelect = page.getByRole("combobox", { name: "Group specimens by" });
  const minReadsInput = page.getByRole("textbox", { name: "Minimum reads per microhaplotype" });
  const selectBox = await groupSelect.boundingBox();
  const minReadsBox = await minReadsInput.boundingBox();
  expect(selectBox).not.toBeNull();
  expect(minReadsBox).not.toBeNull();
  if (selectBox !== null && minReadsBox !== null) {
    expect(Math.abs(selectBox.y - minReadsBox.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(selectBox.height - minReadsBox.height)).toBeLessThanOrEqual(1);
  }

  // Jump links work from the keyboard and focus each section heading.
  const nav = page.getByRole("navigation", { name: "On this page" });
  const sections = [
    ["Groups", "Groups"],
    ["Heterozygosity by target", "Heterozygosity by target"],
    ["Microhaplotypes by group", "Microhaplotypes by group"],
    ["Collection timeline", "When specimens were collected"],
  ] as const;

  for (const [linkName, headingName] of sections) {
    const button = nav.getByRole("button", { name: linkName });
    // oxlint-disable-next-line no-await-in-loop -- sequential keyboard navigation check.
    await button.focus();
    // oxlint-disable-next-line no-await-in-loop -- sequential keyboard navigation check.
    await page.keyboard.press("Enter");
    // oxlint-disable-next-line no-await-in-loop -- sequential keyboard navigation check.
    await expect(page.getByRole("heading", { name: headingName })).toBeFocused();
  }

  // Choosing a target in Heterozygosity by target jumps to and focuses Microhaplotypes by group.
  const hetTable = page.getByRole("table", { name: "Heterozygosity by target" });
  const targetButtons = hetTable.locator("tbody button");
  const secondTarget = targetButtons.nth(1);
  const targetName = (await secondTarget.textContent())?.trim() ?? "";
  expect(targetName.length).toBeGreaterThan(0);

  await secondTarget.click();
  await expect(page.getByRole("heading", { name: "Microhaplotypes by group" })).toBeFocused();
  await expect(page.getByRole("combobox", { name: "Target" })).toHaveValue(targetName);

  // Back to heterozygosity returns focus to the heterozygosity heading.
  const backButton = page.getByRole("button", { name: "Back to heterozygosity" });
  await backButton.focus();
  await page.keyboard.press("Enter");
  await expect(hetHeading).toBeFocused();
});
