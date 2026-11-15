import { Check, CloudUpload, Copy, Download, ExternalLink } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { StepLink } from "@/app/StepLink";
import type { MergeSummary, PublicationSummary } from "@/domain/build";
import { unreachable } from "@/domain/draft";
import { useActions } from "@/state";
import { Button, ButtonLink, Callout, Dialog, Disclosure, Link } from "@/ui";

import { count } from "./reviewModel";
import { usePmoDownload } from "./usePmoDownload";
import {
  communityUrl,
  PERSONAL_FIELD_LABELS,
  suggestRecord,
  uploadUrl,
  type SuggestedRecord,
  type ZenodoConfig,
} from "./zenodo";
import { signIn, type SignInResult } from "./zenodoAuth";
import { depositDraft, type DepositFailure, type DepositStep } from "./zenodoDeposit";

/** Props for {@link PublishToZenodo}. */
export interface PublishToZenodoProps {
  readonly zenodo: ZenodoConfig;
  readonly summary: MergeSummary;
  readonly publication: PublicationSummary;
}

function SubHeading({ children }: { readonly children: ReactNode }) {
  return <h3 className="text-sm font-medium text-text-subtle">{children}</h3>;
}

function NewTab() {
  return (
    <>
      <ExternalLink aria-hidden="true" className="size-4" />
      <span className="sr-only">(opens in a new tab)</span>
    </>
  );
}

/** Copies `value` and reports that it did for two seconds. */
function useCopy(value: string): { readonly copied: boolean; readonly copy: () => Promise<void> } {
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
function CopyValue({ label, value }: { readonly label: string; readonly value: string }) {
  const { copied, copy } = useCopy(value);
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-subtle p-3">
      <p className="min-w-0 flex-1 text-base break-words text-text">{value}</p>
      <Button
        size="sm"
        icon={copied ? Check : Copy}
        onClick={() => void copy()}
        aria-label={`Copy ${label}`}
      >
        <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
      </Button>
    </div>
  );
}

/** One keyword as a button that copies it. */
function KeywordChip({ keyword }: { readonly keyword: string }) {
  const { copied, copy } = useCopy(keyword);
  return (
    <Button
      size="sm"
      icon={copied ? Check : Copy}
      onClick={() => void copy()}
      aria-label={`Copy keyword ${keyword}`}
    >
      {keyword}
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </Button>
  );
}

function PersonalDetails({ publication }: { readonly publication: PublicationSummary }) {
  if (publication.personalFields.length === 0) {
    return (
      <Callout tone="info" title="No personal details found">
        None of the specimen fields that most often identify a person have values. A published
        record is public and cannot be withdrawn, so look through the file once more before you
        publish.
      </Callout>
    );
  }
  return (
    <Callout
      tone="warning"
      title="This PMO holds details about the people sampled"
      action={
        <StepLink step="specimens" variant="arrow">
          Go to Specimens
        </StepLink>
      }
    >
      <div className="flex flex-col gap-2">
        <p>
          A published record is public and cannot be withdrawn. Check that you may share each of
          these. To leave one out, set its column to None on the Specimens step.
        </p>
        <ul className="list-disc pl-5">
          {publication.personalFields.map(({ field, specimens }) => (
            <li key={field}>
              {PERSONAL_FIELD_LABELS[field]}, in {count(specimens, "specimen")}
            </li>
          ))}
        </ul>
      </div>
    </Callout>
  );
}

