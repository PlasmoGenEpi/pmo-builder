/**
 * Whether usage records may be sent, and why not.
 *
 * The order of the checks is the order of the reasons below: the build must
 * name a destination, the browser must not signal an opt-out, and the user
 * must not have switched it off.
 */

/** Why nothing is sent. */
export type AnalyticsOffReason =
  /** The build did not set `VITE_ANALYTICS_URL`. */
  | "not-configured"
  /** `VITE_ANALYTICS_URL` is not an https URL. */
  | "invalid-destination"
  /** The browser sends the Global Privacy Control signal. */
  | "global-privacy-control"
  /** The browser sends Do Not Track. */
  | "do-not-track"
  /** The user switched usage counts off in this browser. */
  | "switched-off"
  /**
   * The user has not chosen yet. Records wait for the choice, and are sent
   * only if the user chooses to send them.
   */
  | "not-chosen";

/** Whether records are sent, and where. */
export type AnalyticsStatus =
  | { readonly state: "on"; readonly destination: string }
  | {
      readonly state: "off";
      readonly reason: AnalyticsOffReason;
      /** The origin records would go to, or `null` when there is none. */
      readonly destination: string | null;
    };

/** The `localStorage` key for the user's choice. The only thing this module stores. */
export const PREFERENCE_KEY = "pmo-builder:usage-counts";

/** The values stored under `PREFERENCE_KEY`. Nothing stored means the user has not chosen. */
const OFF = "off";
const ON = "on";

/** The user's choice: send, do not send, or not chosen yet. */
export type UsageChoice = "on" | "off" | null;

/** The parts of `localStorage` this module uses. */
export type PreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The browser signals this module reads. */
export interface PrivacySignals {
  readonly globalPrivacyControl?: unknown;
  readonly doNotTrack?: unknown;
}

/**
 * Parses the configured destination. Returns the full URL and its origin, or
 * `null` when it is missing, and `"invalid"` when it is not https (plain http
 * is allowed for `localhost`, for testing a receiver).
 */
export function parseDestination(
  raw: string | undefined,
): { readonly url: string; readonly origin: string } | "invalid" | null {
  if (raw === undefined || raw.trim() === "") return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return "invalid";
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return "invalid";
  if (url.username !== "" || url.password !== "") return "invalid";
  return { url: url.href, origin: url.origin };
}

/** Reads the user's choice. Storage errors count as "not chosen". */
export function readChoice(storage: PreferenceStorage | undefined): UsageChoice {
  try {
    const value = storage?.getItem(PREFERENCE_KEY);
    return value === OFF ? "off" : value === ON ? "on" : null;
  } catch {
    return null;
  }
}

/** Saves the user's choice. */
export function writeChoice(storage: PreferenceStorage | undefined, send: boolean): void {
  try {
    storage?.setItem(PREFERENCE_KEY, send ? ON : OFF);
  } catch {
    // Storage can be full or blocked. The choice then lasts for this page only.
  }
}

/** Works out the status from the configuration, the browser signals and the user's choice. */
export function computeStatus(options: {
  readonly destination: ReturnType<typeof parseDestination>;
  readonly signals: PrivacySignals | undefined;
  readonly choice: UsageChoice;
}): AnalyticsStatus {
  const { destination, signals, choice } = options;
  if (destination === null) return { state: "off", reason: "not-configured", destination: null };
  if (destination === "invalid") {
    return { state: "off", reason: "invalid-destination", destination: null };
  }
  const origin = destination.origin;
  if (signals?.globalPrivacyControl === true) {
    return { state: "off", reason: "global-privacy-control", destination: origin };
  }
  const dnt = signals?.doNotTrack;
  if (dnt === "1" || dnt === "yes") {
    return { state: "off", reason: "do-not-track", destination: origin };
  }
  if (choice === "off") return { state: "off", reason: "switched-off", destination: origin };
  if (choice === null) return { state: "off", reason: "not-chosen", destination: origin };
  return { state: "on", destination: origin };
}

/** True when two statuses say the same thing. */
export function sameStatus(a: AnalyticsStatus, b: AnalyticsStatus): boolean {
  if (a.state === "on" || b.state === "on") {
    return a.state === b.state && a.destination === b.destination;
  }
  return a.reason === b.reason && a.destination === b.destination;
}
