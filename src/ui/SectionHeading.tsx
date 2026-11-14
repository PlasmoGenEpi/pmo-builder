import type { ReactNode } from "react";

import { cn } from "./cn";

/** Props for {@link SectionHeading}. */
export interface SectionHeadingProps {
  title: ReactNode;
  /** One sentence under the title. */
  description?: ReactNode;
  /** Buttons or links at the end of the heading row. */
  actions?: ReactNode;
  /** Heading level. Page titles are h1 and belong to `StepPage`; sections are h2 or h3. */
  level?: 2 | 3;
  id?: string;
  className?: string;
}

/** The heading of a section within a page, with an optional description and actions. */
export function SectionHeading({
  title,
  description,
  actions,
  level = 2,
  id,
  className,
}: SectionHeadingProps) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <Heading
          id={id}
          className={cn(
            "font-semibold text-text",
            level === 2 ? "text-lg tracking-tight" : "text-md",
          )}
        >
          {title}
        </Heading>
        {description ? (
          <p className="max-w-prose text-base text-text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
