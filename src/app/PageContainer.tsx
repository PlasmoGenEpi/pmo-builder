import type { ReactNode } from "react";

import { cn } from "@/ui";

/** Width of a page's content column. */
export type PageWidth = "reading" | "step" | "full";

/** Props for {@link PageContainer}. */
export interface PageContainerProps {
  /**
   * `reading` (default) keeps lines short; `step` suits a build step beside the step
   * list; `full` lets wide tables use the whole window.
   */
  width?: PageWidth;
  children: ReactNode;
  className?: string;
}

/** The padded, centred column every page sits in. */
export function PageContainer({ width = "reading", children, className }: PageContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 pt-8 pb-16 sm:px-8 lg:pt-10",
        width === "reading" ? "max-w-reading" : width === "step" ? "max-w-step" : "max-w-wide",
        className,
      )}
    >
      {children}
    </div>
  );
}
