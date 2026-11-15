/**
 * A Vite plugin that writes a Content Security Policy and a referrer policy
 * into `index.html` as `<meta>` tags.
 *
 * The policy is what makes the privacy promise checkable: the browser itself
 * refuses any request to an origin not listed in `connect-src`, whatever the
 * app's code tries to do. The only origins added are the one in
 * `VITE_ANALYTICS_URL`, when it is set, and zenodo.org, when the build can
 * deposit there (`VITE_ZENODO_CLIENT_ID` is set).
 *
 * A `<meta>` policy cannot carry `frame-ancestors`, `report-uri` or
 * `sandbox`. GitHub Pages cannot set response headers, so this is the
 * strongest policy available there.
 */
import type { Plugin } from "vite";

/** What the policy depends on. */
export interface PolicyOptions {
  /** The value of `VITE_ANALYTICS_URL`, or `undefined` when it is not set. */
  readonly analyticsUrl: string | undefined;
  /**
   * `true` when the build can deposit to Zenodo (`VITE_ZENODO_CLIENT_ID` is
   * set). The app then may contact zenodo.org, which it does only when the
   * user asks for a deposit.
   */
  readonly zenodo?: boolean;
  /** `true` for the dev server, which needs an inline script. */
  readonly dev: boolean;
}

/**
 * Returns the origin of the analytics URL, or `null` when none is set.
 * Throws when the URL is not https (http is allowed for localhost), so a
 * typo fails the build instead of shipping a policy that blocks the records.
 */
export function analyticsOrigin(url: string | undefined): string | null {
  if (url === undefined || url.trim() === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error(`VITE_ANALYTICS_URL is not a URL: ${url}`);
  }
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) {
    throw new Error(`VITE_ANALYTICS_URL must use https: ${url}`);
  }
  return parsed.origin;
}

/** The only origin a deposit contacts. */
export const ZENODO_ORIGIN = "https://zenodo.org";

/** Builds the policy string. */
export function buildContentSecurityPolicy(options: PolicyOptions): string {
  const origin = analyticsOrigin(options.analyticsUrl);
  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    // 'self' also covers the dev server's websocket on the same host and port.
    [
      "connect-src",
      "'self'",
      ...(origin === null ? [] : [origin]),
      ...(options.zenodo === true ? [ZENODO_ORIGIN] : []),
    ],
    // The dev server needs 'unsafe-inline' for the React Refresh preamble,
    // which @vitejs/plugin-react writes into index.html as an inline module
    // script. The production build has no inline scripts.
    ["script-src", "'self'", ...(options.dev ? ["'unsafe-inline'"] : [])],
    ["worker-src", "'self'", "blob:"],
    ["img-src", "'self'", "data:", "blob:"],
    // 'unsafe-inline' for styles is needed by Radix. Its Dialog, Popover,
    // Select and DropdownMenu lock page scroll through react-remove-scroll,
    // which inserts a <style> element at runtime (react-style-singleton) to
    // hide the scrollbar and keep the layout from shifting. CSP blocks
    // injected <style> elements unless style-src allows 'unsafe-inline', and
    // a static site cannot hand out a per-request nonce. The dev server also
    // injects CSS as <style> elements. Styles cannot send data anywhere that
    // connect-src, img-src and default-src do not allow.
    ["style-src", "'self'", "'unsafe-inline'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'none'"],
  ];
  return directives.map((directive) => directive.join(" ")).join("; ");
}

/** Adds the policy and `Referrer-Policy: no-referrer` to `index.html`, in dev and in the build. */
export function contentSecurityPolicy(options: {
  readonly analyticsUrl: string | undefined;
  readonly zenodo?: boolean;
}): Plugin {
  let dev = false;
  // Fail at config time, not halfway through a build.
  analyticsOrigin(options.analyticsUrl);
  return {
    name: "pmo-builder:content-security-policy",
    configResolved(config) {
      dev = config.command === "serve";
    },
    transformIndexHtml: {
      order: "pre",
      handler: () => [
        {
          tag: "meta",
          attrs: {
            "http-equiv": "Content-Security-Policy",
            content: buildContentSecurityPolicy({
              analyticsUrl: options.analyticsUrl,
              zenodo: options.zenodo === true,
              dev,
            }),
          },
          injectTo: "head-prepend",
        },
        {
          tag: "meta",
          attrs: { name: "referrer", content: "no-referrer" },
          injectTo: "head-prepend",
        },
      ],
    },
  };
}
