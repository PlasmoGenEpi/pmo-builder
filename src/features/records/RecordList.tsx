import { ArrowDown, ArrowUp, Copy, Plus, Trash2, type LucideIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";

import { Button, Card, ConfirmDialog, EmptyState, IconButton } from "@/ui";

import type { RecordState } from "./checks";
import { RecordBadge } from "./RecordBadge";

/** Props for {@link RecordList}. */
export interface RecordListProps<T extends { readonly id: string }> {
  readonly items: readonly T[];
  /** What one item is, lower case, such as "sequencing run". */
  readonly noun: string;
  /** A card's title: the record's name, or a fallback such as "Sequencing run 2". */
  readonly title: (item: T, index: number) => string;
  /** Whether a record holds nothing. Removing one that holds something asks first. */
  readonly isBlank: (item: T) => boolean;
  /** Adds a blank record and returns its id, so its first field can take focus. */
  readonly onAdd: () => string;
  readonly onRemove: (id: string) => void;
  /** Moves a record. Give it only where order matters. */
  readonly onMove?: (id: string, toIndex: number) => void;
  /** Adds a copy of a record. Give it where records share most of their values. */
  readonly onDuplicate?: (id: string) => string;
  /** A record's form. */
  readonly children: (item: T, index: number) => ReactNode;
  /** Where a record stands, shown as a badge after its title. */
  readonly state?: (item: T) => RecordState;
  /** The add button's label, such as "Add a sequencing run". */
  readonly addLabel: string;
  /** The empty state. */
  readonly empty: {
    readonly icon?: LucideIcon;
    readonly title: string;
    readonly description: string;
  };
  /** Heading level of each card's title. Default 3. */
  readonly headingLevel?: 3 | 4;
  /** A sentence added to the removal question, such as which runs use this method. */
  readonly removeWarning?: (item: T) => string | null;
  /** `card` (default) for top-level records; `inset` for records inside a card, such as a method's steps. */
  readonly variant?: "card" | "inset";
  /** Hide the add button below the cards, for lists that offer it elsewhere. */
  readonly hideAdd?: boolean;
}

/** Puts focus on the first text control of a card once it is on screen. */
function useFocusCard(): (id: string) => void {
  const target = useRef<string | null>(null);
  // Runs after every render: the card exists once the store has the new record.
  useEffect(() => {
    if (target.current === null) return;
    const card = document.getElementById(`record-${target.current}`);
    if (card === null) return;
    target.current = null;
    const control = card.querySelector<HTMLElement>("input, textarea, button[role='combobox']");
    card.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    control?.focus({ preventScroll: true });
  });
  return useCallback((id: string) => {
    target.current = id;
  }, []);
}

function RemoveButton({
  name,
  needsConfirm,
  warning,
  onRemove,
}: {
  readonly name: string;
  readonly needsConfirm: boolean;
  readonly warning: string | null;
  readonly onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton
        icon={Trash2}
        label={`Remove ${name}`}
        onClick={() => (needsConfirm || warning !== null ? setOpen(true) : onRemove())}
      />
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Remove ${name}?`}
        description={`${warning === null ? "" : `${warning} `}What you typed for it will be gone. This cannot be undone.`}
        confirmLabel="Remove"
        tone="danger"
        onConfirm={onRemove}
      />
    </>
  );
}

/** One record's frame: a card, or inside a card a quieter frame, since cards are not nested. */
function Frame({
  variant,
  ...props
}: HTMLAttributes<HTMLElement> & {
  readonly variant: "card" | "inset";
  readonly children: ReactNode;
}) {
  if (variant === "card") return <Card as="article" {...props} />;
  return <article {...props} className="rounded-lg border border-border bg-surface-subtle p-4" />;
}

/**
 * Hand-entered records as cards titled by their names, with add, remove
 * (asking first when the record holds something) and, where order matters,
 * move up and down. With no records it shows an empty state with one action.
 */
export function RecordList<T extends { readonly id: string }>({
  items,
  noun,
  title,
  isBlank,
  onAdd,
  onRemove,
  onMove,
  onDuplicate,
  children,
  state,
  addLabel,
  empty,
  headingLevel = 3,
  removeWarning,
  variant = "card",
  hideAdd = false,
}: RecordListProps<T>) {
  const focusCard = useFocusCard();
  const Heading = headingLevel === 3 ? "h3" : "h4";
  const add = () => focusCard(onAdd());

  if (items.length === 0) {
    return (
      <EmptyState
        icon={empty.icon}
        title={empty.title}
        description={empty.description}
        action={
          <Button variant="primary" icon={Plus} onClick={add}>
            {addLabel}
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-col gap-5" aria-label={`${noun}s`}>
        {items.map((item, index) => {
          const name = title(item, index);
          const headingId = `record-${item.id}-title`;
          return (
            <li key={item.id}>
              <Frame variant={variant} id={`record-${item.id}`} aria-labelledby={headingId}>
                <div className="flex flex-col gap-5">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                      <Heading
                        id={headingId}
                        className="min-w-0 truncate text-md font-semibold text-text"
                      >
                        {name}
                      </Heading>
                      {state === undefined ? null : <RecordBadge state={state(item)} />}
                    </div>
                    <div className="-my-1 -mr-2 flex items-center gap-0.5">
                      {onMove !== undefined && items.length > 1 ? (
                        <>
                          <IconButton
                            icon={ArrowUp}
                            label={`Move ${name} up`}
                            disabled={index === 0}
                            onClick={() => onMove(item.id, index - 1)}
                          />
                          <IconButton
                            icon={ArrowDown}
                            label={`Move ${name} down`}
                            disabled={index === items.length - 1}
                            onClick={() => onMove(item.id, index + 1)}
                          />
                        </>
                      ) : null}
                      {onDuplicate === undefined || isBlank(item) ? null : (
                        <IconButton
                          icon={Copy}
                          label={`Copy ${name} into a new ${noun}`}
                          onClick={() => focusCard(onDuplicate(item.id))}
                        />
                      )}
                      {items.length === 1 && isBlank(item) ? null : (
                        <RemoveButton
                          name={name}
                          needsConfirm={!isBlank(item)}
                          warning={removeWarning?.(item) ?? null}
                          onRemove={() => onRemove(item.id)}
                        />
                      )}
                    </div>
                  </div>
                  {children(item, index)}
                </div>
              </Frame>
            </li>
          );
        })}
      </ol>
      {hideAdd ? null : (
        <div>
          <Button icon={Plus} onClick={add}>
            {addLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
