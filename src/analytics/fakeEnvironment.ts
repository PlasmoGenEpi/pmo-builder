/**
 * A browser stand-in for the tests in this folder. Not used by the app.
 */
import type { AnalyticsEnvironment } from "./analytics";
import type { PrivacySignals } from "./status";

/** What a fake environment saw, and levers to drive it. */
export interface FakeEnvironment {
  readonly env: AnalyticsEnvironment;
  /** Bodies handed to `sendBeacon`. */
  readonly beacons: { readonly url: string; readonly body: string }[];
  /** Calls to `fetch`. */
  readonly fetches: { readonly url: string; readonly init: RequestInit }[];
  readonly storage: Map<string, string>;
  /** Moves the clock on. */
  advance(milliseconds: number): void;
  /** Fires the page-hidden listeners. */
  hide(): void;
  /** Fires the listeners for a preference change in another tab. */
  changePreferenceElsewhere(): void;
}

/** Builds a fake environment. Records go to `destination` when one is given. */
export function fakeEnvironment(
  options: {
    readonly destination?: string;
    readonly signals?: PrivacySignals;
    readonly beaconAccepts?: boolean;
    readonly storageThrows?: boolean;
  } = {},
): FakeEnvironment {
  const beacons: { url: string; body: string }[] = [];
  const fetches: { url: string; init: RequestInit }[] = [];
  const storage = new Map<string, string>();
  const hidden: (() => void)[] = [];
  const preference: (() => void)[] = [];
  let clock = 1000;
  const guard = (): void => {
    if (options.storageThrows === true) throw new Error("storage blocked");
  };
  const env: AnalyticsEnvironment = {
    destination: options.destination,
    appVersion: "1.2.3",
    signals: options.signals ?? {},
    storage: {
      getItem: (key) => {
        guard();
        return storage.get(key) ?? null;
      },
      setItem: (key, value) => {
        guard();
        storage.set(key, value);
      },
      removeItem: (key) => {
        guard();
        storage.delete(key);
      },
    },
    sendBeacon: (url, body) => {
      beacons.push({ url, body });
      return options.beaconAccepts ?? true;
    },
    fetch: (url, init) => {
      fetches.push({ url, init });
      return Promise.resolve(undefined);
    },
    now: () => clock,
    onPageHidden: (callback) => hidden.push(callback),
    onPreferenceChanged: (callback) => preference.push(callback),
  };
  return {
    env,
    beacons,
    fetches,
    storage,
    advance: (milliseconds) => {
      clock += milliseconds;
    },
    hide: () => hidden.forEach((callback) => callback()),
    changePreferenceElsewhere: () => preference.forEach((callback) => callback()),
  };
}
