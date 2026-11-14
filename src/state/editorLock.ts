/**
 * Which tab edits the draft. Every tab keeps the whole draft under one key,
 * so two tabs saving the same draft would overwrite each other's work. One
 * tab holds the editor lock and saves; any other tab shows the draft, does
 * not save, and can ask to take over.
 *
 * The lock is a Web Lock where the browser has them. Where it does not, tabs
 * agree over a BroadcastChannel. Taking over always goes through the channel
 * first, so the editing tab saves before it steps back and no saved work is
 * lost; a Web Lock is then stolen only if that tab does not answer in time.
 */

/** Whether this tab edits the draft. */
export type EditorClaim = "editor" | "elsewhere";

/** The editor lock, as the store uses it. */
export interface EditorLock {
  /** Becomes the editor if no other tab is, without waiting. */
  claim(): Promise<EditorClaim>;
  /** Asks the editing tab to save and step back, then becomes the editor. */
  takeOver(): Promise<void>;
  /**
   * Called when another tab takes over. The lock is let go once the returned
   * promise settles, so save there. Called at most once per time this tab is
   * the editor.
   */
  onStepBack(handler: () => Promise<void>): void;
}

/** A lock for a single tab, or for a browser with neither Web Locks nor BroadcastChannel: always the editor. */
export function createSoleEditorLock(): EditorLock {
  return {
    claim: () => Promise.resolve("editor"),
    takeOver: () => Promise.resolve(),
    onStepBack: () => {},
  };
}

/** The parts of the Web Locks API the lock uses. */
export interface LockManagerLike {
  request(
    name: string,
    options: {
      readonly ifAvailable?: boolean;
      readonly steal?: boolean;
      readonly signal?: AbortSignal;
    },
    callback: (lock: unknown) => Promise<void>,
  ): Promise<void>;
}

/** The parts of a BroadcastChannel the lock uses. */
export interface ChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
}

/** What {@link createEditorLock} needs. */
export interface EditorLockOptions {
  /** The lock and channel name. */
  readonly name: string;
  /** `navigator.locks`, or `null` where the browser has none. */
  readonly locks: LockManagerLike | null;
  /** A channel shared by the app's tabs, or `null` where the browser has none. */
  readonly channel: ChannelLike | null;
  /** How long to wait for another tab to answer. Default 1500 ms. */
  readonly answerMs?: number;
}

type Message =
  | { readonly kind: "who-edits" }
  | { readonly kind: "i-edit" }
  | { readonly kind: "take-over" }
  | { readonly kind: "stepped-back" };

const KINDS: ReadonlySet<string> = new Set(["who-edits", "i-edit", "take-over", "stepped-back"]);

function toMessage(data: unknown): Message | null {
  if (typeof data !== "object" || data === null || !("kind" in data)) return null;
  const kind = data.kind;
  if (typeof kind !== "string" || !KINDS.has(kind)) return null;
  switch (kind) {
    case "who-edits":
    case "i-edit":
    case "take-over":
    case "stepped-back":
      return { kind };
    default:
      return null;
  }
}

/** The step-back handler until the store sets one. */
function nothingToSave(): Promise<void> {
  return Promise.resolve();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The editor lock for the app's tabs. With neither `locks` nor `channel`, it
 * is {@link createSoleEditorLock}.
 */
export function createEditorLock(options: EditorLockOptions): EditorLock {
  const { name, locks, channel } = options;
  const answerMs = options.answerMs ?? 1500;
  if (locks === null && channel === null) return createSoleEditorLock();

  let editor = false;
  let stepBack: () => Promise<void> = nothingToSave;
  /** Lets go of the Web Lock this tab holds. */
  let release: (() => void) | null = null;
  const waiting = new Set<(message: Message) => void>();

  // A BroadcastChannel only reaches this origin's tabs, so it takes no target origin.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  const post = (message: Message): void => channel?.postMessage(message);

  /** Steps back: saves through the handler, lets go of the lock, and tells the other tab. */
  const stepDown = async (): Promise<void> => {
    if (!editor) return;
    editor = false;
    try {
      await stepBack();
    } finally {
      release?.();
      release = null;
      post({ kind: "stepped-back" });
    }
  };

  channel?.addEventListener("message", (event) => {
    const message = toMessage(event.data);
    if (message === null) return;
    for (const listener of waiting) listener(message);
    if (message.kind === "who-edits" && editor) post({ kind: "i-edit" });
    if (message.kind === "take-over") void stepDown();
  });

  /** Resolves with the first message of `kind` within `ms`, or `false`. */
  const heard = (kind: Message["kind"], ms: number): Promise<boolean> =>
    new Promise((resolve) => {
      const listener = (message: Message): void => {
        if (message.kind !== kind) return;
        waiting.delete(listener);
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        waiting.delete(listener);
        resolve(false);
      }, ms);
      waiting.add(listener);
    });

  /**
   * Requests the Web Lock and holds it until {@link release}. Resolves once
   * the lock is held, or with `false` when `ifAvailable` and it is not free.
   */
  const hold = (lockOptions: {
    readonly ifAvailable?: boolean;
    readonly steal?: boolean;
    readonly signal?: AbortSignal;
  }): Promise<boolean> =>
    new Promise((resolve, reject) => {
      if (locks === null) {
        resolve(true);
        return;
      }
      locks
        .request(name, lockOptions, async (lock) => {
          if (lock === null) {
            resolve(false);
            return;
          }
          await new Promise<void>((done) => {
            release = done;
            resolve(true);
          });
        })
        .catch((error: unknown) => {
          // Another tab stole the lock: step back without saving over its work.
          if (editor) {
            editor = false;
            release = null;
            void stepBack();
            return;
          }
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });

  return {
    async claim() {
      if (locks !== null) {
        editor = await hold({ ifAvailable: true });
        return editor ? "editor" : "elsewhere";
      }
      const answer = heard("i-edit", Math.min(answerMs, 300));
      post({ kind: "who-edits" });
      editor = !(await answer);
      return editor ? "editor" : "elsewhere";
    },

    async takeOver() {
      if (editor) return;
      const answered = heard("stepped-back", answerMs);
      post({ kind: "take-over" });
      if (locks === null) {
        await answered;
        editor = true;
        return;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), answerMs);
      try {
        await hold({ signal: controller.signal });
      } catch {
        // The other tab did not let go in time: take the lock from it.
        await hold({ steal: true });
      } finally {
        clearTimeout(timer);
      }
      editor = true;
      await Promise.race([answered, wait(0)]);
    },

    onStepBack(handler) {
      stepBack = handler;
    },
  };
}

/** The editor lock for this browser: Web Locks where available, else a BroadcastChannel, else none. */
export function browserEditorLock(name: string): EditorLock {
  const locks: LockManagerLike | null =
    typeof navigator !== "undefined" && "locks" in navigator ? navigator.locks : null;
  const channel: ChannelLike | null =
    typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(name);
  return createEditorLock({ name, locks, channel });
}
