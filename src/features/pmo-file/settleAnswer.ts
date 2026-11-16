import type { WorkingPmoResult } from "@/domain/tools/types";

import type { NoAnswerReason } from "./NoAnswer";

/** What to do with each answer a request about the working PMO can give. */
export interface AnswerHandlers<T> {
  /** Called with the value, when the request succeeded. */
  readonly ok: (value: T) => void;
  /** Called with why there is no value. */
  readonly none: (reason: NoAnswerReason) => void;
}

/**
 * Acts on an answer about the working PMO, for a request made once, such as
 * a download. A stale answer, for a PMO since replaced, is ignored, as
 * `useWorkingPmoQuery` ignores it.
 */
export function settleAnswer<T>(answer: WorkingPmoResult<T>, handlers: AnswerHandlers<T>): void {
  if (answer.kind === "stale") return;
  if (answer.kind === "ok") handlers.ok(answer.value);
  else handlers.none(answer.kind);
}
