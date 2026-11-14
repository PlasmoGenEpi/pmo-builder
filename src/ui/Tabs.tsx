import { Tabs as RadixTabs } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "./cn";

/** One tab of {@link Tabs}. */
export interface TabItem<V extends string = string> {
  value: V;
  label: string;
  /** A small count after the label, such as the number of warnings. */
  count?: number;
  content: ReactNode;
}

/** Props for {@link Tabs}. */
export interface TabsProps<V extends string = string> {
  /** Accessible name of the tab list. */
  label: string;
  tabs: readonly TabItem<V>[];
  value?: V;
  defaultValue?: V;
  onValueChange?: (value: V) => void;
  className?: string;
}

/** Switches between views of the same thing. Arrow keys move between tabs. */
export function Tabs<V extends string = string>({
  label,
  tabs,
  value,
  defaultValue,
  onValueChange,
  className,
}: TabsProps<V>) {
  return (
    <RadixTabs.Root
      value={value}
      defaultValue={defaultValue ?? tabs[0]?.value}
      onValueChange={(next) => {
        const match = tabs.find((tab) => tab.value === next);
        if (match) onValueChange?.(match.value);
      }}
      className={cn("flex flex-col gap-4", className)}
    >
      <RadixTabs.List
        aria-label={label}
        className="flex gap-1 overflow-x-auto border-b border-border"
      >
        {tabs.map((tab) => (
          <RadixTabs.Trigger
            key={tab.value}
            value={tab.value}
            className={cn(
              "relative -mb-px inline-flex h-9 cursor-pointer items-center gap-2 border-b-2 border-transparent px-3 text-base font-medium whitespace-nowrap text-text-muted transition-colors duration-100",
              "hover:text-text data-[state=active]:border-accent data-[state=active]:text-text",
            )}
          >
            {tab.label}
            {tab.count === undefined ? null : (
              <span className="rounded-full bg-surface-muted px-1.5 text-xs text-text-muted tabular-nums">
                {tab.count}
              </span>
            )}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {tabs.map((tab) => (
        <RadixTabs.Content key={tab.value} value={tab.value} className="rounded-md">
          {tab.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
