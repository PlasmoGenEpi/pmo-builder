import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Check, CloudUpload, Copy, Download, ExternalLink } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { StepLink } from "@/app/StepLink";
import type { MergeSummary, PublicationSummary } from "@/domain/build";
import { unreachable } from "@/domain/draft";
import { useActions, type DepositEnd } from "@/state";
import {
  Button,
  ButtonLink,
  Callout,
  Card,
  Dialog,
  Disclosure,
  formatBytes,
  Link,
  ProgressBar,
  RadioGroup,
  TextArea,
  TextField,
} from "@/ui";

import { CopyValue, useCopy } from "@/features/shared/CopyValue";

import { usePmoDownload } from "./usePmoDownload";
import {
  communityUrl,
  formatCreators,
  parseCreators,
  PERSONAL_FIELD_LABELS,
  zenodoRecordId,
  type Creator,
  suggestRecord,
  uploadUrl,
  type SuggestedRecord,
  type ZenodoConfig,
} from "./zenodo";
import { signIn, type SignInResult } from "./zenodoAuth";
import { depositDraft, type DepositFailure, type DepositStep } from "./zenodoDeposit";

/** The PMO to publish: the one built from the draft, or a file the user chose. */
export type PublishSource =
  | { readonly kind: "built" }
  | { readonly kind: "file"; readonly file: Blob; readonly fileName: string };

const BUILT: PublishSource = { kind: "built" };

/** Props for {@link PublishToZenodo}. */
export interface PublishToZenodoProps {
  readonly zenodo: ZenodoConfig;
  readonly summary: MergeSummary;
  readonly publication: PublicationSummary;
  /** Default: the PMO built from the draft. */
  readonly source?: PublishSource;
  /**
   * `inline` (default) sits under the download buttons of the review step.
   * `card` stands on its own on a page, with a level 2 heading.
   */
  readonly variant?: "inline" | "card";
}

function SubHeading({ children }: { readonly children: ReactNode }) {
  return <h3 className="text-sm font-medium text-text-subtle">{children}</h3>;
}

function NewTab() {
  return (
    <>
      <ExternalLink aria-hidden="true" className="size-4" />
      <span className="sr-only">
        <Trans>(opens in a new tab)</Trans>
      </span>
    </>
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
      aria-label={t`Copy keyword ${keyword}`}
    >
      {keyword}
      <span className="sr-only" aria-live="polite">
        {copied
          ? t({ message: "Copied", comment: "After a keyword was copied to the clipboard" })
          : ""}
      </span>
    </Button>
  );
}

