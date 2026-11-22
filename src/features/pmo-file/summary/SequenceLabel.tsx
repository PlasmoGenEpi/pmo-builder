import { plural, t } from "@lingui/core/macro";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button, Popover, cn } from "@/ui";

/** Props for {@link SequenceLabel}. */
export interface SequenceLabelProps {
  /** Short display label for the microhaplotype. */
  readonly label: string;
  /** Full nucleotide sequence shown in the popover and copied to the clipboard. */
  readonly seq: string;
  /** Optional note about how the label was generated, such as a pseudoCIGAR description. */
  readonly note?: string | null;
  /** Optional classes on the trigger button, such as grid placement and sizing. */
  readonly className?: string;
}

type CopyState = "idle" | "copied" | "failed";

/** Body of the sequence popover, mounted only while open so copy state resets on close. */
function SequencePopoverBody({
  label,
  seq,
  note,
}: {
  readonly label: string;
  readonly seq: string;
  readonly note: string | null;
}) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const resetTimer = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current !== null) globalThis.clearTimeout(resetTimer.current);
    },
    [],
  );

  async function copy() {
    if (resetTimer.current !== null) {
      globalThis.clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }
    try {
      await navigator.clipboard.writeText(seq);
      setCopyState("copied");
      resetTimer.current = globalThis.setTimeout(() => {
        setCopyState("idle");
        resetTimer.current = null;
      }, 2000);
    } catch {
      setCopyState("failed");
    }
  }

  const baseCount = seq.length;
  const copied = copyState === "copied";
  const failed = copyState === "failed";

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-xs font-medium break-all text-text">{label}</p>
          <p className="text-xs text-text-muted">
            {plural(baseCount, { one: "# base", other: "# bases" })}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={copied ? Check : Copy}
          onClick={() => {
            void copy();
          }}
        >
          {copied
            ? t({
                message: "Copied",
                comment: "Button, after the value was copied to the clipboard",
              })
            : t({ message: "Copy", comment: "Button: copy the value to the clipboard" })}
        </Button>
      </div>
      <div className="max-h-60 overflow-y-auto rounded-md border border-border bg-surface-subtle p-2.5">
        <code className="block font-mono text-xs leading-5 break-all text-text select-all">
          {seq}
        </code>
      </div>
      {note !== null && note !== "" ? <p className="text-xs text-text-muted">{note}</p> : null}
      <output aria-live="polite" className={failed ? "text-xs text-warning-text" : "sr-only"}>
        {copied
          ? t`Sequence copied to clipboard.`
          : failed
            ? t`Could not copy. Select the sequence to copy it.`
            : ""}
      </output>
    </div>
  );
}

/**
 * A microhaplotype's short label as a button that opens a popover with the full
 * selectable sequence, any label note, and a copy action.
 */
export function SequenceLabel({ label, seq, note = null, className }: SequenceLabelProps) {
  const title = note !== null && note !== "" ? `${seq}\n${note}` : seq;
  return (
    <Popover
      align="start"
      label={t`Sequence for ${label}`}
      className="w-96! p-3!"
      trigger={
        <Button
          variant="ghost"
          size="sm"
          title={title}
          className={cn(
            "h-auto! min-h-6 max-w-full justify-start! px-1.5! py-0.5 text-left font-mono text-xs! font-normal! underline decoration-border-strong decoration-dotted underline-offset-2 hover:decoration-text",
            className,
          )}
        >
          <span className="min-w-0 truncate">{label}</span>
        </Button>
      }
    >
      <SequencePopoverBody label={label} seq={seq} note={note} />
    </Popover>
  );
}
