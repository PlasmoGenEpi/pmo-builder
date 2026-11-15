import { describe, expect, it } from "vitest";

import { createAnalytics } from "./analytics";
import { PMOTOOLS_CODES } from "./codes";
import { fakeEnvironment } from "./fakeEnvironment";
import { PREFERENCE_KEY } from "./status";

const DESTINATION = "https://usage.example.org/pmo-builder";

function bodies(entries: readonly { readonly body: string }[]): unknown[] {
  return entries.map((entry): unknown => JSON.parse(entry.body));
}

describe("status", () => {
  it("is off when no destination is configured", () => {
    const analytics = createAnalytics(fakeEnvironment().env);
    expect(analytics.getStatus()).toEqual({
      state: "off",
      reason: "not-configured",
      destination: null,
    });
  });

  it("is off for a destination that is not https", () => {
    const fake = fakeEnvironment({ destination: "http://usage.example.org/" });
    expect(createAnalytics(fake.env).getStatus()).toMatchObject({ reason: "invalid-destination" });
  });

  it("is on with a destination and no opt-out", () => {
    const analytics = createAnalytics(fakeEnvironment({ destination: DESTINATION }).env);
    expect(analytics.getStatus()).toEqual({
      state: "on",
      destination: "https://usage.example.org",
    });
  });

  it("respects Global Privacy Control and Do Not Track", () => {
    const gpc = fakeEnvironment({
      destination: DESTINATION,
      signals: { globalPrivacyControl: true },
    });
    expect(createAnalytics(gpc.env).getStatus()).toMatchObject({
      reason: "global-privacy-control",
    });
    const dnt = fakeEnvironment({ destination: DESTINATION, signals: { doNotTrack: "1" } });
    expect(createAnalytics(dnt.env).getStatus()).toMatchObject({ reason: "do-not-track" });
  });

  it("stores the user's switch and reads it back on the next load", () => {
    const fake = fakeEnvironment({ destination: DESTINATION });
    const first = createAnalytics(fake.env);
    first.setEnabledByUser(false);
    expect(first.getStatus()).toMatchObject({ state: "off", reason: "switched-off" });
    expect([...fake.storage.entries()]).toEqual([[PREFERENCE_KEY, "off"]]);

    const second = createAnalytics(fake.env);
    expect(second.isEnabledByUser()).toBe(false);
    second.setEnabledByUser(true);
    expect(second.getStatus().state).toBe("on");
    expect(fake.storage.size).toBe(0);
  });

  it("honours the switch for the page when storage is blocked", () => {
    const fake = fakeEnvironment({ destination: DESTINATION, storageThrows: true });
    const analytics = createAnalytics(fake.env);
    analytics.setEnabledByUser(false);
    expect(analytics.getStatus()).toMatchObject({ reason: "switched-off" });
  });

  it("follows a change made in another tab", () => {
    const fake = fakeEnvironment({ destination: DESTINATION });
    const analytics = createAnalytics(fake.env);
    analytics.start();
    fake.storage.set(PREFERENCE_KEY, "off");
    fake.changePreferenceElsewhere();
    expect(analytics.getStatus()).toMatchObject({ reason: "switched-off" });
  });
});

