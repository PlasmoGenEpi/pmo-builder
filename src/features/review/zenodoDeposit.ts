/**
 * Prepares a draft record on Zenodo for a built PMO: the file, the suggested
 * details, and a request to add it to a community. Nothing is published: the
 * user reads the draft on Zenodo and submits it there.
 *
 * This is the only module that sends anything to Zenodo, and it runs only
 * when the user asks for a deposit.
 */
import type { Creator, SuggestedRecord } from "./zenodo";

const ZENODO = "https://zenodo.org";

/** Asks for the current record format. Without it Zenodo answers in its older one. */
const RECORD_JSON = "application/vnd.inveniordm.v1+json";

/** The parts of a deposit, in order. */
export const DEPOSIT_STEPS = ["community", "version", "draft", "file", "review"] as const;

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
  | "refused"
  /** The record to add a version to was not found. */
  | "no-record"
  /** The record belongs to someone else, so this account cannot add a version. */
  | "not-owner"
  /** The record is not in the community. */
  | "other-community";

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

/** One file upload. */
export interface UploadRequest {
  readonly url: string;
  readonly token: string;
  readonly file: Blob;
  /** Called as bytes go out, with the bytes sent so far and the total. */
  readonly onProgress?: ((sent: number, total: number) => void) | undefined;
}

/**
 * Sends a file's bytes and resolves with the HTTP status. Rejects when
 * Zenodo cannot be reached.
 */
export type UploadFile = (request: UploadRequest) => Promise<number>;

/**
 * Uploads with `XMLHttpRequest`, because `fetch` cannot report how much of a
 * request body has gone out. Sends no cookies. The page's own referrer
 * policy (`no-referrer`) keeps this site's address out of the request.
 */
