import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link as RouterLink } from "wouter";

import { Link, cn } from "@/ui";

import { getStep, type StepId } from "./steps";

/** Props for {@link StepLink}. */
export interface StepLinkProps {
  readonly step: StepId;
  /** Default: "Go to" and the step's title. */
  readonly children?: ReactNode;
  /**
   * `inline` sits in running text. `arrow` stands on its own, in medium
   * weight with an arrow after it. Default `inline`.
   */
  readonly variant?: "inline" | "arrow";
  readonly className?: string;
}

/**
 * The one way to link to a step. The router writes the address, so the link
 * works with hash routing and in tests that use a memory location.
 */
export function StepLink({ step, children, variant = "inline", className }: StepLinkProps) {
  const definition = getStep(step);
  const label = children ?? `Go to ${definition.title}`;
  // The router replaces the anchor's href with the full address, such as `#/panel`.
  return (
    <RouterLink href={definition.path} asChild>
      {variant === "arrow" ? (
        <Link
          variant="standalone"
          href={definition.path}
          className={cn("inline-flex items-center gap-1 text-base whitespace-nowrap", className)}
        >
          {label}
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      ) : (
        <Link href={definition.path} className={className}>
          {label}
        </Link>
      )}
    </RouterLink>
  );
}