describe("records", () => {
  it("sends one visit record on start, and only once", () => {
    const fake = fakeEnvironment({ destination: DESTINATION });
    const analytics = createAnalytics(fake.env);
    analytics.start();
    analytics.start();
    expect(fake.beacons).toEqual([
      { url: DESTINATION, body: '{"v":2,"kind":"visit","app":"1.2.3"}' },
    ]);
  });

  it("sends no session record when the user did nothing", () => {
    const fake = fakeEnvironment({ destination: DESTINATION });
    const analytics = createAnalytics(fake.env);
    analytics.start();
    analytics.recordDraftRestored();
    analytics.recordSectionStatus("panel", "ready");
    fake.hide();
    expect(fake.beacons).toHaveLength(1);
  });

  it("sends one session summary when the page is hidden, at most once", () => {
    const fake = fakeEnvironment({ destination: DESTINATION });
    const analytics = createAnalytics(fake.env);
    analytics.start();
    analytics.recordDraftRestored();
    analytics.recordStepOpened("panel");
    analytics.recordStepOpened("microhaplotypes");
    analytics.recordStepOpened("panel");
    analytics.recordTableImported({
      table: "panelTargets",
      route: "example",
      format: "csv",
      gzip: false,
      rows: 120,
      columns: 7,
    });
    analytics.recordMappingEdited("panelTargets");
    analytics.recordSectionStatus("panel", "incomplete");
    analytics.recordSectionStatus("panel", "ready");
    analytics.recordBuild({ outcome: "failed" });
    analytics.recordBuild({ outcome: "built" });
    analytics.recordValidation({ schemaErrors: 3 });
    analytics.recordDownload({ kind: "gzip", bytes: 250_000 });
    analytics.recordIssue({ code: "panel/missing-columns", severity: "error" });
    analytics.recordIssue({ code: "panel/missing-columns", severity: "error" });
    analytics.recordIssue({ code: "mhap/brand-new", severity: "warning" });
    fake.advance(7 * 60_000);
    fake.hide();
    fake.hide();

    expect(fake.beacons).toHaveLength(2);
    expect(bodies(fake.beacons)[1]).toEqual({
      v: 2,
      kind: "session",
      app: "1.2.3",
      steps: ["microhaplotypes", "panel"],
      pages: [],
      tables: {
        panelTargets: {
          import: { route: "example", format: "csv", gzip: false, rows: "100-999", columns: "5-9" },
          mappingEdited: true,
        },
      },
      sections: { panel: "ready" },
      build: {
        built: "1",
        failed: "1",
        validation: "invalid",
        schemaErrors: "2-4",
        downloads: { plain: "0", gzip: "1" },
        downloadSize: "100kb-1mb",
      },
      publish: {
        opened: { built: "0", file: "0" },
        deposits: { built: "0", file: "0" },
        outcomes: {},
        fileChecks: {},
      },
      issues: [
        { code: "mhap/other", severity: "warning", count: "1" },
        { code: "panel/missing-columns", severity: "error", count: "2-4" },
      ],
      draftRestored: true,
      duration: "5-15m",
    });
  });

  it("sends nothing when off, but logs what would have been sent", () => {
    const fake = fakeEnvironment({ destination: DESTINATION, signals: { doNotTrack: "1" } });
    const analytics = createAnalytics(fake.env);
    analytics.start();
    analytics.recordStepOpened("review");
    fake.hide();
    expect(fake.beacons).toEqual([]);
    expect(fake.fetches).toEqual([]);
    const log = analytics.getTransparencySnapshot().entries;
    expect(log.map((entry) => [entry.kind, entry.outcome])).toEqual([
      ["visit", "not-sent"],
      ["session", "not-sent"],
    ]);
  });

  it("caps the number of distinct codes", () => {
    const fake = fakeEnvironment({ destination: DESTINATION });
    const analytics = createAnalytics(fake.env);
    analytics.recordStepOpened("home");
    for (const code of PMOTOOLS_CODES) {
      analytics.recordIssue({ code, severity: "error" });
      analytics.recordIssue({ code, severity: "warning" });
    }
    const pending = analytics.getTransparencySnapshot().pending;
    expect(pending).not.toBeNull();
    const record: unknown = JSON.parse(pending ?? "{}");
    expect(record).toMatchObject({ issues: expect.any(Array) });
    const issues: unknown = Reflect.get(Object(record), "issues");
    expect(Array.isArray(issues) ? issues.length : 0).toBe(32);
    expect(JSON.stringify(issues)).toContain('{"code":"other","severity":"error","count":"10-99"}');
    expect(JSON.stringify(issues)).toContain(
      '{"code":"other","severity":"warning","count":"10-99"}',
    );
  });
});

describe("transport", () => {
  it("falls back to fetch without credentials or referrer when the beacon is refused", () => {
    const fake = fakeEnvironment({ destination: DESTINATION, beaconAccepts: false });
    createAnalytics(fake.env).start();
    expect(fake.fetches).toHaveLength(1);
    expect(fake.fetches[0]?.init).toMatchObject({
      method: "POST",
      body: '{"v":2,"kind":"visit","app":"1.2.3"}',
      keepalive: true,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
    });
  });

  it("stays silent when every transport throws", () => {
    const fake = fakeEnvironment({ destination: DESTINATION });
    const analytics = createAnalytics({
      ...fake.env,
      sendBeacon: () => {
        throw new Error("blocked");
      },
      fetch: () => Promise.reject(new Error("offline")),
    });
    expect(() => {
      analytics.start();
    }).not.toThrow();
    expect(analytics.getTransparencySnapshot().entries[0]?.outcome).toBe("sent");
  });
});

describe("transparency", () => {
  it("previews the pending session record and notifies listeners", () => {
    const fake = fakeEnvironment({ destination: DESTINATION });
    const analytics = createAnalytics(fake.env);
    let calls = 0;
    const unsubscribe = analytics.subscribe(() => {
      calls += 1;
    });
    expect(analytics.getTransparencySnapshot().pending).toBeNull();
    analytics.recordStepOpened("specimens");
    expect(calls).toBe(1);
    const snapshot = analytics.getTransparencySnapshot();
    expect(snapshot).toBe(analytics.getTransparencySnapshot());
    expect(snapshot.pending).toContain('"steps":["specimens"]');
    analytics.flush();
    expect(analytics.getTransparencySnapshot().pending).toBeNull();
    expect(analytics.getTransparencySnapshot().entries[0]?.body).toBe(fake.beacons[0]?.body);
    unsubscribe();
  });
});
