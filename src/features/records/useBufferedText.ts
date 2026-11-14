import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** How long typing must pause before a value is committed to the store. */
export const COMMIT_DELAY_MS = 400;

/** Options for {@link useBufferedText}. */
export interface BufferedTextOptions {
  /** The committed value, from the store. */
  readonly value: string;
  /** Writes a value to the store. */
  readonly commit: (value: string) => void;
  /** Pause after the last keystroke before committing. Default {@link COMMIT_DELAY_MS}. */
  readonly delayMs?: number;
}

/** What {@link useBufferedText} gives an input. */
export interface BufferedText {
  /** What the input shows: the local edit, or the committed value when there is none. */
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Commits at once. Call on blur. */
  readonly flush: () => void;
  /** Replaces the value and commits at once, for buttons that fix a value. */
  readonly set: (value: string) => void;
}

/**
 * Keeps keystrokes local so typing stays instant, and commits to the store
 * after a short pause, on {@link BufferedText.flush} (blur), when the page is
 * hidden, and when the input unmounts, so the last keystroke is never lost.
 */
export function useBufferedText({
  value,
  commit,
  delayMs = COMMIT_DELAY_MS,
}: BufferedTextOptions): BufferedText {
  const [local, setLocal] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commitRef = useRef(commit);
  useLayoutEffect(() => {
    commitRef.current = commit;
  });

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const next = pending.current;
    if (next === null) return;
    pending.current = null;
    commitRef.current(next);
    setLocal(null);
  }, []);

  const onChange = useCallback(
    (next: string) => {
      pending.current = next;
      setLocal(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, delayMs);
    },
    [flush, delayMs],
  );

  const set = useCallback(
    (next: string) => {
      pending.current = next;
      flush();
    },
    [flush],
  );

  // Commit what is typed when the page is hidden or closed, and on unmount.
  // The listeners use the capture phase so they run before the app's own
  // listeners on the same events, which start saving the draft at once.
  useEffect(() => {
    const onHidden = (): void => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHidden, { capture: true });
    globalThis.addEventListener("pagehide", flush, { capture: true });
    return () => {
      document.removeEventListener("visibilitychange", onHidden, { capture: true });
      globalThis.removeEventListener("pagehide", flush, { capture: true });
      flush();
    };
  }, [flush]);

  return { value: local ?? value, onChange, flush, set };
}
