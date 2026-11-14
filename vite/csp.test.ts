import { describe, expect, it } from "vitest";

import { analyticsOrigin, buildContentSecurityPolicy } from "./csp";

describe("content security policy", () => {
  it("allows only the app's own origin when analytics is not configured", () => {
    expect(buildContentSecurityPolicy({ analyticsUrl: undefined, dev: false })).toBe(
      [
        "default-src 'self'",
        "connect-src 'self'",
        "script-src 'self'",
        "worker-src 'self' blob:",
        "img-src 'self' data: blob:",
        "style-src 'self' 'unsafe-inline'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'none'",
      ].join("; "),
    );
  });

  it("adds only the analytics origin to connect-src when configured", () => {
    const policy = buildContentSecurityPolicy({
      analyticsUrl: "https://usage.example.org/pmo-builder/count?x=1",
      dev: false,
    });
    expect(policy).toContain("connect-src 'self' https://usage.example.org;");
    expect(policy.match(/usage\.example\.org/g)).toHaveLength(1);
    expect(policy).toContain("script-src 'self';");
  });

  it("treats an empty value as not configured", () => {
    expect(buildContentSecurityPolicy({ analyticsUrl: "  ", dev: false })).toContain(
      "connect-src 'self';",
    );
  });

  it("relaxes only script-src in dev, for the React Refresh preamble", () => {
    const dev = buildContentSecurityPolicy({ analyticsUrl: undefined, dev: true });
    const build = buildContentSecurityPolicy({ analyticsUrl: undefined, dev: false });
    expect(dev.replace("script-src 'self' 'unsafe-inline'", "script-src 'self'")).toBe(build);
  });

  it("refuses an analytics URL that is not https", () => {
    expect(() => analyticsOrigin("http://usage.example.org/")).toThrow(/https/);
    expect(() => analyticsOrigin("usage.example.org")).toThrow(/not a URL/);
    expect(analyticsOrigin("http://localhost:8787/")).toBe("http://localhost:8787");
  });
});
