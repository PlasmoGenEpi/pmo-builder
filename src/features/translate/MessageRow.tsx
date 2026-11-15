import { Check, CircleCheck, Pencil } from "lucide-react";
import { useState } from "react";

import { translationProblem } from "@/i18n/messageShape";
import { Badge, Button, Card, TextArea } from "@/ui";

import type { ReviewResult, ReviewSuggestion } from "./reviewApi";
import type { ReviewItem } from "./reviewModel";

/** What the row asks the page to send. */
export type SendVerdict = (
  item: ReviewItem,
  verdict: { readonly verdict: "ok" | "edit"; readonly text: string },
) => Promise<ReviewResult<ReviewSuggestion>>;

/** Props for {@link MessageRow}. */
export interface MessageRowProps {
  readonly item: ReviewItem;
  /** The language's own code, for the `lang` attribute. */
  readonly locale: string;
  /** The language's English name, such as "French". */
  readonly language: string;
  /** False until the reviewer has given their name. */
  readonly canSend: boolean;
  readonly reviewer: string;
  readonly onSend: SendVerdict;
}

type RowState =
  | { readonly kind: "idle" }
  | { readonly kind: "editing"; readonly text: string }
  | { readonly kind: "sending"; readonly text: string | null }
  | { readonly kind: "error"; readonly message: string; readonly text: string | null };

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

function when(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "" : DATE.format(date);
}

function failure(result: ReviewResult<unknown>): string {
  if (result.kind === "link")
    return "Not sent: this review link no longer works. Ask the person who sent it for a new one.";
  return "Not sent. Check your connection and try again.";
}

function SuggestionLine({
  suggestion,
  locale,
  reviewer,
}: {
  readonly suggestion: ReviewSuggestion;
  readonly locale: string;
  readonly reviewer: string;
}) {
  const name = suggestion.reviewer === reviewer ? "You" : suggestion.reviewer;
  const date = when(suggestion.at);
  if (suggestion.verdict === "ok") {
    return (
      <li className="flex items-start gap-1.5 text-sm text-text-muted">
        <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
        <span>
          {name} said this looks right{date === "" ? "" : `, ${date}`}.
        </span>
      </li>
    );
  }
  return (
    <li className="flex items-start gap-1.5 text-sm text-text-muted">
      <Pencil aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
      <span>
        {name} suggested{date === "" ? "" : ` on ${date}`}:{" "}
        <span lang={locale} className="whitespace-pre-wrap break-words text-text">
          {suggestion.text}
        </span>
      </span>
    </li>
  );
}

/** One message: the English, the translation, what reviewers said, and the reviewer's own verdict. */
export function MessageRow({ item, locale, language, canSend, reviewer, onSend }: MessageRowProps) {
  const [state, setState] = useState<RowState>({ kind: "idle" });
  const { entry } = item;
  const editing = state.kind === "editing" || (state.kind !== "idle" && state.text !== null);
  const draft = state.kind === "idle" ? entry.msgstr : (state.text ?? entry.msgstr);
  const problem = editing ? translationProblem(entry.msgid, draft) : null;
  const unchanged = draft.trim() === entry.msgstr.trim();
  const alreadyApproved = item.suggestions.some(
    (suggestion) => suggestion.verdict === "ok" && suggestion.reviewer === reviewer,
  );

  async function send(verdict: "ok" | "edit", text: string): Promise<void> {
    setState({ kind: "sending", text: verdict === "edit" ? text : null });
    const result = await onSend(item, { verdict, text });
    if (result.kind === "ok") setState({ kind: "idle" });
    else
      setState({
        kind: "error",
        message: failure(result),
        text: verdict === "edit" ? text : null,
      });
  }

  return (
    <Card as="article" padding="sm" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium tracking-wide text-text-subtle uppercase">
            English
          </span>
          {item.status === "approved" ? (
            <Badge tone="success" icon={CircleCheck}>
              Checked
            </Badge>
          ) : item.status === "changes" ? (
            <Badge tone="warning" icon={Pencil}>
              Change suggested
            </Badge>
          ) : null}
        </div>
        <p lang="en" className="whitespace-pre-wrap break-words text-md text-text">
          {entry.msgid}
        </p>
        {entry.context === "" ? null : (
          <p className="text-sm text-text-muted">Meaning here: {entry.context}</p>
        )}
        {entry.notes.map((note) => (
          <p key={note} className="text-sm text-text-muted">
            Note: {note}
          </p>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium tracking-wide text-text-subtle uppercase">
          {language}
        </span>
        {entry.msgstr === "" ? (
          <p className="text-md text-text-muted italic">Not translated yet: the English shows.</p>
        ) : (
          <p lang={locale} className="whitespace-pre-wrap break-words text-md text-text">
            {entry.msgstr}
          </p>
        )}
      </div>

      {item.suggestions.length === 0 ? null : (
        <ul className="flex flex-col gap-1">
          {item.suggestions.map((suggestion) => (
            <SuggestionLine
              key={suggestion.id}
              suggestion={suggestion}
              locale={locale}
              reviewer={reviewer}
            />
          ))}
        </ul>
      )}

      {editing ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (problem === null && !unchanged) void send("edit", draft);
          }}
        >
          <TextArea
            label={`Your ${language} wording`}
            lang={locale}
            rows={Math.min(8, Math.max(2, Math.ceil(draft.length / 70)))}
            value={draft}
            onChange={(event) => setState({ kind: "editing", text: event.target.value })}
            error={problem ?? undefined}
            hint="Keep words in braces, such as {fileName}, as they are."
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              size="sm"
              variant="primary"
              loading={state.kind === "sending"}
              disabled={!canSend || problem !== null || unchanged}
            >
              Send suggestion
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={state.kind === "sending"}
              onClick={() => setState({ kind: "idle" })}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={Check}
            loading={state.kind === "sending"}
            disabled={!canSend || alreadyApproved || entry.msgstr === ""}
            onClick={() => void send("ok", entry.msgstr)}
          >
            {alreadyApproved ? "You said it looks right" : "Looks right"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={Pencil}
            disabled={!canSend || state.kind === "sending"}
            onClick={() => setState({ kind: "editing", text: entry.msgstr })}
          >
            Suggest a change
          </Button>
        </div>
      )}

      {state.kind === "error" ? (
        <p role="alert" className="text-sm text-danger-text">
          {state.message}
        </p>
      ) : null}
    </Card>
  );
}
