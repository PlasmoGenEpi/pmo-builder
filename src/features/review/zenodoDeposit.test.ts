import { describe, expect, it, vi } from "vitest";

import type { SuggestedRecord } from "./zenodo";
import {
  depositDraft,
  draftBody,
  type DepositInput,
  type DepositStep,
  type UploadFile,
  type UploadRequest,
} from "./zenodoDeposit";

const RECORD: SuggestedRecord = {
  title: "MOZ2021: microhaplotype data in PMO format",
  description: "Calls for 50 samples, <5% missing & more.",
  keywords: ["Portable Microhaplotype Object", "PMO"],
  creators: [],
  accessions: [],
};

interface Call {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

/** A `fetch` that answers from a table of `METHOD path` to status and JSON, and records each call. */
function fakeZenodo(
  answers: Readonly<Record<string, { readonly status: number; readonly json?: unknown }>>,
) {
  const calls: Call[] = [];
  const send = vi.fn<typeof fetch>((url, init) => {
    const address = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    const path = address.replace("https://zenodo.org", "");
    const method = init?.method ?? "GET";
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    calls.push({ method, path, headers, body: init?.body ?? null });
    const answer = answers[`${method} ${path}`] ?? { status: 404 };
    return Promise.resolve(
      new Response(answer.json === undefined ? null : JSON.stringify(answer.json), {
        status: answer.status,
      }),
    );
  });
  return { send, calls };
}

const HAPPY = {
  "GET /api/communities/pmocommunity": {
    status: 200,
    json: { id: "uuid-1", slug: "pmocommunity" },
  },
  "POST /api/records": { status: 201, json: { id: "24237640" } },
  "POST /api/records/24237640/draft/files": { status: 201, json: {} },
  "PUT /api/records/24237640/draft/files/My%20PMO.pmo.json.gz/content": { status: 200, json: {} },
  "POST /api/records/24237640/draft/files/My%20PMO.pmo.json.gz/commit": { status: 200, json: {} },
  "PUT /api/records/24237640/draft/review": { status: 200, json: {} },
};

function input(send: typeof fetch, extra: Partial<DepositInput> = {}): DepositInput {
  return {
    token: "secret-token",
    community: "pmocommunity",
    file: new Blob(["gz"]),
    fileName: "My PMO.pmo.json.gz",
    record: RECORD,
    date: "2026-11-14",
    creators: [],
    fetch: send,
    ...extra,
  };
}

describe("draftBody", () => {
  it("fills in a public dataset with the keywords and escapes the description", () => {
    expect(draftBody(RECORD, "2026-11-14")).toEqual({
      access: { record: "public", files: "public" },
      files: { enabled: true },
      metadata: {
        resource_type: { id: "dataset" },
        title: "MOZ2021: microhaplotype data in PMO format",
        publication_date: "2026-11-14",
        description: "<p>Calls for 50 samples, &lt;5% missing &amp; more.</p>",
        subjects: [{ subject: "Portable Microhaplotype Object" }, { subject: "PMO" }],
        rights: [{ id: "cc-by-4.0" }],
        publisher: "Zenodo",
      },
    });
  });
});

describe("depositDraft", () => {
  it("makes the draft, uploads the file, asks for the review and gives the draft's address", async () => {
    const { send, calls } = fakeZenodo(HAPPY);
    const steps: DepositStep[] = [];
    const result = await depositDraft(input(send, { onStep: (step) => steps.push(step) }));
    expect(result).toEqual({ ok: true, draftUrl: "https://zenodo.org/uploads/24237640" });
    expect(steps).toEqual(["community", "draft", "file", "review"]);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(Object.keys(HAPPY));
    expect(calls.at(-1)?.body).toBe(
      JSON.stringify({ receiver: { community: "uuid-1" }, type: "community-submission" }),
    );
    const upload = calls[3];
    expect(upload?.headers["content-type"]).toBe("application/octet-stream");
    expect(upload?.body).toBeInstanceOf(Blob);
  });

  it("sends the token to every call but the community lookup, and never cookies or a referrer", async () => {
    const { send, calls } = fakeZenodo(HAPPY);
    await depositDraft(input(send));
    expect(calls[0]?.headers["authorization"]).toBeUndefined();
    for (const call of calls.slice(1))
      expect(call.headers["authorization"]).toBe("Bearer secret-token");
    for (const [, init] of send.mock.calls) {
      expect(init?.credentials).toBe("omit");
      expect(init?.referrerPolicy).toBe("no-referrer");
    }
  });

  it("stops before making a draft when the community does not exist", async () => {
    const { send, calls } = fakeZenodo({});
    expect(await depositDraft(input(send))).toEqual({
      ok: false,
      step: "community",
      failure: "no-community",
      draftUrl: null,
    });
    expect(calls).toHaveLength(1);
  });

  it("reports an expired sign-in", async () => {
    const { send } = fakeZenodo({ ...HAPPY, "POST /api/records": { status: 401 } });
    expect(await depositDraft(input(send))).toEqual({
      ok: false,
      step: "draft",
      failure: "signed-out",
      draftUrl: null,
    });
  });

  it("keeps the draft's address when a later step fails", async () => {
    const { send } = fakeZenodo({
      ...HAPPY,
      "PUT /api/records/24237640/draft/files/My%20PMO.pmo.json.gz/content": { status: 413 },
    });
    expect(await depositDraft(input(send))).toEqual({
      ok: false,
      step: "file",
      failure: "too-large",
      draftUrl: "https://zenodo.org/uploads/24237640",
    });
    const refused = fakeZenodo({
      ...HAPPY,
      "PUT /api/records/24237640/draft/review": { status: 403 },
    });
    expect(await depositDraft(input(refused.send))).toMatchObject({
      step: "review",
      failure: "not-allowed",
      draftUrl: "https://zenodo.org/uploads/24237640",
    });
  });

  it("reports that Zenodo could not be reached", async () => {
    const send = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await depositDraft(input(send))).toMatchObject({
      ok: false,
      step: "community",
      failure: "offline",
    });
  });

  it("sends the file through the uploader and passes its progress on", async () => {
    const { send, calls } = fakeZenodo(HAPPY);
    const requests: UploadRequest[] = [];
    const upload = vi.fn<UploadFile>((request) => {
      requests.push(request);
      request.onProgress?.(1, 2);
      request.onProgress?.(2, 2);
      return Promise.resolve(200);
    });
    const progress: [number, number][] = [];
    const result = await depositDraft(
      input(send, { upload, onProgress: (sent, total) => progress.push([sent, total]) }),
    );
    expect(result).toEqual({ ok: true, draftUrl: "https://zenodo.org/uploads/24237640" });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: "https://zenodo.org/api/records/24237640/draft/files/My%20PMO.pmo.json.gz/content",
      token: "secret-token",
    });
    expect(requests[0]?.file).toBeInstanceOf(Blob);
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
    // The bytes went through the uploader, not through fetch.
    expect(calls.some((call) => call.path.endsWith("/content"))).toBe(false);
  });

  it("reports what the uploader ran into", async () => {
    const { send } = fakeZenodo(HAPPY);
    expect(await depositDraft(input(send, { upload: () => Promise.resolve(413) }))).toMatchObject({
      ok: false,
      step: "file",
      failure: "too-large",
    });
    expect(
      await depositDraft(input(send, { upload: () => Promise.reject(new Error("upload error")) })),
    ).toMatchObject({
      ok: false,
      step: "file",
      failure: "offline",
      draftUrl: "https://zenodo.org/uploads/24237640",
    });
    expect(await depositDraft(input(send, { upload: () => Promise.resolve(0) }))).toMatchObject({
      ok: false,
      step: "file",
      failure: "offline",
    });
  });

  it("sends the authors and links the BioProjects the data comes from", () => {
    const body = draftBody(
      { ...RECORD, accessions: ["PRJNA1040019", "not an accession", "PRJEB12345"] },
      "2026-11-14",
      [
        { family: "Okello", given: "Grace" },
        { family: "Diène", given: "" },
      ],
    );
    expect(body).toMatchObject({
      metadata: {
        creators: [
          { person_or_org: { type: "personal", family_name: "Okello", given_name: "Grace" } },
          { person_or_org: { type: "personal", family_name: "Diène" } },
        ],
        related_identifiers: [
          {
            identifier: "https://www.ncbi.nlm.nih.gov/bioproject/PRJNA1040019",
            scheme: "url",
            relation_type: { id: "isderivedfrom" },
          },
          { identifier: "https://www.ncbi.nlm.nih.gov/bioproject/PRJEB12345" },
        ],
      },
    });
    expect(JSON.stringify(body)).not.toContain('given_name":""');
    expect(draftBody(RECORD, "2026-11-14")).not.toHaveProperty("metadata.creators");
    expect(draftBody(RECORD, "2026-11-14")).not.toHaveProperty("metadata.related_identifiers");
  });
});

