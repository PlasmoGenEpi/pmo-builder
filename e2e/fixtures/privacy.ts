/**
 * A Playwright fixture that fails a test if the page sends any request to
 * another origin or reports a Content Security Policy violation.
 *
 * Use it in any end-to-end test:
 *
 *   import { expect, test } from "./fixtures/privacy";
 *
 * The check runs automatically after each test. Read `privacy` inside a test
 * to look at what has been seen so far.
 */
import { test as base, expect } from "@playwright/test";

/** What the page did that could matter for privacy. */
export interface PrivacyMonitor {
  /** Every request to an origin other than the app's, as `METHOD url`. */
  readonly crossOriginRequests: string[];
  /** Every CSP violation the page reported. */
  readonly cspViolations: string[];
}

/** URL schemes that never reach the network. */
const LOCAL_SCHEMES = new Set(["data:", "blob:", "about:"]);

/** True when `url` stays on the app's origin or never reaches the network. */
export function staysLocal(url: string, appOrigin: string): boolean {
  const parsed = new URL(url);
  return LOCAL_SCHEMES.has(parsed.protocol) || parsed.origin === appOrigin;
}

/** `test` with the `privacy` fixture switched on for every test. */
export const test = base.extend<{ privacy: PrivacyMonitor }>({
  privacy: [
    async ({ page, baseURL }, use) => {
      const appOrigin = new URL(baseURL ?? "http://localhost").origin;
      const monitor: PrivacyMonitor = { crossOriginRequests: [], cspViolations: [] };

      page.context().on("request", (request) => {
        if (!staysLocal(request.url(), appOrigin)) {
          monitor.crossOriginRequests.push(`${request.method()} ${request.url()}`);
        }
      });
      page.on("console", (message) => {
        const text = message.text();
        if (/content security policy|securitypolicyviolation/i.test(text)) {
          monitor.cspViolations.push(text);
        }
      });
      // The console catches most violations. This also catches those Chrome
      // reports only as an event, such as ones raised inside a worker.
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (violation) => {
          console.error(
            `securitypolicyviolation: ${violation.effectiveDirective} blocked ${violation.blockedURI}`,
          );
        });
      });

      await use(monitor);

      expect(monitor.crossOriginRequests, "requests to another origin").toEqual([]);
      expect(monitor.cspViolations, "Content Security Policy violations").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