export const uploadWithProgress: UploadFile = (request) =>
  new Promise<number>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", request.url);
    xhr.setRequestHeader("Authorization", `Bearer ${request.token}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("Accept", RECORD_JSON);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) request.onProgress?.(event.loaded, event.total);
    });
    xhr.addEventListener("load", () => resolve(xhr.status));
    for (const type of ["error", "abort", "timeout"] as const) {
      xhr.addEventListener(type, () => reject(new Error(`upload ${type}`)));
    }
    xhr.send(request.file);
  });

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
  /** The authors, in order. Empty leaves them to be added on Zenodo. */
  readonly creators: readonly Creator[];
  /**
   * The Zenodo record to add a new version to, by its number, or `null` for a
   * new record. A new version keeps the record's details and its place in the
   * community, so only the file is sent.
   */
  readonly newVersionOf?: string | null;
  /** Called as each step starts. */
  readonly onStep?: (step: DepositStep) => void;
  /** Called during the `file` step, with the bytes sent so far and the total. */
  readonly onProgress?: (sent: number, total: number) => void;
  /** For tests. Default: the browser's `fetch`. */
  readonly fetch?: typeof fetch;
  /**
   * How the file's bytes are sent. Default: {@link uploadWithProgress} in a
   * browser. When `fetch` is given and this is not, the bytes go through
   * that `fetch`, without progress.
   */
  readonly upload?: UploadFile;
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

/** An INSDC BioProject accession, such as `PRJNA1040019` or `PRJEB12345`. */
const BIOPROJECT = /^PRJ[A-Z]{1,2}\d+$/;

/** The draft's metadata, with the authors given and links to the BioProjects the data comes from. */
export function draftBody(
  record: SuggestedRecord,
  date: string,
  creators: readonly Creator[] = [],
): unknown {
  const related = record.accessions
    .filter((accession) => BIOPROJECT.test(accession))
    .map((accession) => ({
      identifier: `https://www.ncbi.nlm.nih.gov/bioproject/${accession}`,
      scheme: "url",
      relation_type: { id: "isderivedfrom" },
      resource_type: { id: "dataset" },
    }));
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
      ...(creators.length === 0
        ? {}
        : {
            creators: creators.map((creator) => ({
              person_or_org: {
                type: "personal",
                family_name: creator.family,
                ...(creator.given === "" ? {} : { given_name: creator.given }),
              },
            })),
          }),
      ...(related.length === 0 ? {} : { related_identifiers: related }),
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

  /**
   * Starts a new version of the record `recordId` (or the latest version of
   * its record) and returns the new draft's id. The record must be in the
   * community and belong to the signed-in account.
   */
  const newVersionDraft = async (recordId: string, communityId: string): Promise<unknown> => {
    let latest: unknown = null;
    try {
      // Without the token: the record is public, and a plain request follows
      // Zenodo's redirect to the latest version without a preflight.
      latest = await call(
        `/api/records/${encodeURIComponent(recordId)}/versions/latest`,
        {},
        { anonymous: true },
      );
    } catch (error) {
      if (!(error instanceof DepositError) || error.failure !== "refused") throw error;
    }
    if (latest === null) {
      // A concept DOI names the record as a whole, and Zenodo answers it as
      // gone here. Search for the newest version of that record instead.
      let found: unknown;
      try {
        found = await call(
          `/api/records?q=${encodeURIComponent(`parent.id:${recordId}`)}&size=1`,
          {},
          { anonymous: true },
        );
      } catch (error) {
        throw error instanceof DepositError && error.failure === "refused"
          ? new DepositError("no-record")
          : error;
      }
      const hits = isRecord(found) && isRecord(found["hits"]) ? found["hits"]["hits"] : undefined;
      latest = Array.isArray(hits) ? hits[0] : undefined;
    }
    const latestId = isRecord(latest) ? latest["id"] : undefined;
    if (typeof latestId !== "string" && typeof latestId !== "number") {
      throw new DepositError("no-record");
    }
    const parent = isRecord(latest) ? latest["parent"] : undefined;
    const communities = isRecord(parent) ? parent["communities"] : undefined;
    const ids = isRecord(communities) ? communities["ids"] : undefined;
    if (!Array.isArray(ids) || !ids.includes(communityId)) {
      throw new DepositError("other-community");
    }
    let draft: unknown;
    try {
      draft = await call(`/api/records/${encodeURIComponent(String(latestId))}/versions`, {
        method: "POST",
      });
    } catch (error) {
      throw error instanceof DepositError && error.failure === "not-allowed"
        ? new DepositError("not-owner")
        : error;
    }
    return isRecord(draft) ? draft["id"] : undefined;
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

    const versionOf = input.newVersionOf ?? null;
    let id: unknown;
    if (versionOf === null) {
      begin("draft");
      const draft = await call("/api/records", {
        method: "POST",
        json: draftBody(input.record, input.date, input.creators),
      });
      id = isRecord(draft) ? draft["id"] : undefined;
    } else {
      begin("version");
      id = await newVersionDraft(versionOf, communityId);
    }
    if (typeof id !== "string" && typeof id !== "number") throw new DepositError("refused");
    const record = `/api/records/${encodeURIComponent(String(id))}/draft`;
    draftUrl = `${ZENODO}/uploads/${encodeURIComponent(String(id))}`;

    begin("file");
    const file = `${record}/files/${encodeURIComponent(input.fileName)}`;
    await call(`${record}/files`, { method: "POST", json: [{ key: input.fileName }] });
    const upload =
      input.upload ??
      (input.fetch === undefined && typeof XMLHttpRequest !== "undefined"
        ? uploadWithProgress
        : null);
    if (upload === null) {
      await call(`${file}/content`, { method: "PUT", body: input.file });
    } else {
      let status: number;
      try {
        status = await upload({
          url: `${ZENODO}${file}/content`,
          token: input.token,
          file: input.file,
          onProgress: input.onProgress,
        });
      } catch {
        throw new DepositError("offline");
      }
      if (status === 0) throw new DepositError("offline");
      if (status < 200 || status >= 300) throw new DepositError(failureFor(status));
    }
    await call(`${file}/commit`, { method: "POST" });
    // A new version is already in the community. Zenodo refuses a review for it.
    if (versionOf !== null) return { ok: true, draftUrl };

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
