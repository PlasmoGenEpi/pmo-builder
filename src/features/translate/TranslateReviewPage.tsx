/**
 * The translation review page, opened from a private link such as
 * `#/translate/fr/<key>`. Reviewers go through the catalog page by page and
 * say whether each translation looks right, or suggest a change. What they
 * send goes to the review service; nothing here changes the app.
 *
 * This page is in English and is not translated: its readers review the
 * English against their language. See docs/translation.md.
 */
import { ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "wouter";

import { PageContainer } from "@/app/PageContainer";
import { LANGUAGES } from "@/i18n/languages";
import { parsePo, type PoEntry } from "@/i18n/poFile";
import {
  Button,
  Callout,
  EmptyState,
  Field,
  Link,
  ProgressBar,
  SegmentedControl,
  Select,
  Skeleton,
  TextField,
  formatCount,
} from "@/ui";

import { MessageRow, type SendVerdict } from "./MessageRow";
import {
  openSession,
  reviewServiceUrl,
  sendSuggestion,
  type Fetcher,
  type ReviewLink,
  type ReviewSuggestion,
} from "./reviewApi";
import {
  GROUPS,
  progressOf,
  reviewItems,
  visibleItems,
  type ReviewFilter,
  type ReviewItem,
} from "./reviewModel";

/** `fetch`, bound, as the default for the page. */
const browserFetch: Fetcher = (url, init) => fetch(url, init);

const GUIDE = "https://github.com/PlasmoGenEpi/pmo-builder/blob/main/docs/translation.md";
const NAME_KEY = "pmo-builder.reviewer-name";

/** English names of the languages that can be reviewed. */
const LANGUAGE_NAMES: Readonly<Record<string, string>> = { fr: "French", pt: "Portuguese" };

/**
 * Where each catalog is served as a file. Fetched only when a review opens,
 * and not kept by the offline service worker.
 */
const CATALOG_URLS = import.meta.glob<string>(
  ["../../locales/*.po", "!../../locales/en.po", "!../../locales/pseudo.po"],
  { query: "?url", import: "default", eager: true },
);

/** Loads a language's catalog. `null` when there is none or it cannot be fetched. */
export async function loadCatalog(
  locale: string,
  fetcher: Fetcher = browserFetch,
): Promise<PoEntry[] | null> {
  const url = CATALOG_URLS[`../../locales/${locale}.po`];
  if (url === undefined) return null;
  try {
    const response = await fetcher(url, { credentials: "omit" });
    return response.ok ? parsePo(await response.text()) : null;
  } catch {
    return null;
  }
}

function readName(): string {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function storeName(name: string): void {
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    // The name is asked again next time.
  }
}

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "link" }
  | { readonly kind: "failed" }
  | {
      readonly kind: "ready";
      readonly entries: readonly PoEntry[];
      readonly label: string;
      readonly suggestions: readonly ReviewSuggestion[];
    };

/** The address of a page of the app shown in `locale`, opened from the review. */
function previewHref(locale: string, path: string): string {
  const url = new URL(window.location.href);
  url.search = `?lang=${locale}`;
  url.hash = `#${path}`;
  return url.href;
}

const FILTERS: readonly { readonly value: ReviewFilter; readonly label: string }[] = [
  { value: "unchecked", label: "To check" },
  { value: "changes", label: "Changes suggested" },
  { value: "all", label: "All" },
];

