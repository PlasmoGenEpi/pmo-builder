import { Tabs as RadixTabs } from "radix-ui";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "./cn";

/** Sub-pixel slack when checking whether the tab strip has reached an edge. */
const EDGE_EPSILON = 1;

interface OverflowEdges {
  readonly left: boolean;
  readonly right: boolean;
}

const NO_OVERFLOW: OverflowEdges = { left: false, right: false };

function measureOverflow(element: HTMLElement): OverflowEdges {
  const left = element.scrollLeft > EDGE_EPSILON;
  const right = element.scrollLeft + element.clientWidth < element.scrollWidth - EDGE_EPSILON;
  return { left, right };
}

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
  const listRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState<OverflowEdges>(NO_OVERFLOW);

  const measure = useCallback(() => {
    const element = listRef.current;
    if (element === null) return;
    const next = measureOverflow(element);
    setFade((current) =>
      current.left === next.left && current.right === next.right ? current : next,
    );
  }, []);

  useEffect(() => {
    const element = listRef.current;
    if (element === null) return undefined;
    measure();
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resizeObserver?.observe(element);
    const mutationObserver =
      typeof MutationObserver === "undefined" ? null : new MutationObserver(measure);
    mutationObserver?.observe(element, { childList: true, subtree: true, characterData: true });
    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [measure]);

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
      <div className="relative">
        <RadixTabs.List
          ref={listRef}
          aria-label={label}
          onScroll={measure}
          className="flex gap-1 overflow-x-auto border-b border-border"
        >
          {tabs.map((tab) => (
            <RadixTabs.Trigger
              key={tab.value}
              value={tab.value}
              className={cn(
                "relative -mb-px inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 border-b-2 border-transparent px-3 text-base font-medium whitespace-nowrap text-text-muted transition-colors duration-100",
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
        <span
          aria-hidden="true"
          data-fade="left"
          data-state={fade.left ? "visible" : "hidden"}
          className="pointer-events-none absolute top-0 bottom-px left-0 w-8 bg-linear-to-r from-surface to-transparent opacity-0 transition-opacity duration-150 data-[state=visible]:opacity-100 motion-reduce:transition-none"
        />
        <span
          aria-hidden="true"
          data-fade="right"
          data-state={fade.right ? "visible" : "hidden"}
          className="pointer-events-none absolute top-0 bottom-px right-0 w-8 bg-linear-to-l from-surface to-transparent opacity-0 transition-opacity duration-150 data-[state=visible]:opacity-100 motion-reduce:transition-none"
        />
      </div>
      {tabs.map((tab) => (
        <RadixTabs.Content key={tab.value} value={tab.value} className="rounded-md">
          {tab.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
