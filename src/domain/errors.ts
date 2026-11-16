/** Helpers for errors, for every module: domain, worker and state alike. */

/** An error's message, for logs and debugging. Not for the screen: it is not translated. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