describe("depositDraft, as a new version", () => {
  const VERSION = {
    "GET /api/communities/pmocommunity": { status: 200, json: { id: "uuid-1" } },
    "GET /api/records/500/versions/latest": {
      status: 200,
      json: { id: "502", parent: { communities: { ids: ["uuid-1"] } } },
    },
    "POST /api/records/502/versions": { status: 201, json: { id: "777" } },
    "POST /api/records/777/draft/files": { status: 201, json: {} },
    "PUT /api/records/777/draft/files/My%20PMO.pmo.json.gz/content": { status: 200, json: {} },
    "POST /api/records/777/draft/files/My%20PMO.pmo.json.gz/commit": { status: 200, json: {} },
  };

  it("starts a version of the latest record, uploads the file and asks for no review", async () => {
    const { send, calls } = fakeZenodo(VERSION);
    const steps: DepositStep[] = [];
    const result = await depositDraft(
      input(send, { newVersionOf: "500", onStep: (step) => steps.push(step) }),
    );
    expect(result).toEqual({ ok: true, draftUrl: "https://zenodo.org/uploads/777" });
    expect(steps).toEqual(["community", "version", "file"]);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(Object.keys(VERSION));
  });

  it("finds the record from its concept DOI number", async () => {
    const { send } = fakeZenodo({
      ...VERSION,
      "GET /api/records/500/versions/latest": { status: 410 },
      "GET /api/records?q=parent.id%3A500&size=1": {
        status: 200,
        json: { hits: { hits: [{ id: "502", parent: { communities: { ids: ["uuid-1"] } } }] } },
      },
    });
    expect(await depositDraft(input(send, { newVersionOf: "500" }))).toEqual({
      ok: true,
      draftUrl: "https://zenodo.org/uploads/777",
    });
  });

  it("says when the record cannot be found, is elsewhere, or is someone else's", async () => {
    const missing = fakeZenodo({
      ...VERSION,
      "GET /api/records/500/versions/latest": { status: 404 },
    });
    expect(await depositDraft(input(missing.send, { newVersionOf: "500" }))).toMatchObject({
      ok: false,
      step: "version",
      failure: "no-record",
    });
    const elsewhere = fakeZenodo({
      ...VERSION,
      "GET /api/records/500/versions/latest": {
        status: 200,
        json: { id: "502", parent: { communities: { ids: ["another"] } } },
      },
    });
    expect(await depositDraft(input(elsewhere.send, { newVersionOf: "500" }))).toMatchObject({
      failure: "other-community",
    });
    expect(elsewhere.calls.some((call) => call.method === "POST")).toBe(false);
    const theirs = fakeZenodo({ ...VERSION, "POST /api/records/502/versions": { status: 403 } });
    expect(await depositDraft(input(theirs.send, { newVersionOf: "500" }))).toMatchObject({
      step: "version",
      failure: "not-owner",
      draftUrl: null,
    });
  });
});
