import { t } from "@lingui/core/macro";
import { Check, Copy } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { Button } from "./Button";
import { cn } from "./cn";
import { formatBytes } from "./format";

/** Props for {@link CodeBlock}. */
export interface CodeBlockProps {
  /** Accessible name of the block, such as "PMO preview". */
  label: string;
  /** The text to show. Can be several megabytes. */
  code: string;
  /** Characters shown at first and added by each "Show more". */
  chunkSize?: number;
  /** Show a Copy button that copies the whole text, not only the visible part. */
  copyable?: boolean;
  className?: string;
}

/** Cuts at the last line break before `limit`, so lines are never split. */
function cut(code: string, limit: number): string {
  if (code.length <= limit) return code;
  const lineEnd = code.lastIndexOf("\n", limit);
  return code.slice(0, lineEnd > limit / 2 ? lineEnd : limit);
}

/**
 * Shows preformatted text such as a JSON preview. Large text is shown in parts
 * with a "Show more" control, so a file of a few megabytes does not freeze the page.
 */
export function CodeBlock({
  label,
  code,
  chunkSize = 40_000,
  copyable = true,
  className,
}: CodeBlockProps) {
  const statusId = useId();
  const [limit, setLimit] = useState(chunkSize);
  const [copied, setCopied] = useState(false);
  const visible = cut(code, limit);
  const truncated = visible.length < code.length;
  const totalBytes = useMemo(() => new TextEncoder().encode(code).length, [code]);
  const visibleSize = formatBytes(visible.length);
  const totalSize = formatBytes(totalBytes);
  const hiddenSize = formatBytes(code.length - visible.length);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-surface-subtle",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-1.5">
        <span id={statusId} className="text-sm text-text-muted">
          {truncated ? t`Showing ${visibleSize} of ${totalSize}` : totalSize}
        </span>
        {copyable ? (
          <Button
            size="sm"
            variant="ghost"
            icon={copied ? Check : Copy}
            onClick={() => {
              void copy();
            }}
          >
            {copied ? t`Copied` : t`Copy`}
          </Button>
        ) : null}
      </div>
      <section
        aria-label={label}
        aria-describedby={statusId}
        // Focusable so keyboard users can scroll it.
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        className="max-h-[32rem] overflow-auto focus-visible:outline-offset-[-2px]"
      >
        <pre className="w-max min-w-full p-4 font-mono text-xs leading-5 text-text">
          <code>{visible}</code>
        </pre>
      </section>
      {truncated ? (
        <div className="flex items-center gap-3 border-t border-border px-3 py-2">
          <Button size="sm" onClick={() => setLimit((current) => current + chunkSize * 4)}>
            {t`Show more`}
          </Button>
          <span className="text-sm text-text-muted">{t`${hiddenSize} not shown`}</span>
        </div>
      ) : null}
    </div>
  );
}
