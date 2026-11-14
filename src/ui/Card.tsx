import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "./cn";

const paddings = { none: "", sm: "p-4", md: "p-5 sm:p-6" } as const;

/** Props for {@link Card}. */
export interface CardProps extends HTMLAttributes<HTMLElement> {
  padding?: keyof typeof paddings;
  /** Renders as a `section` when it has its own heading inside. */
  as?: "div" | "section" | "article";
  children: ReactNode;
}

/** A bordered surface that groups related content. Do not nest cards. */
export function Card({ padding = "md", as: Element = "div", className, ...rest }: CardProps) {
  return (
    <Element
      {...rest}
      className={cn(
        "rounded-xl border border-border bg-surface shadow-xs",
        paddings[padding],
        className,
      )}
    />
  );
}
