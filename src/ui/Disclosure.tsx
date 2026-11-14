import { ChevronRight } from "lucide-react";
import { Collapsible } from "radix-ui";
import { useState, type ReactNode } from "react";

import { cn } from "./cn";

/** Props for {@link Disclosure}. */
export interface DisclosureProps {
  title: ReactNode;
  /** Shown at the end of the header, such as "12 fields" or "3 mapped". */
  summary?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

/**
 * A section that can be collapsed, with a count or summary in its header.
 * Used to keep optional fields out of the way until they are needed.
 *
 * The chevron follows this disclosure's own state, not an ancestor's, so a
 * disclosure inside another one shows the right chevron.
 */
export function Disclosure({
  title,
  summary,
  children,
  defaultOpen,
  open,
  onOpenChange,
  className,
}: DisclosureProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen ?? false);
  const isOpen = open ?? uncontrolledOpen;
  const handleOpenChange = (next: boolean) => {
    setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  return (
    <Collapsible.Root
      open={isOpen}
      onOpenChange={handleOpenChange}
      className={cn("rounded-lg border border-border bg-surface", className)}
    >
      <Collapsible.Trigger className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-4 py-3 text-left hover:bg-surface-subtle">
        <ChevronRight
          aria-hidden="true"
          data-state={isOpen ? "open" : "closed"}
          className="size-4 shrink-0 text-text-muted transition-transform duration-150 data-[state=open]:rotate-90"
        />
        <span className="min-w-0 flex-1 text-base font-medium text-text">{title}</span>
        {summary ? <span className="shrink-0 text-sm text-text-muted">{summary}</span> : null}
      </Collapsible.Trigger>
      <Collapsible.Content className="border-t border-border px-4 py-4">
        {children}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
