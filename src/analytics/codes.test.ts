import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { APP_CODES, ISSUE_CODES, PMOTOOLS_CODES, toIssueCode } from "./codes";

/** A code-shaped string literal: `"<module>/<reason>"`. */
const CODE_LITERAL = /["'`]([a-z]+\/[a-z0-9]+(?:-[a-z0-9]+)*)["'`]/g;

/** Code-shaped strings in the app that are not codes: a header alias. */
const NOT_CODES = new Set(["parasites/ul"]);

/** Module specifiers, MIME types and paths, which are not codes either. */
const NOT_CODE_PREFIXES = ["wouter/", "zustand/", "application/", "text/", "src/", "public/"];

function isCode(value: string): boolean {
  return !NOT_CODES.has(value) && !NOT_CODE_PREFIXES.some((prefix) => value.startsWith(prefix));
}

/** Non-test TypeScript sources under a folder, as text. */
function sources(folder: string): string[] {
  const root = resolve(folder);
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter(
      (file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$|\.testing\.tsx?$|testing\.ts$/.test(file),
    )
    .map((file) => readFileSync(`${root}/${file}`, "utf8"));
}

/** The string members of a union type alias declared in a source file. */
function unionMembers(file: string, typeName: string): string[] {
  const source = readFileSync(resolve(file), "utf8");
  const start = source.indexOf(`type ${typeName} =`);
  if (start < 0) throw new Error(`${typeName} not found in ${file}`);
  const end = source.indexOf("\n\n", start);
  const body = source.slice(start, end < 0 ? undefined : end);
  return [...body.matchAll(/"([a-z-]+)"/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

/** `anyOf` as `any-of`. */
function kebab(word: string): string {
  return word.replace(
    /([a-z0-9])([A-Z])/g,
    (_, before: string, upper: string) => `${before}-${upper.toLowerCase()}`,
  );
}

/** Schema keywords the PMO schema uses that a validation error can carry. */
function schemaKeywords(): Set<string> {
  const dir = resolve("node_modules/pmotools-ts/schemas");
  const failing = new Set([
    "type",
    "pattern",
    "required",
    "minimum",
    "maximum",
    "enum",
    "anyOf",
    "oneOf",
    "allOf",
    "minItems",
    "maxItems",
    "minLength",
    "maxLength",
    "format",
    "const",
  ]);
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    for (const [key, value] of Object.entries(node)) {
      if (failing.has(key)) found.add(key);
      if (key === "additionalProperties" && value === false) found.add(key);
      if (key === "properties" || key === "$defs") {
        if (typeof value === "object" && value !== null)
          for (const child of Object.values(value)) walk(child);
      } else {
        walk(value);
      }
    }
  };
  for (const file of readdirSync(dir)) {
    if (file.endsWith(".json")) walk(JSON.parse(readFileSync(`${dir}/${file}`, "utf8")));
  }
  return found;
}

describe("toIssueCode", () => {
  it("keeps known pmotools-ts and app codes", () => {
    expect(toIssueCode("panel/duplicate-target-names")).toBe("panel/duplicate-target-names");
    expect(toIssueCode("import/empty-file")).toBe("import/empty-file");
    expect(toIssueCode("import/too-large")).toBe("import/too-large");
  });

  it("reads a camel-case schema keyword as its hyphenated code", () => {
    expect(toIssueCode("schema/anyOf")).toBe("schema/any-of");
  });

  it("counts an unknown reason in a known module as <module>/other", () => {
    expect(toIssueCode("mhap/some-new-reason")).toBe("mhap/other");
    expect(toIssueCode("panel/patient-042")).toBe("panel/other");
  });

  it("counts anything else as other", () => {
    for (const value of [
      "Sample ID",
      "patient_042.csv",
      "unknown/thing",
      "panel/Duplicate",
      "panel//x",
      "panel/a/b",
      `panel/${"a".repeat(80)}`,
      "",
      42,
      null,
      new Error("panel/duplicate-target-names"),
    ]) {
      expect(toIssueCode(value)).toBe("other");
    }
  });

  it("lists every code the vendored pmotools-ts raises", () => {
    // Vitest runs from the repository root.
    const dist = resolve("node_modules/pmotools-ts/dist");
    const found = new Set<string>();
    for (const file of readdirSync(dist, { recursive: true, encoding: "utf8" })) {
      if (!file.endsWith(".js")) continue;
      const source = readFileSync(`${dist}/${file}`, "utf8");
      for (const match of source.matchAll(/"([a-z]+\/[a-z0-9]+(?:-[a-z0-9]+)*)"/g)) {
        const code = match[1];
        // "n/a" and MIME types are strings in pmotools-ts that are not codes.
        if (code !== undefined && code !== "n/a" && !code.startsWith("application/")) {
          found.add(code);
        }
      }
    }
    const listed = new Set<string>(PMOTOOLS_CODES);
    expect([...found].filter((code) => !listed.has(code))).toEqual([]);
  });

  it("lists every code the app raises, and only those", () => {
    const found = new Set<string>();
    for (const folder of ["src/domain", "src/state", "src/worker", "src/features", "src/app"]) {
      for (const source of sources(folder)) {
        for (const match of source.matchAll(CODE_LITERAL)) {
          const code = match[1];
          if (code !== undefined && isCode(code)) found.add(code);
        }
      }
    }
    // Built with a template: `import/${failure.code}` and `schema/${error.keyword}`.
    const failures = [
      ...unionMembers("src/domain/import/errors.ts", "ImportErrorCode"),
      ...unionMembers("src/domain/import/messages.ts", "ImportFailure"),
    ];
    expect(failures).toContain("too-large");
    for (const failure of failures) found.add(`import/${failure}`);
    for (const keyword of schemaKeywords()) found.add(`schema/${kebab(keyword)}`);

    const listed = new Set<string>(ISSUE_CODES);
    expect([...found].filter((code) => !listed.has(code)).toSorted()).toEqual([]);
    // And nothing listed that the app no longer raises.
    expect(APP_CODES.filter((code) => !found.has(code))).toEqual([]);
  });
});
