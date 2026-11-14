import type { ReactNode } from "react";

/** Props for {@link StepIntro}. */
export interface StepIntroProps {
  readonly children: ReactNode;
}

/** The sentence at the top of an optional step: that it is optional and what it adds to the PMO. */
export function StepIntro({ children }: StepIntroProps) {
  return <p className="max-w-prose text-base text-text-muted">{children}</p>;
}
