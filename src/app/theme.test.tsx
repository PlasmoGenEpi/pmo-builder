import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInThisContext } from "node:vm";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetThemeForTests, THEME_STORAGE_KEY } from "./theme";
import { ThemeToggle } from "./ThemeToggle";

function mockSystemTheme(dark: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: dark && query.includes("dark"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  window.localStorage.clear();
  resetThemeForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("theme toggle", () => {
  it("starts from the system theme and saves the user's switch", async () => {
    mockSystemTheme(false);
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    await user.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("follows a dark system setting when nothing is saved", () => {
    mockSystemTheme(true);
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();
  });

  it("prefers a saved choice over the system setting", () => {
    mockSystemTheme(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeInTheDocument();
  });

  it("ignores a saved value it does not know", () => {
    mockSystemTheme(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeInTheDocument();
  });
});

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("theme before first paint", () => {
  it("loads a script from a file in <head>, before the app, as the policy allows no inline script", () => {
    const html = read("index.html");
    const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
    expect(head).toContain('<script src="./theme-init.js"></script>');
    expect(html.indexOf("theme-init.js")).toBeLessThan(html.indexOf("/src/main.tsx"));
  });

  it("applies a saved choice that differs from the system's", () => {
    const script = read("public/theme-init.js");
    expect(script).toContain(`"${THEME_STORAGE_KEY}"`);
    delete document.documentElement.dataset.theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    runInThisContext(script);
    expect(document.documentElement.dataset.theme).toBe("dark");
    window.localStorage.removeItem(THEME_STORAGE_KEY);
    delete document.documentElement.dataset.theme;
    runInThisContext(script);
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
