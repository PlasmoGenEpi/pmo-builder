import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link as RouterLink } from "wouter";

import { BUILD_PATH } from "@/app/steps";
// By path, not the barrel: the barrel would bring pmotools-ts onto the main thread.
import { PUBLISHABLE_PMO_VERSION, type PmoFileCheck } from "@/domain/build/checkFileResult";
import type { OpenState } from "@/state";
import { Callout, buttonClassName, formatBytes } from "@/ui";

/** Why a file cannot be opened, as one sentence. Returns `null` when valid or when {@link Invalid} lists schema problems instead. */
export function refusal(file: OpenState): string | null {
  const version = PUBLISHABLE_PMO_VERSION;
  if (file.kind === "failed")
    return file.cause === "lost"
      ? t`The file was closed, probably because the browser ran out of memory. Open the file again.`
      : t`The file could not be opened. Reload the page and try again.`;
  if (file.kind !== "refused") return null;
  const { check } = file;
  switch (check.kind) {
    case "too-large": {
      const sizeLimit = formatBytes(check.limit);
      return t`This file is larger than ${sizeLimit}, more than this browser can open.`;
    }
    case "unreadable":
      if (check.reason === "gzip")
        return t`This file looks gzipped but could not be unpacked. Check that it downloaded completely.`;
      if (check.reason === "json")
        return t`This is not a PMO file. A PMO file holds JSON and is saved as .json or .json.gz.`;
      return t`This JSON file is not a PMO: it has no PMO header.`;
    case "wrong-version": {
      const declared = check.declared;
      return declared === null
        ? t`This file does not say which PMO version it is. Only version ${version} files can be opened here. Build it again from your tables to get a ${version} file.`
        : t`This file is in PMO version ${declared}. Only version ${version} files can be opened here. Build it again from your tables to get a ${version} file.`;
    }
    case "invalid":
      return null;
    default:
      return null;
  }
}

/** Props for {@link Invalid}. */
export interface InvalidProps {
  readonly check: Extract<PmoFileCheck, { kind: "invalid" }>;
  /** Optional introductory line above the problem list. Defaults to guidance for the user's own file. */
  readonly intro?: ReactNode;
  /** Optional action control in the callout header. Defaults to linking to Build. */
  readonly action?: ReactNode;
}

/** What does not match the PMO format, for a file refused as invalid. */
export function Invalid({ check, intro, action }: InvalidProps) {
  const rest = check.unlisted;
  const resolvedAction =
    action === undefined ? (
      <RouterLink
        href={BUILD_PATH}
        className={buttonClassName({ variant: "secondary", size: "sm" })}
      >
        <Trans>Build a PMO</Trans>
        <ArrowRight aria-hidden="true" className="size-3.5" />
      </RouterLink>
    ) : (
      action
    );
  return (
    <Callout
      tone="error"
      live
      title={t`This file does not match the PMO format`}
      action={resolvedAction}
    >
      <div className="flex flex-col gap-2">
        <p>
          {intro ?? (
            <Trans>
              It cannot be used as it is. Build the PMO again from your tables in PMO Builder, which
              checks it as you go.
            </Trans>
          )}
        </p>
        <ul className="list-disc pl-5">
          {check.problems.map((problem) => (
            <li key={problem} className="break-words">
              {problem}
            </li>
          ))}
        </ul>
        {rest > 0 ? (
          <p>
            {plural(rest, {
              one: "# more problem is not listed.",
              other: "# more problems are not listed.",
            })}
          </p>
        ) : null}
      </div>
    </Callout>
  );
}
