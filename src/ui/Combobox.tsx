import { plural, t } from "@lingui/core/macro";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover as RadixPopover } from "radix-ui";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { cn } from "./cn";
import { inputClassName, useFieldControl } from "./Field";
import { formatCount } from "./format";

/** One choice in a {@link Combobox}. */
export interface ComboboxOption {
  value: string;
  label: string;
  /** Secondary text shown at the end of the row, such as an example value from the column. */
  description?: string;
}

/** Props for {@link Combobox}. */
export interface ComboboxProps {
  options: readonly ComboboxOption[];
  /** The chosen value, or `null` for "None". */
  value: string | null;
  onChange: (value: string | null) => void;
  /** Label of the explicit empty choice. Pass `false` to leave it out. */
  noneLabel?: string | false;
  /** Secondary text of the empty choice. */
  noneDescription?: string;
  /** Shown in the input when nothing is chosen. Defaults to the none label. */
  placeholder?: string;
  /** Shown when the search matches nothing. */
  emptyMessage?: string;
  /** Show option labels in the monospace font, for column names and codes. */
  mono?: boolean;
  disabled?: boolean;
  /** Needed when the combobox is not inside a `Field`. */
  "aria-label"?: string;
  "aria-labelledby"?: string;
  className?: string;
}

/** Rendering more than this many rows at once stops being useful; the user is asked to type. */
const RENDER_LIMIT = 400;
const PAGE = 10;

type Item = { kind: "none" } | { kind: "option"; option: ComboboxOption };

interface Indexed {
  option: ComboboxOption;
  haystack: string;
}

const optionElementId = (base: string, index: number) => `${base}-opt-${index}`;

function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  if (query === "") return text;
  const at = text.toLowerCase().indexOf(query);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-accent-subtle text-accent-text">
        {text.slice(at, at + query.length)}
      </mark>
      {text.slice(at + query.length)}
    </>
  );
}

/**
 * A searchable single select for long lists, such as picking one of several
 * hundred column names. It follows the ARIA combobox pattern with a listbox
 * popup: type to filter, arrow keys to move, Enter to choose, Escape to close.
 * The first choice is always "None" unless `noneLabel` is `false`.
 *
 * @example
 * <Field label="Sample name" required>
 *   <Combobox mono options={columnOptions} value={mapping} onChange={setMapping} />
 * </Field>
 */
