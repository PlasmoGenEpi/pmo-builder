/**
 * Talking to the translation review service: the `/review/` endpoints of the
 * receiver Worker (`receiver/src/review.ts`). Used only by the review page,
 * and only by people a maintainer has given a review link.
 */
import type { MessageId } from "@/i18n/poFile";

/** One reviewer's verdict on one message, as the service keeps it. */
export interface ReviewSuggestion extends MessageId {
  readonly id: number;
  readonly reviewer: string;
  /** The translation the reviewer was shown. */
  readonly seen: string;
  readonly verdict: "ok" | "edit";
  /** Their wording. For "ok", the same as `seen`. */
  readonly text: string;
  /** ISO time it was sent. */
  readonly at: string;
}

/** A review link's session: what it is called and what has been sent through any link for its language. */
export interface ReviewSession {
  readonly label: string;
  readonly suggestions: readonly ReviewSuggestion[];
}

/** How a call went. */
export type ReviewResult<T> =
  | { readonly kind: "ok"; readonly value: T }
  /** The link is unknown, revoked or for another language. */
  | { readonly kind: "link" }
  | { readonly kind: "failed"; readonly status: number | null };

/** Where the review service is, from `VITE_TRANSLATION_REVIEW_URL`, or `null` when the build has none. */
export function reviewServiceUrl(
  value: string | undefined = import.meta.env.VITE_TRANSLATION_REVIEW_URL,
): string | null {
  const clean = value?.trim() ?? "";
  if (clean === "") return null;
  try {
    const url = new URL(clean);
    return url.protocol === "https:" || url.hostname === "localhost"
      ? url.href.replace(/\/$/, "")
      : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toSuggestion(value: unknown): ReviewSuggestion | null {
  if (!isRecord(value)) return null;
  const { id, reviewer, context, msgid, seen, verdict, text, at } = value;
  if (
    typeof id !== "number" ||
    typeof reviewer !== "string" ||
    typeof context !== "string" ||
    typeof msgid !== "string" ||
    typeof seen !== "string" ||
    (verdict !== "ok" && verdict !== "edit") ||
    typeof text !== "string" ||
    typeof at !== "string"
  ) {
    return null;
  }
  return { id, reviewer, context, msgid, seen, verdict, text, at };
}

/** What the page needs from `fetch`. Tests pass their own. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

async function call(fetcher: Fetcher, url: string, body: unknown): Promise<ReviewResult<unknown>> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      // text/plain keeps it a simple request: no preflight.
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(body),
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  } catch {
    return { kind: "failed", status: null };
  }
  if (response.status === 403) return { kind: "link" };
  if (!response.ok) return { kind: "failed", status: response.status };
  try {
    const value: unknown = await response.json();
    return { kind: "ok", value };
  } catch {
    return { kind: "failed", status: response.status };
  }
}

/** What identifies a review link. */
export interface ReviewLink {
  readonly service: string;
  readonly locale: string;
  readonly key: string;
}

/** Opens a link's session. */
export async function openSession(
  link: ReviewLink,
  fetcher: Fetcher = fetch,
): Promise<ReviewResult<ReviewSession>> {
  const result = await call(fetcher, `${link.service}/review/session`, {
    key: link.key,
    locale: link.locale,
  });
  if (result.kind !== "ok") return result;
  const { value } = result;
  if (!isRecord(value) || typeof value["label"] !== "string") {
    return { kind: "failed", status: null };
  }
  const list = Array.isArray(value["suggestions"]) ? value["suggestions"] : [];
  return {
    kind: "ok",
    value: {
      label: value["label"],
      suggestions: list.map(toSuggestion).filter((item) => item !== null),
    },
  };
}

/** A verdict the reviewer sends. */
export interface NewSuggestion extends MessageId {
  readonly reviewer: string;
  readonly seen: string;
  readonly verdict: "ok" | "edit";
  readonly text: string;
}

/** Sends one verdict. Returns it as the service stored it. */
export async function sendSuggestion(
  link: ReviewLink,
  suggestion: NewSuggestion,
  fetcher: Fetcher = fetch,
): Promise<ReviewResult<ReviewSuggestion>> {
  const result = await call(fetcher, `${link.service}/review/suggest`, {
    key: link.key,
    locale: link.locale,
    ...suggestion,
  });
  if (result.kind !== "ok") return result;
  const { value } = result;
  if (!isRecord(value) || typeof value["id"] !== "number" || typeof value["at"] !== "string") {
    return { kind: "failed", status: null };
  }
  return {
    kind: "ok",
    value: {
      ...suggestion,
      text: suggestion.verdict === "ok" ? suggestion.seen : suggestion.text,
      id: value["id"],
      at: value["at"],
    },
  };
}
