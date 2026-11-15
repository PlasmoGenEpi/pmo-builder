// Zenodo sends the sign-in window here with an access token after the "#".
// This hands the token to the PMO Builder page that asked for it, over a
// channel only pages of this site can hear, and closes the window. The
// channel name is SIGN_IN_CHANNEL in src/features/review/zenodoAuth.ts.
const params = new URLSearchParams(
  window.location.hash.length > 1 ? window.location.hash.slice(1) : window.location.search.slice(1),
);
// Take the token out of the address bar and the history.
window.history.replaceState(null, "", window.location.pathname);

const channel = new BroadcastChannel("pmo-builder-zenodo-sign-in");
const answer = {
  state: params.get("state"),
  accessToken: params.get("access_token"),
  error: params.get("error"),
};
// oxlint-disable-next-line unicorn/require-post-message-target-origin -- a BroadcastChannel takes no target origin
channel.postMessage(answer);
channel.close();

const message = document.querySelector("#message");
if (message !== null) {
  message.textContent =
    params.get("access_token") === null
      ? "Zenodo did not sign you in. Close this window and try again in PMO Builder."
      : "You are signed in. Close this window and go back to PMO Builder.";
}
window.close();