export function Combobox({
  options,
  value,
  onChange,
  noneLabel = t({
    message: "None",
    context: "no column",
    comment: "The choice of no column in a list of columns",
  }),
  noneDescription,
  placeholder,
  emptyMessage = t`Nothing matches your search.`,
  mono = false,
  disabled = false,
  className,
  ...aria
}: ComboboxProps) {
  const field = useFieldControl();
  const generatedId = useId();
  const inputId = field?.id ?? `combobox-${generatedId}`;
  const listId = `${inputId}-list`;
  const optionId = (index: number) => optionElementId(inputId, index);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const indexed = useMemo<Indexed[]>(
    () =>
      options.map((option) => ({
        option,
        haystack: `${option.label}\n${option.description ?? ""}`.toLowerCase(),
      })),
    [options],
  );

  const needle = query.trim().toLowerCase();
  const matches = useMemo(
    () => (needle === "" ? indexed : indexed.filter((entry) => entry.haystack.includes(needle))),
    [indexed, needle],
  );

  const items = useMemo<Item[]>(() => {
    const head: Item[] = noneLabel === false ? [] : [{ kind: "none" }];
    return head.concat(
      matches.slice(0, RENDER_LIMIT).map((entry) => ({ kind: "option", option: entry.option })),
    );
  }, [matches, noneLabel]);

  const selected = value === null ? null : options.find((option) => option.value === value);
  const selectedLabel = value === null ? "" : (selected?.label ?? value);

  function indexOfValue(target: string | null): number {
    const found = items.findIndex((item) =>
      item.kind === "none" ? target === null : item.option.value === target,
    );
    return Math.max(found, 0);
  }

  function openList() {
    if (disabled || open) return;
    setQuery("");
    setActiveIndex(indexOfValue(value));
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setQuery("");
  }

  function choose(item: Item | undefined) {
    if (item === undefined) return;
    onChange(item.kind === "none" ? null : item.option.value);
    close();
  }

  function move(delta: number) {
    setActiveIndex((current) => Math.min(Math.max(current + delta, 0), items.length - 1));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        openList();
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (event.altKey) return;
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (event.altKey) {
          close();
          return;
        }
        move(-1);
        break;
      case "PageDown":
        event.preventDefault();
        move(PAGE);
        break;
      case "PageUp":
        event.preventDefault();
        move(-PAGE);
        break;
      case "Enter":
        event.preventDefault();
        choose(items[activeIndex]);
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close();
        break;
      case "Tab":
        close();
        break;
      default:
        break;
    }
  }

  // Keep the active option in view while moving through a long list.
  useEffect(() => {
    if (!open) return;
    const element = document.getElementById(optionElementId(inputId, activeIndex));
    if (element && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
  }, [open, activeIndex, inputId]);

  const optionCount = matches.length;
  const optionTotal = formatCount(optionCount);
  const shownLimit = formatCount(RENDER_LIMIT);
  const truncated = matches.length > RENDER_LIMIT;

  return (
    <RadixPopover.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      modal={false}
    >
      <RadixPopover.Anchor asChild>
        <div ref={wrapperRef} className={cn("relative w-full", className)}>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={open && items.length > 0 ? optionId(activeIndex) : undefined}
            aria-describedby={field?.["aria-describedby"]}
            aria-invalid={field?.["aria-invalid"]}
            aria-required={field?.["aria-required"]}
            aria-label={aria["aria-label"]}
            aria-labelledby={aria["aria-labelledby"]}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            placeholder={placeholder ?? (noneLabel === false ? t`Choose` : noneLabel)}
            value={open ? query : selectedLabel}
            onChange={(event) => {
              const next = event.target.value;
              if (!open) setOpen(true);
              setQuery(next);
              // Jump to the first real match, past "None".
              setActiveIndex(next.trim() === "" || noneLabel === false ? 0 : 1);
            }}
            onClick={openList}
            onFocus={(event) => event.target.select()}
            onKeyDown={handleKeyDown}
            onBlur={(event) => {
              const to = event.relatedTarget;
              if (to instanceof Node && wrapperRef.current?.contains(to)) return;
              close();
            }}
            className={cn(
              inputClassName,
              "h-control pr-9",
              // The placeholder is a prompt, not a column name, so it keeps the body font.
              mono ? "font-mono text-sm placeholder:font-sans placeholder:text-base" : "text-base",
            )}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (open) close();
              else {
                inputRef.current?.focus();
                openList();
              }
            }}
            className="absolute inset-y-0 right-0 flex w-9 cursor-pointer items-center justify-center text-text-muted disabled:cursor-not-allowed"
          >
            <ChevronsUpDown className="size-4" />
          </button>
        </div>
      </RadixPopover.Anchor>
      <RadixPopover.Portal>
        <RadixPopover.Content
          role="presentation"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            const target = event.target;
            if (target instanceof Node && wrapperRef.current?.contains(target)) {
              event.preventDefault();
            }
          }}
          className="z-50 w-(--radix-popover-trigger-width) max-w-[min(32rem,calc(100vw-1rem))] min-w-56 animate-pop-in overflow-hidden rounded-lg border border-border bg-surface-raised shadow-lg"
        >
          <ul
            id={listId}
            // A native select cannot filter or show secondary text, so this is an ARIA listbox.
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/prefer-tag-over-role
            role="listbox"
            aria-label={typeof aria["aria-label"] === "string" ? aria["aria-label"] : undefined}
            aria-labelledby={aria["aria-label"] === undefined ? inputId : undefined}
            className="max-h-[min(20rem,var(--radix-popover-content-available-height))] overflow-y-auto p-1"
          >
            {items.map((item, index) => {
              const isNone = item.kind === "none";
              const label = isNone ? String(noneLabel) : item.option.label;
              const description = isNone ? noneDescription : item.option.description;
              const isCurrent = isNone ? value === null : item.option.value === value;
              const isActive = index === activeIndex;
              return (
                // Keyboard use goes through the input (aria-activedescendant); the mouse clicks here.
                // oxlint-disable-next-line jsx-a11y/click-events-have-key-events
                <li
                  key={isNone ? "\u0000none" : item.option.value}
                  id={optionId(index)}
                  // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/prefer-tag-over-role
                  role="option"
                  aria-selected={isActive}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => {
                    if (!isActive) setActiveIndex(index);
                  }}
                  onClick={() => choose(item)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md py-1.5 pr-2.5 pl-2 text-base text-text select-none",
                    isActive && "bg-surface-muted",
                    isNone && "text-text-muted",
                    isNone && items.length > 1 && "mb-1",
                  )}
                >
                  <span className="flex w-4 shrink-0 justify-center">
                    {isCurrent ? (
                      <>
                        <Check aria-hidden="true" className="size-4 text-accent-text" />
                        <span className="sr-only">{t`(current choice)`}</span>
                      </>
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      mono && !isNone && "font-mono text-sm",
                      isNone && "italic",
                    )}
                  >
                    {isNone ? label : <Highlight text={label} query={needle} />}
                  </span>
                  {description ? (
                    <span className="max-w-[50%] shrink truncate text-sm text-text-subtle">
                      {description}
                    </span>
                  ) : null}
                </li>
              );
            })}
            {optionCount === 0 ? (
              <li role="presentation" className="px-3 py-3 text-sm text-text-muted">
                {emptyMessage}
              </li>
            ) : null}
            {truncated ? (
              <li role="presentation" className="px-3 py-2 text-sm text-text-muted">
                {t`Showing the first ${shownLimit} of ${optionTotal}. Type to narrow the list.`}
              </li>
            ) : null}
          </ul>
        </RadixPopover.Content>
      </RadixPopover.Portal>
      <output aria-live="polite" className="sr-only">
        {open && needle !== ""
          ? plural(optionCount, { one: `${optionTotal} match`, other: `${optionTotal} matches` })
          : ""}
      </output>
    </RadixPopover.Root>
  );
}
