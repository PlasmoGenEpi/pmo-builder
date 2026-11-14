/** How a record leaves the browser. Fire and forget: failures are silent. */

/** `navigator.sendBeacon`, bound to the navigator. */
export type BeaconSender = (url: string, body: string) => boolean;

/** The subset of `fetch` this module calls. */
export type FetchSender = (url: string, init: RequestInit) => Promise<unknown>;

/**
 * Sends `body` to `url`.
 *
 * A string body makes `sendBeacon` use `text/plain`, which is a CORS-safe
 * content type, so there is no preflight request. If the beacon is refused
 * or missing, `fetch` sends the same body without cookies or a referrer.
 */
export function transmit(options: {
  readonly url: string;
  readonly body: string;
  readonly sendBeacon: BeaconSender | undefined;
  readonly fetch: FetchSender | undefined;
}): void {
  const { url, body, sendBeacon, fetch } = options;
  try {
    if (sendBeacon?.(url, body) === true) return;
  } catch {
    // Fall through to fetch.
  }
  try {
    void fetch?.(url, {
      method: "POST",
      body,
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      keepalive: true,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      mode: "no-cors",
      cache: "no-store",
    }).catch(() => undefined);
  } catch {
    // Nothing else to try.
  }
}
