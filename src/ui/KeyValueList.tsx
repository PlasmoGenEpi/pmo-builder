import type { ReactNode } from "react";

import { cn } from "./cn";

/** One row of a {@link KeyValueList}. */
export interface KeyValueItem {
  label: ReactNode;
  value: ReactNode;
  /** Show the value in the monospace font, for file names, IDs and sequences. */
  mono?: boolean;
}

/** Props for {@link KeyValueList}. */
export interface KeyValueListProps {
  items: readonly KeyValueItem[];
  className?: string;
}

/** Labelled values in two columns, such as the details of an imported file. */
export function KeyValueList({ items, className }: KeyValueListProps) {
  return (
    <dl
      className={cn(
        "grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-[minmax(8rem,max-content)_1fr] sm:gap-y-2.5",
        className,
      )}
    >
      {items.map((item, index) => (
        // Labels may repeat or be elements, so the position is the stable key.
        // oxlint-disable-next-line react/no-array-index-key
        <div key={index} className="contents">
          <dt className="text-sm text-text-muted sm:text-base">{item.label}</dt>
          <dd
            className={cn(
              "mb-2 min-w-0 text-base break-words text-text sm:mb-0",
              item.mono && "font-mono text-sm",
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
