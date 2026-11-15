/**
 * Prepares a draft record on Zenodo for a built PMO: the file, the suggested
 * details, and a request to add it to a community. Nothing is published: the
 * user reads the draft on Zenodo and submits it there.
 *
 * This is the only module that sends anything to Zenodo, and it runs only
 * when the user asks for a deposit.
 */
import type { SuggestedRecord } from "./zenodo";

const ZENODO = "https://zenodo.org";

/** Asks for the current record format. Without it Zenodo answers in its older one. */
const RECORD_JSON = "application/vnd.inveniordm.v1+json";

/** The parts of a deposit, in order. */
export const DEPOSIT_STEPS = ["community", "draft", "file", "review"] as const;

/** One of {@link DEPOSIT_STEPS}. */
export type DepositStep = (typeof DEPOSIT_STEPS)[number];

/** Why a deposit stopped. */
export type DepositFailure =
  /** Zenodo did not accept the sign-in. */
  | "signed-out"
  /** The account may not do this. */
  | "not-allowed"
  /** The community does not exist. */
  | "no-community"
  /** The file is larger than Zenodo takes. */
  | "too-large"
  /** Zenodo could not be reached. */
  | "offline"
  /** Zenodo answered with something else. */
  | "refused";

/** What a deposit gave. */
export type DepositResult =
  | { readonly ok: true; readonly draftUrl: string }
  | {
      readonly ok: false;
      readonly step: DepositStep;
      readonly failure: DepositFailure;
      /** The draft, when one was made before the failure, so the user can finish it by hand. */
      readonly draftUrl: string | null;
    };

/** What a deposit needs. */
export interface DepositInput {
  /** The access token from the sign-in. */
  readonly token: string;
  /** The community's identifier, as in `zenodo.org/communities/<identifier>`. */
  readonly community: string;
  readonly file: Blob;
  readonly fileName: string;
  readonly record: SuggestedRecord;
  /** Today as `YYYY-MM-DD`. Zenodo needs a publication date on every draft. */
  readonly date: string;
  /** Called as each step starts. */
  readonly onStep?: (step: DepositStep) => void;
  /** For tests. Default: the browser's `fetch`. */
  readonly fetch?: typeof fetch;
}

class DepositError extends Error {
  readonly failure: DepositFailure;
  constructor(failure: DepositFailure) {
    super(failure);
    this.name = "DepositError";
    this.failure = failure;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failureFor(status: number): DepositFailure {
  if (status === 401) return "signed-out";
  if (status === 403) return "not-allowed";
  if (status === 413) return "too-large";
  return "refused";
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** The draft's metadata. Authors are left for the user to add on Zenodo. */
export function draftBody(record: SuggestedRecord, date: string): unknown {
  return {
    access: { record: "public", files: "public" },
    files: { enabled: true },
    metadata: {
      resource_type: { id: "dataset" },
      title: record.title,
      publication_date: date,
      description: `<p>${escapeHtml(record.description)}</p>`,
      subjects: record.keywords.map((subject) => ({ subject })),
      rights: [{ id: "cc-by-4.0" }],
      publisher: "Zenodo",
    },
  };
}

/**
 * Makes the draft, uploads the file and asks for the community review.
 * Resolves with the draft's address, or with the step that failed.
 */
export async function depositDraft(input: DepositInput): Promise<DepositResult> {
  const send = input.fetch ?? globalThis.fetch;
  let step: DepositStep = "community";
  let draftUrl: string | null = null;

  /** Sends one request and returns the JSON answer, or `null` for an empty one. */
  const call = async (
    path: string,
    init: { readonly method?: string; readonly json?: unknown; readonly body?: Blob } = {},
    options: { readonly anonymous?: boolean } = {},
  ): Promise<unknown> => {
    const headers: Record<string, string> = { Accept: RECORD_JSON };
    if (options.anonymous !== true) headers["Authorization"] = `Bearer ${input.token}`;
    if (init.json !== undefined) headers["Content-Type"] = "application/json";
    if (init.body !== undefined) headers["Content-Type"] = "application/octet-stream";
    let response: Response;
    try {
      response = await send(`${ZENODO}${path}`, {
        method: init.method ?? "GET",
        headers,
        body: init.json === undefined ? (init.body ?? null) : JSON.stringify(init.json),
        // Never send this site's address or cookies along.
        referrerPolicy: "no-referrer",
        credentials: "omit",
      });
    } catch {
      throw new DepositError("offline");
    }
    if (!response.ok) throw new DepositError(failureFor(response.status));
    const text = await response.text();
    if (text === "") return null;
    try {
      const parsed: unknown = JSON.parse(text);
      return parsed;
    } catch {
      throw new DepositError("refused");
    }
  };

  const begin = (next: DepositStep): void => {
    step = next;
    input.onStep?.(next);
  };

  try {
    begin("community");
    let community: unknown;
    try {
      community = await call(
        `/api/communities/${encodeURIComponent(input.community)}`,
        {},
        { anonymous: true },
      );
    } catch (error) {
      throw error instanceof DepositError && error.failure === "refused"
        ? new DepositError("no-community")
        : error;
    }
    const communityId = isRecord(community) ? community["id"] : undefined;
    if (typeof communityId !== "string") throw new DepositError("no-community");

    begin("draft");
    const draft = await call("/api/records", {
      method: "POST",
      json: draftBody(input.record, input.date),
    });
    const id = isRecord(draft) ? draft["id"] : undefined;
    if (typeof id !== "string" && typeof id !== "number") throw new DepositError("refused");
    const record = `/api/records/${encodeURIComponent(String(id))}/draft`;
    draftUrl = `${ZENODO}/uploads/${encodeURIComponent(String(id))}`;

    begin("file");
    const file = `${record}/files/${encodeURIComponent(input.fileName)}`;
    await call(`${record}/files`, { method: "POST", json: [{ key: input.fileName }] });
    await call(`${file}/content`, { method: "PUT", body: input.file });
    await call(`${file}/commit`, { method: "POST" });

    begin("review");
    await call(`${record}/review`, {
      method: "PUT",
      json: { receiver: { community: communityId }, type: "community-submission" },
    });
    return { ok: true, draftUrl };
  } catch (error) {
    if (error instanceof DepositError) return { ok: false, step, failure: error.failure, draftUrl };
    throw error;
  }
}
