import { t } from "@lingui/core/macro";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/ui";

/** Copies `value` and reports that it did for two seconds. */
export function useCopy(value: string): {
  readonly copied: boolean;
  readonly copy: () => Promise<void>;
} {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      globalThis.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return { copied, copy };
}

/** A value to paste into Zenodo, with a button that copies it. */
export function CopyValue({
  copyLabel,
  value,
}: {
  /** The copy button's accessible name, as a whole phrase, such as "Copy title". */
  readonly copyLabel: string;
  readonly value: string;
}) {
  const { copied, copy } = useCopy(value);
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-subtle p-3">
      <p className="min-w-0 flex-1 text-base break-words text-text">{value}</p>
      <Button
        size="sm"
        icon={copied ? Check : Copy}
        onClick={() => void copy()}
        aria-label={copyLabel}
      >
        <span aria-live="polite">
          {copied
            ? t({
                message: "Copied",
                comment: "Button, after the value was copied to the clipboard",
              })
            : t({ message: "Copy", comment: "Button: copy the value to the clipboard" })}
        </span>
      </Button>
    </div>
  );
}
