import type { HTMLAttributes } from "react";

/** Text that screen readers announce but that is not shown on screen. */
export function VisuallyHidden(props: HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} className="sr-only" />;
}