function Workspace({
  link,
  language,
  label,
  entries,
  initial,
  fetcher,
}: {
  readonly link: ReviewLink;
  readonly language: string;
  readonly label: string;
  readonly entries: readonly PoEntry[];
  readonly initial: readonly ReviewSuggestion[];
  readonly fetcher: Fetcher;
}) {
  const [suggestions, setSuggestions] = useState(initial);
  const [name, setName] = useState(readName);
  const [group, setGroup] = useState(GROUPS[0]?.id ?? "home");
  const [filter, setFilter] = useState<ReviewFilter>("unchecked");
  const [search, setSearch] = useState("");
  // Messages answered on this view stay in the list until the view changes,
  // so a row does not vanish under the reviewer's pointer.
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());

  const items = useMemo(() => reviewItems(entries, suggestions), [entries, suggestions]);
  const shown = useMemo(() => {
    const visible = new Set(visibleItems(items, { group, filter, search }).map((item) => item.key));
    return items.filter(
      (item) => visible.has(item.key) || (answered.has(item.key) && item.group === group),
    );
  }, [items, group, filter, search, answered]);
  const overall = progressOf(items);
  const reviewer = name.trim();
  const groupIndex = GROUPS.findIndex((candidate) => candidate.id === group);
  const current = GROUPS[groupIndex];
  const next = GROUPS[groupIndex + 1];

  function changeView(change: () => void): void {
    setAnswered(new Set());
    change();
  }

  const send: SendVerdict = async (item, verdict) => {
    const result = await sendSuggestion(
      link,
      {
        context: item.entry.context,
        msgid: item.entry.msgid,
        seen: item.entry.msgstr,
        reviewer,
        verdict: verdict.verdict,
        text: verdict.text,
      },
      fetcher,
    );
    if (result.kind === "ok") {
      setAnswered((before) => new Set(before).add(item.key));
      setSuggestions((before) => [...before, result.value]);
    }
    return result;
  };

  const groupOptions = GROUPS.map((candidate) => {
    const progress = progressOf(items.filter((item) => item.group === candidate.id));
    return {
      value: candidate.id,
      label: `${candidate.title} (${formatCount(progress.checked)} of ${formatCount(progress.total)})`,
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Review the {language} translation
        </h1>
        <p className="max-w-prose text-md text-text-muted">
          Read each message in English and in {language}. If the {language} reads well, choose Looks
          right. If not, suggest a better wording. The PMO Builder team sees each suggestion with
          your name and takes it into the app. The{" "}
          <Link href={GUIDE} external>
            translation guide
          </Link>{" "}
          has the conventions and a glossary.
        </p>
        <p className="text-sm text-text-subtle">Review link: {label}</p>
      </header>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <TextField
          label="Your name"
          hint="Sent with each suggestion, so the team knows who to ask."
          autoComplete="name"
          value={name}
          maxLength={80}
          onChange={(event) => {
            setName(event.target.value);
            storeName(event.target.value.trim());
          }}
          className="sm:max-w-xs sm:flex-1"
        />
        <ProgressBar
          label={`${formatCount(overall.checked)} of ${formatCount(overall.total)} messages checked`}
          value={overall.checked}
          max={Math.max(1, overall.total)}
          className="sm:flex-1"
        />
      </div>

      {reviewer === "" ? (
        <Callout tone="info" title="Enter your name to start">
          The buttons are off until you do.
        </Callout>
      ) : null}

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-subtle p-4">
        <Field label="Part of the app">
          {(control) => (
            <Select
              {...control}
              options={groupOptions}
              value={group}
              onValueChange={(value) => changeView(() => setGroup(value))}
            />
          )}
        </Field>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <SegmentedControl
            label="Show"
            size="sm"
            segments={FILTERS}
            value={filter}
            onValueChange={(value) => changeView(() => setFilter(value))}
          />
          <TextField
            label="Search every part"
            type="search"
            value={search}
            onChange={(event) => changeView(() => setSearch(event.target.value))}
            className="sm:max-w-xs"
          />
        </div>
        {current === undefined || search.trim() !== "" ? null : (
          <a
            href={previewHref(link.locale, current.path)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 self-start text-sm font-medium text-accent-text underline"
          >
            Open this part of the app in {language}
            <ExternalLink aria-hidden="true" className="size-3.5" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title={
            search.trim() !== ""
              ? "No message matches the search"
              : filter === "unchecked"
                ? "Everything here has been checked"
                : "Nothing to show here"
          }
          description={
            filter === "unchecked" && search.trim() === ""
              ? "Thank you. Choose another part of the app, or show all messages to look again."
              : undefined
          }
          action={
            next !== undefined && search.trim() === "" ? (
              <Button size="sm" onClick={() => changeView(() => setGroup(next.id))}>
                Next: {next.title}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-muted" aria-live="polite">
            {formatCount(shown.length)} {shown.length === 1 ? "message" : "messages"}
          </p>
          {shown.map((item: ReviewItem) => (
            <MessageRow
              key={item.key}
              item={item}
              locale={link.locale}
              language={language}
              canSend={reviewer !== ""}
              reviewer={reviewer}
              onSend={send}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Props for {@link TranslateReviewPage}. */
export interface TranslateReviewPageProps {
  readonly locale: string;
  readonly reviewKey: string;
  /** The review service. Defaults to the build's. Tests pass their own. */
  readonly service?: string | null;
  readonly fetcher?: Fetcher;
}

/** Loads the catalog and the link's session, then shows the review. Remounted to try again. */
function ReviewLoader({
  service,
  locale,
  language,
  reviewKey,
  fetcher,
  onRetry,
}: {
  readonly service: string;
  readonly locale: string;
  readonly language: string;
  readonly reviewKey: string;
  readonly fetcher: Fetcher;
  readonly onRetry: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    async function load(): Promise<void> {
      const [entries, session] = await Promise.all([
        loadCatalog(locale, fetcher),
        openSession({ service, locale, key: reviewKey }, fetcher),
      ]);
      if (!live) return;
      if (session.kind === "link") setLoaded({ kind: "link" });
      else if (session.kind === "failed" || entries === null) setLoaded({ kind: "failed" });
      else
        setLoaded({
          kind: "ready",
          entries,
          label: session.value.label,
          suggestions: session.value.suggestions,
        });
    }
    void load();
    return () => {
      live = false;
    };
  }, [service, locale, reviewKey, fetcher]);

  switch (loaded.kind) {
    case "loading":
      return (
        <output className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-5 w-full max-w-md" />
          <Skeleton className="mt-6 h-40 w-full" />
        </output>
      );
    case "link":
      return (
        <Callout tone="error" title="This review link does not work">
          It may have been stopped, or not copied whole. Ask the person who sent it for a new one.
        </Callout>
      );
    case "failed":
      return (
        <Callout
          tone="error"
          title="The review could not be loaded"
          action={
            <Button size="sm" onClick={onRetry}>
              Try again
            </Button>
          }
        >
          Check your connection and try again.
        </Callout>
      );
    case "ready":
      return (
        <Workspace
          link={{ service, locale, key: reviewKey }}
          language={language}
          label={loaded.label}
          entries={loaded.entries}
          initial={loaded.suggestions}
          fetcher={fetcher}
        />
      );
    default:
      return null;
  }
}

/** The review page for one language and link. */
export function TranslateReviewPage({
  locale,
  reviewKey,
  service = reviewServiceUrl(),
  fetcher = browserFetch,
}: TranslateReviewPageProps) {
  const [attempt, setAttempt] = useState(0);
  const language =
    locale !== "en" && LANGUAGES.some((candidate) => candidate.code === locale)
      ? (LANGUAGE_NAMES[locale] ?? locale)
      : null;

  return (
    <PageContainer>
      {service === null ? (
        <Callout tone="info" title="Translation review is not set up">
          This copy of PMO Builder has no review service.
        </Callout>
      ) : language === null ? (
        <Callout tone="error" title="There is no translation to review here">
          Check that the whole link was copied.
        </Callout>
      ) : (
        <ReviewLoader
          key={attempt}
          service={service}
          locale={locale}
          language={language}
          reviewKey={reviewKey}
          fetcher={fetcher}
          onRetry={() => setAttempt((count) => count + 1)}
        />
      )}
    </PageContainer>
  );
}

/** The route: `/translate/:locale/:key`. */
export function TranslateReviewRoute() {
  const params = useParams<{ locale: string; key: string }>();
  return <TranslateReviewPage locale={params.locale ?? ""} reviewKey={params.key ?? ""} />;
}
