/**
 * Tries to push user data through every public function and checks that none
 * of it reaches a serialised record, the transparency log or the preview.
 *
 * Arguments go in through `Reflect.apply`, which skips the type checker, to
 * stand for a careless or malicious caller.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createAnalytics } from "./analytics";
import { fakeEnvironment } from "./fakeEnvironment";
import * as api from "./index";

const FILE_NAME = "Kisumu_patient_042.csv";
const COLUMN_NAME = "Sample ID (internal)";
const CELL_VALUE = "ACGTTGCAACGTTAGC";
const SNEAKY = "kisumu-patient-042";
const SNEAKY_CODE = "panel/kisumu-patient-042";
const USER_DATA = [FILE_NAME, COLUMN_NAME, CELL_VALUE, SNEAKY, SNEAKY_CODE];
/** Fragments that must never appear in anything that could leave the browser. */
const FORBIDDEN = ["Kisumu", "kisumu", "patient", "042", "Sample ID", "ACGT"];

/** Every property name a public function reads, each holding user data. */
function poisoned(value: string): Record<string, unknown> {
  return Object.fromEntries(
    [
      "table",
      "route",
      "format",
      "gzip",
      "rows",
      "columns",
      "outcome",
      "schemaErrors",
      "kind",
      "bytes",
      "code",
      "severity",
      "fileName",
      "columnName",
      "message",
    ].map((key) => [key, value]),
  );
}

/** Valid input with user data in extra properties and in tricky shapes. */
function sneakyInputs(value: string): unknown[] {
  const extra = { fileName: value, columnName: value, cell: value, message: value };
  return [
    value,
    { toString: () => value, toJSON: () => value, valueOf: () => value },
    poisoned(value),
    ["panel", value],
    {
      ...extra,
      table: "panelTargets",
      route: "upload",
      format: "csv",
      gzip: false,
      rows: 3,
      columns: 2,
    },
    { ...extra, outcome: "built" },
    { ...extra, schemaErrors: 2 },
    { ...extra, kind: "plain", bytes: 1000 },
    { ...extra, code: value, severity: "error" },
    { ...extra, code: "panel/no-panels", severity: "warning" },
  ];
}

function callWithEverything(fn: unknown): void {
  if (typeof fn !== "function") return;
  for (const value of USER_DATA) {
    for (const input of sneakyInputs(value)) {
      Reflect.apply(fn, undefined, [input]);
      Reflect.apply(fn, undefined, [input, value]);
      Reflect.apply(fn, undefined, ["panel", input]);
      Reflect.apply(fn, undefined, ["microhaplotypes", "ready", input]);
    }
  }
}

function expectClean(texts: readonly string[]): void {
  const all = texts.join("\n");
  for (const fragment of FORBIDDEN) expect(all).not.toContain(fragment);
}

describe("no user data can reach a record", () => {
  it("through the instrumentation with sending switched on", () => {
    const fake = fakeEnvironment({ destination: "https://usage.example.org/" });
    const analytics = createAnalytics(fake.env);
    analytics.start();
    for (const [name, fn] of Object.entries(analytics)) {
      if (name === "subscribe" || name === "flush" || name === "setEnabledByUser") continue;
      callWithEverything(fn);
    }
    const pending = analytics.getTransparencySnapshot().pending;
    expect(pending).not.toBeNull();
    fake.hide();

    const sent = [
      ...fake.beacons.map((beacon) => beacon.body),
      ...fake.fetches.map((call) => (typeof call.init.body === "string" ? call.init.body : "")),
    ];
    expect(sent).toHaveLength(2);
    expectClean([
      ...sent,
      pending ?? "",
      ...analytics.getTransparencySnapshot().entries.map((entry) => entry.body),
    ]);
    // The records still say something: the valid parts got through.
    expect(sent[1]).toContain('"panelTargets"');
    expect(sent[1]).toContain('"panel/other"');
    expect(sent[1]).toContain('"panel/no-panels"');
  });

  it("through every exported function and hook", () => {
    const hooks = Object.entries(api).filter(([name]) => name.startsWith("use"));
    const functions = Object.entries(api).filter(
      ([name]) => !name.startsWith("use") && name !== "setAnalyticsEnabled",
    );
    expect(functions.length).toBeGreaterThanOrEqual(12);

    api.initAnalytics();
    const outputs: string[] = [];
    for (const [, fn] of functions) {
      callWithEverything(fn);
      for (const value of USER_DATA) {
        outputs.push(JSON.stringify(Reflect.apply(fn, undefined, [value]) ?? null));
      }
    }
    for (const [, hook] of hooks) {
      const { result } = renderHook((): unknown => Reflect.apply(hook, undefined, []));
      act(() => {
        const setEnabled: unknown = Reflect.get(Object(result.current), "setEnabled");
        callWithEverything(setEnabled);
      });
      outputs.push(JSON.stringify(result.current));
    }
    callWithEverything(api.setAnalyticsEnabled);
    outputs.push(api.previewSessionSummary() ?? "");
    window.dispatchEvent(new Event("pagehide"));

    expectClean([...outputs, ...api.getTransparencyLog().map((entry) => entry.body)]);
    expect(api.getTransparencyLog().map((entry) => entry.kind)).toEqual(["visit", "session"]);
  });
});
