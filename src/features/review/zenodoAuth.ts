/**
 * Signing in to Zenodo from the browser, with no server of ours in between.
 *
 * The app opens Zenodo's sign-in in a new window. Zenodo sends that window
 * back to `zenodo-callback.html` on this site with an access token, and the
 * callback page hands the token to the app over a `BroadcastChannel`, which
 * only pages of this site can hear. The token is kept in memory and is gone
 * when the page is closed.
 */

/** The channel the callback page answers on. `public/zenodo-callback.js` uses the same name. */
export const SIGN_IN_CHANNEL = "pmo-builder-zenodo-sign-in";

/** Enough to make a draft, upload its file and ask for a review. Not enough to publish. */
export const SIGN_IN_SCOPE = "deposit:write";

/** How long the app waits for the user to finish signing in. */
export const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

/** What a sign-in gave. */
export type SignInResult =
  | { readonly ok: true; readonly token: string }
  | {
      readonly ok: false;
      /** `blocked`: the browser did not open the window. `refused`: Zenodo or the user said no. */
      readonly reason: "blocked" | "refused" | "timed-out" | "cancelled";
    };

/** What a sign-in needs. Everything but `clientId` has a default and is there for tests. */
export interface SignInOptions {
  /** The identifier of the application registered with Zenodo. */
  readonly clientId: string;
  /** Stops waiting, as when the user chooses Cancel. */
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly redirectUri?: string;
  readonly state?: string;
  readonly open?: (url: string) => unknown;
  readonly channel?: BroadcastChannel;
}

/** Where Zenodo sends the sign-in window back to. */
export function callbackUrl(base: string = document.baseURI): string {
  return new URL("zenodo-callback.html", base).href;
}

/** Zenodo's sign-in page for this application. */
export function authoriseUrl(options: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
}): string {
  const query = new URLSearchParams({
    response_type: "token",
    client_id: options.clientId,
    scope: SIGN_IN_SCOPE,
    redirect_uri: options.redirectUri,
    state: options.state,
  });
  return `https://zenodo.org/oauth/authorize?${query.toString()}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Opens Zenodo's sign-in and waits for the token. Call it from a click, or
 * the browser blocks the window.
 */
export function signIn(options: SignInOptions): Promise<SignInResult> {
  const state = options.state ?? crypto.randomUUID();
  const channel = options.channel ?? new BroadcastChannel(SIGN_IN_CHANNEL);
  const open =
    options.open ??
    ((url: string) => globalThis.open(url, "pmo-builder-zenodo", "popup,width=640,height=760"));

  return new Promise<SignInResult>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: SignInResult): void => {
      globalThis.clearTimeout(timer);
      channel.removeEventListener("message", onMessage);
      options.signal?.removeEventListener("abort", onAbort);
      channel.close();
      resolve(result);
    };
    function onMessage(event: MessageEvent): void {
      const data: unknown = event.data;
      // Ignore anything not meant for this sign-in, such as an older window's answer.
      if (!isRecord(data) || data["state"] !== state) return;
      const token = data["accessToken"];
      finish(
        typeof token === "string" && token !== ""
          ? { ok: true, token }
          : { ok: false, reason: "refused" },
      );
    }
    function onAbort(): void {
      finish({ ok: false, reason: "cancelled" });
    }
    channel.addEventListener("message", onMessage);
    options.signal?.addEventListener("abort", onAbort);
    timer = globalThis.setTimeout(
      () => finish({ ok: false, reason: "timed-out" }),
      options.timeoutMs ?? SIGN_IN_TIMEOUT_MS,
    );
    const redirectUri = options.redirectUri ?? callbackUrl();
    const opened = open(authoriseUrl({ clientId: options.clientId, redirectUri, state }));
    if (opened === null || opened === undefined) finish({ ok: false, reason: "blocked" });
  });
}
