/**
 * Privacy checks against the production build.
 *
 * The first test walks through whatever pages exist and relies on the
 * `privacy` fixture to fail it on any cross-origin request or CSP violation.
 * The others check that the policy is in place and that the browser enforces
 * it.
 */
import { test as plain } from "@playwright/test";

import { expect, test } from "./fixtures/privacy";

test("loads and moves around without contacting another origin", async ({ page, privacy }) => {
  await page.goto("/");
  await expect(page.locator("#root")).not.toBeEmpty();

  // Visit every in-app route linked today. Pages are still being built, so
  // this follows what is there rather than a fixed list. Routes are hash
  // routes; other links (such as example files) are downloads.
  const hrefs = await page
    .locator('a[href^="#"]:not([download])')
    .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
  for (const href of [...new Set(hrefs)].slice(0, 30)) {
    // oxlint-disable-next-line no-await-in-loop -- pages are visited one at a time.
    await page.goto(new URL(href, page.url()).href);
    // oxlint-disable-next-line no-await-in-loop -- pages are visited one at a time.
    await expect(page.locator("#root")).not.toBeEmpty();
  }
  await page.goBack();
  await page.reload();
  await expect(page.locator("#root")).not.toBeEmpty();

  expect(privacy.crossOriginRequests).toEqual([]);
});

test("serves the Content Security Policy and referrer policy", async ({ page }) => {
  await page.goto("/");
  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  expect(policy).toContain("default-src 'self'");
  expect(policy).toMatch(/connect-src 'self'(;| https:\/\/[^ ;]+;)/);
  expect(policy).not.toContain("'unsafe-eval'");
  expect(policy).toContain("script-src 'self';");
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
});

plain("the browser blocks a request to another origin", async ({ page }) => {
  // If the policy were missing, this would stop the request reaching the network.
  await page.route("https://example.org/**", (route) => route.abort());
  await page.goto("/");
  const directive = await page.evaluate(async () => {
    const violation = new Promise<string>((resolve) => {
      document.addEventListener("securitypolicyviolation", (event) => {
        resolve(event.effectiveDirective);
      });
    });
    await fetch("https://example.org/collect", { method: "POST", body: "x" }).catch(() => null);
    return Promise.race([
      violation,
      new Promise<string>((resolve) => setTimeout(() => resolve("none"), 2000)),
    ]);
  });
  expect(directive).toBe("connect-src");
});

test.describe("the privacy fixture", () => {
  // Proves the fixture is not silently passing: leaving the origin must fail.
  test.fail();
  test("fails a test that contacts another origin", async ({ page }) => {
    await page.route("https://example.org/**", (route) => route.abort());
    await page.goto("/");
    // Top-level navigation is not covered by connect-src, so it reaches the request log.
    await page.goto("https://example.org/").catch(() => null);
  });
});
