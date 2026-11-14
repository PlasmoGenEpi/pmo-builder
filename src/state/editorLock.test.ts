import { describe, expect, it } from "vitest";

import { createEditorLock, type ChannelLike } from "./editorLock";

/** Channels that deliver to every other channel on the same bus, as BroadcastChannel does. */
function bus(): () => ChannelLike {
  const listeners = new Set<{
    readonly owner: object;
    readonly listener: (event: { readonly data: unknown }) => void;
  }>();
  return () => {
    const owner = {};
    return {
      postMessage(message) {
        for (const entry of listeners) {
          if (entry.owner !== owner) setTimeout(() => entry.listener({ data: message }), 0);
        }
      },
      addEventListener(_type, listener) {
        listeners.add({ owner, listener });
      },
    };
  };
}

describe("editor lock over a channel", () => {
  it("lets the first tab edit, and the second take over after the first has saved", async () => {
    const channel = bus();
    const first = createEditorLock({
      name: "draft",
      locks: null,
      channel: channel(),
      answerMs: 100,
    });
    const second = createEditorLock({
      name: "draft",
      locks: null,
      channel: channel(),
      answerMs: 100,
    });
    const events: string[] = [];
    first.onStepBack(async () => {
      events.push("first saves");
      await Promise.resolve();
      events.push("first stepped back");
    });

    expect(await first.claim()).toBe("editor");
    expect(await second.claim()).toBe("elsewhere");

    await second.takeOver();
    events.push("second edits");
    expect(events).toEqual(["first saves", "first stepped back", "second edits"]);
  });

  it("is the editor straight away with no other tab and no way to talk to one", async () => {
    const lock = createEditorLock({ name: "draft", locks: null, channel: null });
    expect(await lock.claim()).toBe("editor");
  });
});
