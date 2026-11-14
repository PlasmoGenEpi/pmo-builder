import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BARREL, VENDOR } from "./chunks";

function indexFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith("index.ts"))
    .map((file) => join(dir, file));
}

describe("chunk rules", () => {
  it("treats as side-effect free only index files that only re-export", () => {
    const barrels = indexFiles(join(process.cwd(), "src")).filter((file) => BARREL.test(file));
    expect(barrels.length).toBeGreaterThanOrEqual(8);
    for (const file of barrels) {
      // Drop comments, then every statement must be an export from another module.
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      const statements = code
        .split(";")
        .map((statement) => statement.trim())
        .filter((statement) => statement !== "");
      const other = statements.filter(
        (statement) => !/^export (?:type )?(?:\*|\{[^}]*\}) from "[^"]+"$/.test(statement),
      );
      expect({ file, other }).toEqual({ file, other: [] });
    }
  });

  it("puts react and the router in the vendor chunk, and nothing a step loads later", () => {
    const pnpm = "/repo/node_modules/.pnpm/react-dom@19.3.1/node_modules/";
    expect(VENDOR.test(`${pnpm}react-dom/cjs/react-dom.production.js`)).toBe(true);
    expect(VENDOR.test("/repo/node_modules/wouter/src/index.js")).toBe(true);
    expect(VENDOR.test("/repo/node_modules/@radix-ui/react-select/dist/index.mjs")).toBe(false);
    expect(VENDOR.test("/repo/node_modules/react-remove-scroll/dist/index.js")).toBe(false);
    expect(VENDOR.test("/repo/node_modules/pmotools-ts/dist/index.js")).toBe(false);
  });
});
