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
        PMO Builder runs entirely in your browser. Your files, tables, sample names, sequences and
        metadata stay on this device.{" "}
        {canDeposit
          ? "They leave it only if you choose to deposit a PMO on Zenodo. The app has no server of its own to upload them to."
          : "They are never uploaded, and the app has no server to upload them to."}
      </p>

      <Section title="What stays on this device">
        <ul className="flex list-disc flex-col gap-1.5 pl-5 marker:text-text-subtle">
          <li>The files you open and everything in them.</li>
          <li>Everything you type and every column you match.</li>
          <li>
            The PMO file you build. It is made in the browser and saved straight to your computer.
          </li>
        </ul>
      </Section>

      <Section title="What this browser keeps">
        <p>
          Your draft, including the files you opened, is saved in this browser so you can pick up
          where you left off. Panels you save to your library are kept there too, along with your
          theme and your choice about usage counts. A saved draft that could not be opened is kept
          aside until you save a new draft on a later visit, then deleted.
        </p>
        <p>
          If your browser does not let the app store data, as in some private windows, the draft
          lasts only until you close or reload the page.
        </p>
        <p>
          To remove your draft and its files, choose Start over in the menu. To remove everything,
          including saved panels, clear this site&apos;s data in your browser&apos;s settings.
        </p>
      </Section>

      {canDeposit ? (
        <Section title="Depositing on Zenodo">
          <p>
            If you choose to deposit on the review step, you sign in to Zenodo in its own window,
            and your PMO file and the record details go from this browser straight to Zenodo.
            Nothing goes to Zenodo before you choose that, and nothing passes through a server of
            ours. The sign-in is forgotten when you close or reload the page.
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
    return `This copy sends anonymous usage counts to ${status.destination}. They help its maintainers see how much the app is used and where people get stuck.`;
  }
  switch (status.reason) {
    case "not-configured":
    case "invalid-destination":
      return "This copy of PMO Builder does not send usage counts. Nothing is sent at all.";
    case "global-privacy-control":
      return "Your browser sends Global Privacy Control, so nothing is sent.";
    case "do-not-track":
      return "Your browser sends Do Not Track, so nothing is sent.";
    case "switched-off":
      return "You switched usage counts off in this browser, so nothing is sent.";
    default:
      return "Nothing is sent.";
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
    <Section title="Usage counts">
      <p>{statusSentence(status)}</p>
      {configured ? (
        <>
          <p className="text-text-muted">
            At most two small records are sent per visit. They say things like &quot;the panel step
            was opened&quot; or &quot;a table of 100 to 999 rows was imported&quot;. They never
            contain your file names, column names, sample names, cell values or error messages, and
            they carry no identifier, so two visits cannot be linked.
          </p>
          <Switch
            label="Send anonymous usage counts"
            description={
              browserSaysNo
                ? "Your browser setting stops them being sent, whatever this switch says."
                : "Your choice is remembered in this browser."
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
  const what = entry.kind === "visit" ? "Visit record" : "Session record";
  return entry.outcome === "sent" ? `${what}, sent to ${entry.destination}` : `${what}, not sent`;
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
    <Disclosure title="See exactly what is sent" className="mt-1">
      <div className="flex flex-col gap-4">
        <p className="text-text-muted">
          {configured
            ? "These are the exact records from this visit, as sent or as they would have been sent."
            : "Nothing leaves this copy. These are the records it would send if usage counts were set up, so you can see what they hold."}
        </p>
        {entries.length === 0 ? (
          <p className="text-text-muted">No record has been made yet on this visit.</p>
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
              ? "Session record so far, sent when you close the page"
              : "Session record so far"}
          </p>
          {pending === null ? (
            <p className="text-text-muted">Nothing yet. It fills in as you use the app.</p>
          ) : (
            <CodeBlock label="Session record so far" code={pretty(pending)} copyable={false} />
          )}
        </div>
      </div>
    </Disclosure>
  );
}
