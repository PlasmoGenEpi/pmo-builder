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
  /** Also lets {@link jumpToHeading} scroll to the heading and focus it. */
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
          tabIndex={id === undefined ? undefined : -1}
          className={cn(
            "scroll-mt-28 font-semibold text-text md:scroll-mt-[calc(var(--spacing-topbar)+1rem)]",
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

/**
 * Scrolls to the section heading with this `id`, clear of the top bar, and
 * moves focus to it so keyboard and screen reader users land there too.
 */
export function jumpToHeading(id: string): void {
  const heading = document.getElementById(id);
  if (heading === null) return;
  const reduce =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // jsdom has no scrollIntoView.
  if (typeof heading.scrollIntoView === "function") {
    heading.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }
  heading.focus({ preventScroll: true });
}
