// @vitest-environment jsdom
import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { authoriseUrl, callbackUrl, signIn, SIGN_IN_CHANNEL } from "./zenodoAuth";

/** A sign-in with a fake window opener, and a second channel standing in for the callback page. */
function start(extra: Partial<Parameters<typeof signIn>[0]> = {}) {
  const open = vi.fn<(url: string) => unknown>(() => ({}));
  const callback = new BroadcastChannel(SIGN_IN_CHANNEL);
  const result = signIn({
    clientId: "client-1",
    redirectUri: "https://app.example/zenodo-callback.html",
    state: "state-1",
    open,
    ...extra,
  });
  return { open, callback, result };
}

/** What the callback page does: one message on the channel. */
function answer(channel: BroadcastChannel, message: unknown): void {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a BroadcastChannel takes no target origin
  channel.postMessage(message);
}

const channels: BroadcastChannel[] = [];
afterEach(() => {
  for (const channel of channels.splice(0)) channel.close();
  vi.useRealTimers();
});

describe("authoriseUrl", () => {
  it("asks Zenodo for a token for this application, with write access to drafts only", () => {
    const url = new URL(
      authoriseUrl({
        clientId: "client-1",
        redirectUri: "https://app.example/zenodo-callback.html",
        state: "state-1",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://zenodo.org/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "token",
      client_id: "client-1",
      scope: "deposit:write",
      redirect_uri: "https://app.example/zenodo-callback.html",
      state: "state-1",
    });
  });
});

describe("callbackUrl", () => {
  it("is the callback page beside the app, whatever path the app is served from", () => {
    expect(callbackUrl("https://v2.pmotools.app/")).toBe(
      "https://v2.pmotools.app/zenodo-callback.html",
    );
    expect(callbackUrl("https://example.org/pmo-builder/index.html#/review")).toBe(
      "https://example.org/pmo-builder/zenodo-callback.html",
    );
  });
});

describe("signIn", () => {
  it("opens Zenodo's sign-in and resolves with the token the callback page sends", async () => {
    const { open, callback, result } = start();
    channels.push(callback);
    expect(open).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("client_id=client-1"));
    answer(callback, { state: "state-1", accessToken: "token-1", error: null });
    expect(await result).toEqual({ ok: true, token: "token-1" });
  });

  it("ignores an answer meant for another sign-in", async () => {
    const { callback, result } = start();
    channels.push(callback);
    answer(callback, { state: "someone-else", accessToken: "stolen", error: null });
    answer(callback, "not an answer");
    answer(callback, { state: "state-1", accessToken: "token-1", error: null });
    expect(await result).toEqual({ ok: true, token: "token-1" });
  });

  it("reports a refusal when the answer has no token", async () => {
    const { callback, result } = start();
    channels.push(callback);
    answer(callback, { state: "state-1", accessToken: null, error: "access_denied" });
    expect(await result).toEqual({ ok: false, reason: "refused" });
  });

  it("reports a blocked window at once", async () => {
    const { callback, result } = start({ open: () => null });
    channels.push(callback);
    expect(await result).toEqual({ ok: false, reason: "blocked" });
  });

  it("stops waiting when cancelled", async () => {
    const controller = new AbortController();
    const { callback, result } = start({ signal: controller.signal });
    channels.push(callback);
    controller.abort();
    expect(await result).toEqual({ ok: false, reason: "cancelled" });
  });

  it("gives up after the time limit", async () => {
    vi.useFakeTimers();
    const { callback, result } = start({ timeoutMs: 1000 });
    channels.push(callback);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toEqual({ ok: false, reason: "timed-out" });
  });
});

describe("the callback page", () => {
  it("answers on the channel the app listens to", () => {
    const script = readFileSync("public/zenodo-callback.js", "utf8");
    expect(script).toContain(`new BroadcastChannel("${SIGN_IN_CHANNEL}")`);
  });

  it("loads no inline script and allows scripts from this site only", () => {
    const page = readFileSync("public/zenodo-callback.html", "utf8");
    expect(page).toContain("script-src 'self'");
    expect(page).toContain('<script src="zenodo-callback.js"></script>');
    expect(page.match(/<script/g)).toHaveLength(1);
  });
});
