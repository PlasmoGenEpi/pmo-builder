import { t } from "@lingui/core/macro";
import type { ReactNode } from "react";

import {
  useAnalyticsPreference,
  useAnalyticsStatus,
  useTransparencyLog,
  type AnalyticsStatus,
  type TransparencyEntry,
} from "@/analytics";
import { zenodoConfig } from "@/features/review/zenodo";
import { CodeBlock, Disclosure, Switch } from "@/ui";

/**
 * The body of the "Your data stays on this device" dialog. The wording
 * follows `docs/privacy.md`. The dialog already has the title.
 */
export function PrivacyDetails({
  canDeposit = (zenodoConfig()?.clientId ?? null) !== null,
}: {
  /** Whether this copy can deposit a PMO on Zenodo when the user asks. */
  readonly canDeposit?: boolean;
} = {}) {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-md text-text">
        {canDeposit
          ? t`PMO Builder runs entirely in your browser. Your files, tables, sample names, sequences and metadata stay on this device. They leave it only if you choose to deposit a PMO on Zenodo. The app has no server of its own to upload them to.`
          : t`PMO Builder runs entirely in your browser. Your files, tables, sample names, sequences and metadata stay on this device. They are never uploaded, and the app has no server to upload them to.`}
      </p>

      <Section title={t`What stays on this device`}>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 marker:text-text-subtle">
          <li>{t`The files you open and everything in them.`}</li>
          <li>{t`Everything you type and every column you match.`}</li>
          <li>
            {t`The PMO file you build. It is made in the browser and saved straight to your computer.`}
          </li>
        </ul>
      </Section>

      <Section title={t`What this browser keeps`}>
        <p>
          {t`Your draft, including the files you opened, is saved in this browser so you can pick up where you left off. Panels you save to your library are kept there too, along with your theme and your choice about usage counts. A saved draft that could not be opened is kept aside until you save a new draft on a later visit, then deleted.`}
        </p>
        <p>
          {t`If your browser does not let the app store data, as in some private windows, the draft lasts only until you close or reload the page.`}
        </p>
        <p>
          {t`To remove your draft and its files, choose Start over, in the step list or the menu. To remove everything, including saved panels, clear this site's data in your browser's settings.`}
        </p>
      </Section>

      {canDeposit ? (
        <Section title={t`Depositing on Zenodo`}>
          <p>
            {t`If you choose to deposit on the review step, you sign in to Zenodo in its own window, and your PMO file, the record details and the authors you list go from this browser straight to Zenodo. Nothing goes to Zenodo before you choose that, and nothing passes through a server of ours. The sign-in is forgotten when you close or reload the page.`}
          </p>
        </Section>
      ) : null}

      <UsageCounts />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-md font-semibold text-text">{title}</h3>
      <div className="flex flex-col gap-2 text-base text-text">{children}</div>
    </section>
  );
}

/** Why records are or are not sent, in words for the user. */
function statusSentence(status: AnalyticsStatus): string {
  if (status.state === "on") {
    const destination = status.destination;
    return t`This copy sends anonymous usage counts to ${destination}. They help its maintainers see how much the app is used and where people get stuck.`;
  }
  switch (status.reason) {
    case "not-configured":
    case "invalid-destination":
      return t`This copy of PMO Builder does not send usage counts. Nothing is sent at all.`;
    case "global-privacy-control":
      return t`Your browser sends Global Privacy Control, so nothing is sent.`;
    case "do-not-track":
      return t`Your browser sends Do Not Track, so nothing is sent.`;
    case "switched-off":
      return t`You switched usage counts off in this browser, so nothing is sent.`;
    case "not-chosen":
      return t`Nothing is sent until you choose whether to send anonymous usage counts.`;
    default:
      return t`Nothing is sent.`;
  }
}

function UsageCounts() {
  const status = useAnalyticsStatus();
  const preference = useAnalyticsPreference();
  const configured =
    status.state === "on" ||
    (status.reason !== "not-configured" && status.reason !== "invalid-destination");
  const browserSaysNo =
    status.state === "off" &&
    (status.reason === "global-privacy-control" || status.reason === "do-not-track");

  return (
    <Section title={t`Usage counts`}>
      <p>{statusSentence(status)}</p>
      {configured ? (
        <>
          <p className="text-text-muted">
            {t`At most two small records are sent per visit. They say things like "the panel step was opened", "a table of 100 to 999 rows was imported" or "a deposit on Zenodo was started". They never contain your file names, column names, sample names, cell values or error messages, or which published dataset you looked at, and they carry no identifier, so two visits cannot be linked.`}
          </p>
          <Switch
            label={t`Send anonymous usage counts`}
            description={
              browserSaysNo
                ? t`Your browser setting stops them being sent, whatever this switch says.`
                : t`Your choice is remembered in this browser.`
            }
            checked={preference.enabled}
            onCheckedChange={preference.setEnabled}
            className="rounded-lg bg-surface-subtle px-4 py-3"
          />
        </>
      ) : null}
      <TransparencyLog configured={configured} />
    </Section>
  );
}

function entryHeading(entry: TransparencyEntry): string {
  if (entry.outcome === "sent") {
    const destination = entry.destination;
    return entry.kind === "visit"
      ? t`Visit record, sent to ${destination}`
      : t`Session record, sent to ${destination}`;
  }
  return entry.kind === "visit" ? t`Visit record, not sent` : t`Session record, not sent`;
}

function pretty(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return body;
  }
}

function TransparencyLog({ configured }: { configured: boolean }) {
  const { entries, pending } = useTransparencyLog();
  return (
    <Disclosure title={t`See exactly what is sent`} className="mt-1">
      <div className="flex flex-col gap-4">
        <p className="text-text-muted">
          {configured
            ? t`These are the exact records from this visit, as sent or as they would have been sent.`
            : t`Nothing leaves this copy. These are the records it would send if usage counts were set up, so you can see what they hold.`}
        </p>
        {entries.length === 0 ? (
          <p className="text-text-muted">{t`No record has been made yet on this visit.`}</p>
        ) : (
          entries.map((entry, index) => (
            // Entries are only ever appended, so the position is stable.
            // oxlint-disable-next-line react/no-array-index-key
            <div key={index} className="flex flex-col gap-1.5">
              <p className="text-sm font-medium text-text">{entryHeading(entry)}</p>
              <CodeBlock label={entryHeading(entry)} code={pretty(entry.body)} copyable={false} />
            </div>
          ))
        )}
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium text-text">
            {configured
              ? t`Session record so far, sent when you close the page`
              : t`Session record so far`}
          </p>
          {pending === null ? (
            <p className="text-text-muted">{t`Nothing yet. It fills in as you use the app.`}</p>
          ) : (
            <CodeBlock label={t`Session record so far`} code={pretty(pending)} copyable={false} />
          )}
        </div>
      </div>
    </Disclosure>
  );
}