/** The suggested title, description and keywords, each with a way to copy it. */
function RecordDetails({
  record,
  note,
}: {
  readonly record: SuggestedRecord;
  readonly note: string;
}) {
  return (
    <>
      <p className="max-w-prose text-base text-text-muted">{note}</p>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-text">Title</span>
        <CopyValue label="title" value={record.title} />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-text">Description</span>
        <CopyValue label="description" value={record.description} />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-text">Keywords</span>
        <p className="text-sm text-text-muted">
          Select a keyword to copy it. Keep the first one as it is written: it places the record
          with the other PMO files.
        </p>
        <ul className="flex flex-wrap gap-2">
          {record.keywords.map((keyword) => (
            <li key={keyword}>
              <KeywordChip keyword={keyword} />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/** The steps for uploading the file to Zenodo by hand. */
function ManualSteps({ community }: { readonly community: string }) {
  const { busy, download } = usePmoDownload();
  return (
    <ol className="flex list-decimal flex-col gap-4 pl-5 text-base text-text">
      <li>
        <div className="flex flex-col items-start gap-2">
          <span>Download the PMO file.</span>
          <Button icon={Download} loading={busy === "gzip"} onClick={() => void download(true)}>
            Download PMO for Zenodo
          </Button>
        </div>
      </li>
      <li>
        <div className="flex flex-col items-start gap-2">
          <span>Open the upload page and sign in to Zenodo. The community is already chosen.</span>
          <ButtonLink href={uploadUrl(community)} target="_blank" rel="noreferrer noopener">
            Open the Zenodo upload page
            <NewTab />
          </ButtonLink>
        </div>
      </li>
      <li>
        Add the file, choose Dataset as the resource type, and copy in the title, description and
        keywords. Add each keyword on its own. Choose a licence. The community prefers CC BY 4.0.
      </li>
      <li>Choose Submit for review. The record is published once a curator accepts it.</li>
    </ol>
  );
}

type Phase =
  | { readonly kind: "idle" }
  | { readonly kind: "signing-in" }
  | { readonly kind: "depositing"; readonly step: DepositStep }
  | { readonly kind: "done"; readonly draftUrl: string }
  | { readonly kind: "failed"; readonly message: string; readonly draftUrl: string | null };

const STEP_TEXT: Readonly<Record<DepositStep, string>> = {
  community: "Finding the community on Zenodo",
  draft: "Creating the draft",
  file: "Uploading the file",
  review: "Asking the community to review it",
};

function signInMessage(reason: Exclude<SignInResult, { ok: true }>["reason"]): string | null {
  switch (reason) {
    case "blocked":
      return "Your browser stopped the Zenodo sign-in window. Allow pop-ups for this site and try again.";
    case "refused":
      return "Zenodo did not sign you in. Try again.";
    case "timed-out":
      return "The sign-in was not finished in time. Try again.";
    case "cancelled":
      return null;
    default:
      return unreachable(reason);
  }
}

function depositMessage(failure: DepositFailure, step: DepositStep): string {
  switch (failure) {
    case "signed-out":
      return "Zenodo no longer accepts the sign-in. Try again to sign in once more.";
    case "not-allowed":
      return step === "review"
        ? "The community could not be asked to review the draft. Choose the community on the draft yourself."
        : "Your Zenodo account may not do this.";
    case "no-community":
      return "The community could not be found on Zenodo.";
    case "too-large":
      return "The file is larger than Zenodo accepts.";
    case "offline":
      return "Zenodo could not be reached. Check your connection and try again.";
    case "refused":
      return "Zenodo did not accept the request. Try again in a few minutes.";
    default:
      return unreachable(failure);
  }
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Today in the user's own time zone, as `YYYY-MM-DD`. */
function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A deposit in progress, and how to start or cancel one. */
interface DepositControl {
  readonly phase: Phase;
  readonly start: () => Promise<void>;
  readonly cancel: () => void;
}

/**
 * Signs the user in to Zenodo and prepares a draft there: the file, the
 * suggested details and the request to the community. The state is kept by
 * the caller, so it outlives the dialog the deposit is started from.
 */
function useDeposit(zenodo: ZenodoConfig, record: SuggestedRecord): DepositControl {
  const actions = useActions();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  /** Kept in memory only, so a second deposit does not ask to sign in again. */
  const token = useRef<string | null>(null);
  const waiting = useRef<AbortController | null>(null);
  useEffect(() => () => waiting.current?.abort(), []);

  async function start(): Promise<void> {
    const clientId = zenodo.clientId;
    if (clientId === null) return;
    let access = token.current;
    if (access === null) {
      const controller = new AbortController();
      waiting.current = controller;
      setPhase({ kind: "signing-in" });
      // Nothing may be awaited before this call, or the browser blocks the window.
      const signed = await signIn({ clientId, signal: controller.signal });
      waiting.current = null;
      if (!signed.ok) {
        const message = signInMessage(signed.reason);
        setPhase(message === null ? { kind: "idle" } : { kind: "failed", message, draftUrl: null });
        return;
      }
      access = signed.token;
      token.current = access;
    }
    setPhase({ kind: "depositing", step: "community" });
    try {
      const file = await actions.downloadPmo({ gzip: true });
      if (file === null) {
        setPhase({
          kind: "failed",
          message: "There is no PMO to deposit. Something changed. Check the steps on the page.",
          draftUrl: null,
        });
        return;
      }
      const result = await depositDraft({
        token: access,
        community: zenodo.community,
        file: file.blob,
        fileName: file.fileName,
        record,
        date: today(),
        onStep: (step) => setPhase({ kind: "depositing", step }),
      });
      if (result.ok) {
        setPhase({ kind: "done", draftUrl: result.draftUrl });
        return;
      }
      if (result.failure === "signed-out") token.current = null;
      setPhase({
        kind: "failed",
        message: depositMessage(result.failure, result.step),
        draftUrl: result.draftUrl,
      });
    } catch (error) {
      console.error(error);
      setPhase({
        kind: "failed",
        message:
          "The deposit could not be finished. Try again. If it keeps failing, reload the page.",
        draftUrl: null,
      });
    }
  }

  return { phase, start, cancel: () => waiting.current?.abort() };
}

function DraftLink({ draftUrl }: { readonly draftUrl: string }) {
  return (
    <ButtonLink variant="primary" href={draftUrl} target="_blank" rel="noreferrer noopener">
      Open the draft on Zenodo
      <NewTab />
    </ButtonLink>
  );
}

/** The button that starts a deposit, and how the deposit is going. */
function Deposit({ deposit }: { readonly deposit: DepositControl }) {
  const { phase } = deposit;
  const busy = phase.kind === "signing-in" || phase.kind === "depositing";

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-base text-text-muted">
        You sign in to Zenodo in a new window. PMO Builder then sends your file from this browser
        straight to Zenodo and makes a draft, with a title, description and keywords written from
        your PMO and the CC BY 4.0 licence. Nothing is published until you submit the draft on
        Zenodo.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          size="lg"
          icon={CloudUpload}
          loading={busy}
          onClick={() => void deposit.start()}
        >
          Sign in to Zenodo and deposit
        </Button>
        {phase.kind === "signing-in" ? (
          <Button variant="ghost" onClick={deposit.cancel}>
            Cancel
          </Button>
        ) : null}
      </div>
      <div aria-live="polite" className="flex flex-col gap-3">
        {phase.kind === "signing-in" ? (
          <p className="text-base text-text-muted">
            Waiting for you to sign in to Zenodo in the other window.
          </p>
        ) : null}
        {phase.kind === "depositing" ? (
          <p className="text-base text-text-muted">{STEP_TEXT[phase.step]}</p>
        ) : null}
        {phase.kind === "done" ? (
          <Callout
            tone="success"
            title="Your draft is ready on Zenodo"
            action={<DraftLink draftUrl={phase.draftUrl} />}
          >
            Add the authors, read the draft through and choose Submit for review. It is published
            once a curator of the community accepts it.
          </Callout>
        ) : null}
        {phase.kind === "failed" ? (
          <Callout
            tone="error"
            title="The deposit was not finished"
            action={
              phase.draftUrl === null ? undefined : (
                <Link href={phase.draftUrl} external variant="standalone">
                  Open the draft on Zenodo
                </Link>
              )
            }
          >
            {phase.message}
            {phase.draftUrl === null
              ? null
              : " A draft was started. You can finish it on Zenodo, or delete it there and try again."}
          </Callout>
        ) : null}
      </div>
    </div>
  );
}

function Part({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <SubHeading>{title}</SubHeading>
      {children}
    </div>
  );
}

/** What the dialog holds: the check, the record details, and the deposit or the steps by hand. */
function PublishBody({
  zenodo,
  publication,
  record,
  deposit,
}: {
  readonly zenodo: ZenodoConfig;
  readonly publication: PublicationSummary;
  readonly record: SuggestedRecord;
  readonly deposit: DepositControl;
}) {
  return (
    <div className="flex flex-col gap-6">
      <Part title="Check what you are sharing">
        <PersonalDetails publication={publication} />
      </Part>
      {zenodo.clientId === null ? (
        <>
          <Part title="How to publish">
            <ManualSteps community={zenodo.community} />
          </Part>
          <Part title="Details to copy">
            <RecordDetails
              record={record}
              note="Written from what is in your PMO. Change them on Zenodo as you see fit."
            />
          </Part>
        </>
      ) : (
        <>
          <Part title="Deposit">
            <Deposit deposit={deposit} />
          </Part>
          <Disclosure title="See what the draft will say">
            <div className="flex flex-col gap-4 pt-3">
              <RecordDetails
                record={record}
                note="Written from what is in your PMO. You can change them on Zenodo before you submit."
              />
            </div>
          </Disclosure>
          <Disclosure title="Upload it yourself instead">
            <div className="pt-3">
              <ManualSteps community={zenodo.community} />
            </div>
          </Disclosure>
        </>
      )}
    </div>
  );
}

/**
 * Publishing the built PMO to a Zenodo community. A short invitation sits
 * with the download buttons; its button opens a dialog with what to check
 * first, the record details, and either a deposit that prepares the draft
 * for the user or the steps for uploading by hand. The app contacts Zenodo
 * only when the user chooses to deposit.
 */
export function PublishToZenodo({ zenodo, summary, publication }: PublishToZenodoProps) {
  const record = useMemo(() => suggestRecord(summary, publication), [summary, publication]);
  const deposit = useDeposit(zenodo, record);
  const [open, setOpen] = useState(false);
  const direct = zenodo.clientId !== null;

  return (
    <section
      aria-labelledby="review-publish-heading"
      className="flex flex-col gap-3 border-t border-border pt-5"
    >
      <h3 id="review-publish-heading" className="text-md font-semibold text-text">
        Publish to Zenodo
      </h3>
      <p className="max-w-prose text-base text-text-muted">
        Zenodo is a free research archive. Add your PMO to the{" "}
        <Link href={communityUrl(zenodo.community)} external>
          {zenodo.communityName} community
        </Link>{" "}
        there and it gets a DOI that others can cite.
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Dialog
          open={open}
          onOpenChange={setOpen}
          size="lg"
          title="Publish to Zenodo"
          description={
            direct
              ? `A curator of the ${zenodo.communityName} community checks each record before it joins the community's PMO files. Nothing goes to Zenodo until you choose to deposit below.`
              : `A curator of the ${zenodo.communityName} community checks each record before it joins the community's PMO files. PMO Builder sends nothing to Zenodo: you upload the file there yourself.`
          }
          trigger={
            <Button
              size="lg"
              icon={CloudUpload}
              // A long community name wraps on a phone instead of running off the card.
              className="max-sm:h-auto max-sm:min-h-control-lg max-sm:w-full max-sm:py-2 max-sm:whitespace-normal"
            >
              {direct ? `Deposit in the ${zenodo.communityName} community` : "Publish to Zenodo"}
            </Button>
          }
        >
          <PublishBody
            zenodo={zenodo}
            publication={publication}
            record={record}
            deposit={deposit}
          />
        </Dialog>
        {!open && deposit.phase.kind === "done" ? (
          <span className="flex flex-wrap items-center gap-x-2 text-base text-text">
            Your draft is ready.
            <Link href={deposit.phase.draftUrl} external variant="standalone">
              Open the draft on Zenodo
            </Link>
          </span>
        ) : null}
        {!open && (deposit.phase.kind === "signing-in" || deposit.phase.kind === "depositing") ? (
          <span className="text-base text-text-muted">A deposit is under way.</span>
        ) : null}
      </div>
    </section>
  );
}