function PersonalDetails({ publication }: { readonly publication: PublicationSummary }) {
  if (publication.personalFields.length === 0) {
    return (
      <Callout tone="info" title={t`No personal details found`}>
        <Trans>
          None of the specimen fields that most often identify a person have values. A published
          record is public and cannot be withdrawn, so look through the file once more before you
          publish.
        </Trans>
      </Callout>
    );
  }
  return (
    <Callout
      tone="warning"
      title={t`This PMO holds details about the people sampled`}
      action={
        <StepLink step="specimens" variant="arrow">
          <Trans>Go to Specimens</Trans>
        </StepLink>
      }
    >
      <div className="flex flex-col gap-2">
        <p>
          <Trans>
            A published record is public and cannot be withdrawn. Check that you may share each of
            these. To leave one out, set its column to None on the Specimens step.
          </Trans>
        </p>
        <ul className="list-disc pl-5">
          {publication.personalFields.map(({ field, specimens }) => {
            const fieldLabel = PERSONAL_FIELD_LABELS[field];
            return (
              <li key={field}>
                {plural(specimens, {
                  one: `${fieldLabel}, in # specimen`,
                  other: `${fieldLabel}, in # specimens`,
                })}
              </li>
            );
          })}
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
        <span className="text-sm font-medium text-text">
          <Trans>Title</Trans>
        </span>
        <CopyValue
          label={t({ message: "title", comment: 'Completes "Copy {label}": the record\'s title' })}
          value={record.title}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-text">
          <Trans>Description</Trans>
        </span>
        <CopyValue
          label={t({
            message: "description",
            comment: 'Completes "Copy {label}": the record\'s description',
          })}
          value={record.description}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-text">
          <Trans>Keywords</Trans>
        </span>
        <p className="text-sm text-text-muted">
          <Trans>
            Select a keyword to copy it. Keep the first one as it is written: it places the record
            with the other PMO files.
          </Trans>
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

/** The first step by hand when the user has a file: have it ready. */
function FileReady({ fileName }: { readonly fileName: string }) {
  return (
    <span>
      <Trans>
        Have your file ready: <span className="font-mono text-sm">{fileName}</span>.
      </Trans>
    </span>
  );
}

/** The steps for uploading the file to Zenodo by hand. */
function ManualSteps({
  community,
  source,
}: {
  readonly community: string;
  readonly source: PublishSource;
}) {
  const { busy, download } = usePmoDownload();
  return (
    <ol className="flex list-decimal flex-col gap-4 pl-5 text-base text-text">
      <li>
        {source.kind === "file" ? (
          <FileReady fileName={source.fileName} />
        ) : (
          <div className="flex flex-col items-start gap-2">
            <span>
              <Trans>Download the PMO file.</Trans>
            </span>
            <Button icon={Download} loading={busy === "gzip"} onClick={() => void download(true)}>
              <Trans>Download PMO for Zenodo</Trans>
            </Button>
          </div>
        )}
      </li>
      <li>
        <div className="flex flex-col items-start gap-2">
          <span>
            <Trans>
              Open the upload page and sign in to Zenodo. The community is already chosen.
            </Trans>
          </span>
          <ButtonLink href={uploadUrl(community)} target="_blank" rel="noreferrer noopener">
            <Trans>Open the Zenodo upload page</Trans>
            <NewTab />
          </ButtonLink>
        </div>
      </li>
      <li>
        <Trans>
          Add the file, choose Dataset as the resource type, and copy in the title, description and
          keywords. Add each keyword on its own. Choose a licence. The community prefers CC BY 4.0.
        </Trans>
      </li>
      <li>
        <Trans>Choose Submit for review. The record is published once a curator accepts it.</Trans>
      </li>
    </ol>
  );
}

type Phase =
  | { readonly kind: "idle" }
  | { readonly kind: "signing-in" }
  /** The PMO file is being made in the browser. */
  | { readonly kind: "preparing" }
  | {
      readonly kind: "depositing";
      readonly step: DepositStep;
      /** Bytes of the file sent so far and in all, once the upload reports them. */
      readonly sent: number | null;
      readonly total: number | null;
    }
  | {
      readonly kind: "done";
      readonly draftUrl: string;
      readonly version: boolean;
      readonly authors: boolean;
    }
  | { readonly kind: "failed"; readonly message: string; readonly draftUrl: string | null };

const STEP_TEXT: Readonly<Record<DepositStep, string>> = {
  community: t`Finding the community on Zenodo`,
  version: t`Starting a new version of the record`,
  draft: t`Creating the draft`,
  file: t`Uploading the file`,
  review: t`Asking the community to review it`,
};

/** How a failed sign-in is counted. */
const SIGN_IN_OUTCOMES: Readonly<
  Record<Exclude<SignInResult, { ok: true }>["reason"], DepositEnd>
> = {
  blocked: "pop-up-blocked",
  refused: "sign-in-refused",
  "timed-out": "sign-in-timed-out",
  cancelled: "cancelled",
};

function signInMessage(reason: Exclude<SignInResult, { ok: true }>["reason"]): string | null {
  switch (reason) {
    case "blocked":
      return t`Your browser stopped the Zenodo sign-in window. Allow pop-ups for this site and try again.`;
    case "refused":
      return t`Zenodo did not sign you in. Try again.`;
    case "timed-out":
      return t`The sign-in was not finished in time. Try again.`;
    case "cancelled":
      return null;
    default:
      return unreachable(reason);
  }
}

function depositMessage(failure: DepositFailure, step: DepositStep): string {
  switch (failure) {
    case "signed-out":
      return t`Zenodo no longer accepts the sign-in. Try again to sign in once more.`;
    case "not-allowed":
      return step === "review"
        ? t`The community could not be asked to review the draft. Choose the community on the draft yourself.`
        : t`Your Zenodo account may not do this.`;
    case "no-community":
      return t`The community could not be found on Zenodo.`;
    case "too-large":
      return t`The file is larger than Zenodo accepts.`;
    case "offline":
      return t`Zenodo could not be reached. Check your connection and try again.`;
    case "refused":
      return t`Zenodo did not accept the request. Try again in a few minutes.`;
    case "no-record":
      return t`That Zenodo record could not be found. Check its address or DOI.`;
    case "not-owner":
      return t`Only the account that owns a record can add a version to it. Sign in to Zenodo as its owner.`;
    case "other-community":
      return t`That record is not in the community, so a new version of it cannot be added here.`;
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

function isBusy(phase: Phase): boolean {
  return phase.kind === "signing-in" || phase.kind === "preparing" || phase.kind === "depositing";
}

/** A deposit in progress, and how to start or cancel one. */
/** What the user chose in the dialog. */
interface DepositChoice {
  readonly creators: readonly Creator[];
  /** The record to add a version to, by number, or `null` for a new record. */
  readonly newVersionOf: string | null;
}

interface DepositControl {
  readonly phase: Phase;
  readonly start: (choice: DepositChoice) => Promise<void>;
  readonly cancel: () => void;
}

/**
 * Signs the user in to Zenodo and prepares a draft there: the file, the
 * suggested details and the request to the community. The state is kept by
 * the caller, so it outlives the dialog the deposit is started from.
 */
function useDeposit(
  zenodo: ZenodoConfig,
  record: SuggestedRecord,
  blocked: boolean,
  source: PublishSource,
): DepositControl {
  const actions = useActions();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  /** Kept in memory only, so a second deposit does not ask to sign in again. */
  const token = useRef<string | null>(null);
  const waiting = useRef<AbortController | null>(null);
  useEffect(() => () => waiting.current?.abort(), []);

  async function start(choice: DepositChoice): Promise<void> {
    const clientId = zenodo.clientId;
    // The example data is never sent, whatever the screen offers.
    if (clientId === null || blocked) return;
    const report = (outcome: DepositEnd): void =>
      actions.notePublishing({ kind: "deposit-finished", outcome });
    // Reporting is synchronous, so the sign-in window below still opens from the click.
    actions.notePublishing({ kind: "deposit-started", source: source.kind });
    let access = token.current;
    if (access === null) {
      const controller = new AbortController();
      waiting.current = controller;
      setPhase({ kind: "signing-in" });
      // Nothing may be awaited before this call, or the browser blocks the window.
      const signed = await signIn({ clientId, signal: controller.signal });
      waiting.current = null;
      if (!signed.ok) {
        report(SIGN_IN_OUTCOMES[signed.reason]);
        const message = signInMessage(signed.reason);
        setPhase(message === null ? { kind: "idle" } : { kind: "failed", message, draftUrl: null });
        return;
      }
      access = signed.token;
      token.current = access;
    }
    setPhase({ kind: "preparing" });
    try {
      const file =
        source.kind === "file"
          ? { blob: source.file, fileName: source.fileName }
          : await actions.downloadPmo({ gzip: true });
      if (file === null) {
        report("failed");
        setPhase({
          kind: "failed",
          message: t`There is no PMO to deposit. Something changed. Check the steps on the page.`,
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
        creators: choice.newVersionOf === null ? choice.creators : [],
        newVersionOf: choice.newVersionOf,
        onStep: (step) => setPhase({ kind: "depositing", step, sent: null, total: null }),
        onProgress: (sent, total) => setPhase({ kind: "depositing", step: "file", sent, total }),
      });
      if (result.ok) {
        report("draft-ready");
        setPhase({
          kind: "done",
          draftUrl: result.draftUrl,
          version: choice.newVersionOf !== null,
          authors: choice.creators.length > 0,
        });
        return;
      }
      report(result.failure);
      if (result.failure === "signed-out") token.current = null;
      setPhase({
        kind: "failed",
        message: depositMessage(result.failure, result.step),
        draftUrl: result.draftUrl,
      });
    } catch (error) {
      console.error(error);
      report("failed");
      setPhase({
        kind: "failed",
        message: t`The deposit could not be finished. Try again. If it keeps failing, reload the page.`,
        draftUrl: null,
      });
    }
  }

  return { phase, start, cancel: () => waiting.current?.abort() };
}

function DraftLink({ draftUrl }: { readonly draftUrl: string }) {
  return (
    <ButtonLink variant="primary" href={draftUrl} target="_blank" rel="noreferrer noopener">
      <Trans>Open the draft on Zenodo</Trans>
      <NewTab />
    </ButtonLink>
  );
}

/** The button that starts a deposit, and how the deposit is going. */
function Deposit({
  deposit,
  record,
}: {
  readonly deposit: DepositControl;
  readonly record: SuggestedRecord;
}) {
  const { phase } = deposit;
  const busy = isBusy(phase);
  const [mode, setMode] = useState<"new" | "version">("new");
  const [authors, setAuthors] = useState(() => formatCreators(record.creators));
  const [versionOf, setVersionOf] = useState("");
  const [versionError, setVersionError] = useState<string | null>(null);

  function begin() {
    // Nothing may be awaited before the sign-in window opens, so checks here stay synchronous.
    if (mode === "version") {
      const id = zenodoRecordId(versionOf);
      if (id === null) {
        setVersionError(
          t`Enter the record's Zenodo address, such as https://zenodo.org/records/12345678, or its DOI.`,
        );
        return;
      }
      setVersionError(null);
      void deposit.start({ creators: [], newVersionOf: id });
      return;
    }
    void deposit.start({ creators: parseCreators(authors), newVersionOf: null });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-base text-text-muted">
        <Trans>
          You sign in to Zenodo in a new window. PMO Builder then sends your file from this browser
          straight to Zenodo and makes a draft. Nothing is published until you publish it on Zenodo.
        </Trans>
      </p>
      <RadioGroup
        label={t`Deposit as`}
        value={mode}
        onValueChange={setMode}
        disabled={busy}
        options={[
          {
            value: "new",
            label: t`A new record`,
            description: t`With a title, description and keywords written from your PMO, the authors below and the CC BY 4.0 licence. A curator reviews it.`,
          },
          {
            value: "version",
            label: t`A new version of a record I published`,
            description: t`Replaces the file and keeps the record's details and authors. It gets its own DOI, and the record's overall DOI points to it. It is already in the community, so there is no review.`,
          },
        ]}
      />
      {mode === "new" ? (
        <TextArea
          label={t`Authors`}
          hint={t`One to a line, as Family name, Given names. Taken from your PMO's project. Leave it empty to add them on Zenodo.`}
          value={authors}
          onChange={(event) => setAuthors(event.target.value)}
          rows={Math.min(8, Math.max(3, authors.split("\n").length + 1))}
          disabled={busy}
        />
      ) : (
        <TextField
          label={t`The record`}
          hint={t`Its Zenodo address or DOI, such as https://zenodo.org/records/12345678`}
          value={versionOf}
          onChange={(event) => {
            setVersionOf(event.target.value);
            setVersionError(null);
          }}
          error={versionError}
          disabled={busy}
        />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" size="lg" icon={CloudUpload} loading={busy} onClick={begin}>
          <Trans>Sign in to Zenodo and deposit</Trans>
        </Button>
        {phase.kind === "signing-in" ? (
          <Button variant="ghost" onClick={deposit.cancel}>
            <Trans>Cancel</Trans>
          </Button>
        ) : null}
      </div>
      <div aria-live="polite" className="flex flex-col gap-3">
        {phase.kind === "signing-in" ? (
          <p className="text-base text-text-muted">
            <Trans>Waiting for you to sign in to Zenodo in the other window.</Trans>
          </p>
        ) : null}
        {phase.kind === "preparing" ? (
          <p className="text-base text-text-muted">
            <Trans>Preparing the file</Trans>
          </p>
        ) : null}
        {phase.kind === "depositing" && phase.step !== "file" ? (
          <p className="text-base text-text-muted">{STEP_TEXT[phase.step]}</p>
        ) : null}
        {phase.kind === "depositing" && phase.step === "file" ? (
          <ProgressBar
            label={
              phase.sent === null || phase.total === null
                ? STEP_TEXT.file
                : uploadProgress(phase.sent, phase.total)
            }
            value={phase.sent}
            max={phase.total ?? 100}
          />
        ) : null}
        {phase.kind === "done" ? (
          <Callout
            tone="success"
            title={
              phase.version
                ? t`Your new version is ready on Zenodo`
                : t`Your draft is ready on Zenodo`
            }
            action={<DraftLink draftUrl={phase.draftUrl} />}
          >
            {phase.version
              ? t`Read it through and choose Publish. It joins the community straight away, as the record is already in it.`
              : phase.authors
                ? t`Check the authors, read the draft through and choose Submit for review. It is published once a curator of the community accepts it.`
                : t`Add the authors, read the draft through and choose Submit for review. It is published once a curator of the community accepts it.`}
          </Callout>
        ) : null}
        {phase.kind === "failed" ? (
          <Callout
            tone="error"
            title={t`The deposit was not finished`}
            action={
              phase.draftUrl === null ? undefined : (
                <Link href={phase.draftUrl} external variant="standalone">
                  <Trans>Open the draft on Zenodo</Trans>
                </Link>
              )
            }
          >
            {phase.message}
            {phase.draftUrl === null
              ? null
              : ` ${t`A draft was started. You can finish it on Zenodo, or delete it there and try again.`}`}
          </Callout>
        ) : null}
      </div>
    </div>
  );
}

/** The upload step with how much of the file has gone. */
function uploadProgress(sent: number, total: number): string {
  const sentSize = formatBytes(sent);
  const totalSize = formatBytes(total);
  return t`Uploading the file, ${sentSize} of ${totalSize}`;
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
  source,
}: {
  readonly zenodo: ZenodoConfig;
  readonly publication: PublicationSummary;
  readonly record: SuggestedRecord;
  readonly deposit: DepositControl;
  readonly source: PublishSource;
}) {
  return (
    <div className="flex flex-col gap-6">
      <Part title={t`Check what you are sharing`}>
        <PersonalDetails publication={publication} />
      </Part>
      {zenodo.clientId === null ? (
        <>
          <Part title={t`How to publish`}>
            <ManualSteps community={zenodo.community} source={source} />
          </Part>
          <Part title={t`Details to copy`}>
            <RecordDetails
              record={record}
              note={t`Written from what is in your PMO. Change them on Zenodo as you see fit.`}
            />
          </Part>
        </>
      ) : (
        <>
          <Part title={t({ message: "Deposit", comment: "Heading: send the file to Zenodo" })}>
            <Deposit deposit={deposit} record={record} />
          </Part>
          <Disclosure title={t`See what the draft will say`}>
            <div className="flex flex-col gap-4 pt-3">
              <RecordDetails
                record={record}
                note={t`Written from what is in your PMO. You can change them on Zenodo before you submit.`}
              />
            </div>
          </Disclosure>
          <Disclosure title={t`Upload it yourself instead`}>
            <div className="pt-3">
              <ManualSteps community={zenodo.community} source={source} />
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
export function PublishToZenodo({
  zenodo,
  summary,
  publication,
  source = BUILT,
  variant = "inline",
}: PublishToZenodoProps) {
  const record = useMemo(() => suggestRecord(summary, publication), [summary, publication]);
  const deposit = useDeposit(zenodo, record, publication.exampleData, source);
  const actions = useActions();
  const [open, setOpen] = useState(false);
  const direct = zenodo.clientId !== null;

  const Frame = variant === "card" ? CardFrame : InlineFrame;
  const communityName = zenodo.communityName;
  const communityLink = communityUrl(zenodo.community);

  if (publication.exampleData) {
    return (
      <Frame>
        <p className="max-w-prose text-base text-text-muted">
          {source.kind === "file" ? (
            <Trans>
              This file is built from the example data, so it cannot be published. With your own
              tables, you can add your PMO to the{" "}
              <Link href={communityLink} external>
                {communityName} community
              </Link>{" "}
              on Zenodo from here and get a DOI that others can cite.
            </Trans>
          ) : (
            <Trans>
              This PMO is built from the example data, so it cannot be published. With your own
              tables, you can add your PMO to the{" "}
              <Link href={communityLink} external>
                {communityName} community
              </Link>{" "}
              on Zenodo from here and get a DOI that others can cite.
            </Trans>
          )}
        </p>
      </Frame>
    );
  }

  return (
    <Frame>
      <p className="max-w-prose text-base text-text-muted">
        <Trans>
          Zenodo is a free research archive. Add your PMO to the{" "}
          <Link href={communityLink} external>
            {communityName} community
          </Link>{" "}
          there and it gets a DOI that others can cite.
        </Trans>
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Dialog
          open={open}
          onOpenChange={(next) => {
            if (next) actions.notePublishing({ kind: "publish-opened", source: source.kind });
            setOpen(next);
          }}
          size="lg"
          title={t`Publish to Zenodo`}
          description={
            direct
              ? t`A curator of the ${communityName} community checks each record before it joins the community's PMO files. Nothing goes to Zenodo until you choose to deposit below.`
              : t`A curator of the ${communityName} community checks each record before it joins the community's PMO files. PMO Builder sends nothing to Zenodo: you upload the file there yourself.`
          }
          trigger={
            <Button
              size="lg"
              icon={CloudUpload}
              // A long community name wraps on a phone instead of running off the card.
              className="max-sm:h-auto max-sm:min-h-control-lg max-sm:w-full max-sm:py-2 max-sm:whitespace-normal"
            >
              {direct ? t`Deposit in the ${communityName} community` : t`Publish to Zenodo`}
            </Button>
          }
        >
          <PublishBody
            zenodo={zenodo}
            publication={publication}
            record={record}
            deposit={deposit}
            source={source}
          />
        </Dialog>
        {!open && deposit.phase.kind === "done" ? (
          <span className="flex flex-wrap items-center gap-x-2 text-base text-text">
            <Trans>Your draft is ready.</Trans>
            <Link href={deposit.phase.draftUrl} external variant="standalone">
              <Trans>Open the draft on Zenodo</Trans>
            </Link>
          </span>
        ) : null}
        {!open && isBusy(deposit.phase) ? (
          <span className="text-base text-text-muted">
            <Trans>A deposit is under way.</Trans>
          </span>
        ) : null}
      </div>
    </Frame>
  );
}

/** Under the download buttons of the review step. */
function InlineFrame({ children }: { readonly children: ReactNode }) {
  return (
    <section
      aria-labelledby="review-publish-heading"
      className="flex flex-col gap-3 border-t border-border pt-5"
    >
      <h3 id="review-publish-heading" className="text-md font-semibold text-text">
        <Trans>Publish to Zenodo</Trans>
      </h3>
      {children}
    </section>
  );
}

/** On a page of its own. */
function CardFrame({ children }: { readonly children: ReactNode }) {
  return (
    <Card as="section" aria-labelledby="review-publish-heading">
      <div className="flex flex-col gap-3">
        <h2 id="review-publish-heading" className="text-lg font-semibold tracking-tight text-text">
          <Trans>Publish to Zenodo</Trans>
        </h2>
        {children}
      </div>
    </Card>
  );
}
