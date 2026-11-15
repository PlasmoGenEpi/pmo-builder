import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { beforeEach, describe, expect, it } from "vitest";

import { handleReview, hashKey, type Database, type Statement } from "./review";

/** A D1-shaped database over SQLite in memory, with the migrations applied. */
function memoryDatabase(): { readonly db: Database; readonly sql: DatabaseSync } {
  const sql = new DatabaseSync(":memory:");
  const dir = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(dir).toSorted())
    sql.exec(readFileSync(new URL(file, dir), "utf8"));
  const statement = (query: string, values: readonly SQLInputValue[] = []): Statement => ({
    bind: (...next) => statement(query, next),
    first: async () => sql.prepare(query).get(...values) ?? null,
    all: async () => ({ results: sql.prepare(query).all(...values) }),
    run: async () => sql.prepare(query).run(...values),
  });
  return {
    sql,
    db: {
      prepare: (query) => statement(query),
      batch: async (statements) => Promise.all(statements.map((item) => item.run())),
    },
  };
}

const ORIGIN = "https://v2.pmotools.app";
const KEY = "fr-key-for-tests";

function post(path: string, body: unknown, origin: string | null = ORIGIN): Request {
  const headers = new Headers({ "Content-Type": "text/plain" });
  if (origin !== null) headers.set("Origin", origin);
  return new Request(`https://receiver.test${path}`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const SUGGESTION = {
  key: KEY,
  locale: "fr",
  reviewer: "Awa",
  context: "",
  msgid: "Start",
  seen: "Début",
  verdict: "edit",
  text: "Commencer",
};

describe("translation review", () => {
  let env: { DB: Database; REVIEW_ORIGINS: string };
  let sql: DatabaseSync;

  beforeEach(async () => {
    const memory = memoryDatabase();
    sql = memory.sql;
    env = { DB: memory.db, REVIEW_ORIGINS: `${ORIGIN},http://localhost:5173` };
    sql
      .prepare("INSERT INTO review_links VALUES (?, 'fr', 'Bamako lab', '2026-11-15', NULL)")
      .run(await hashKey(KEY));
    sql
      .prepare("INSERT INTO review_links VALUES (?, 'pt', 'Maputo', '2026-11-15', '2026-11-16')")
      .run(await hashKey("revoked-key"));
  });

  it("opens a session for a valid link, with its label and no suggestions yet", async () => {
    const response = await handleReview(post("/review/session", { key: KEY, locale: "fr" }), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(await response.json()).toEqual({ locale: "fr", label: "Bamako lab", suggestions: [] });
  });

  it("refuses an unknown key, a key for another language and a revoked key", async () => {
    const responses = await Promise.all(
      [
        { key: "nope", locale: "fr" },
        { key: KEY, locale: "pt" },
        { key: "revoked-key", locale: "pt" },
      ].map((body) => handleReview(post("/review/session", body), env)),
    );
    expect(responses.map((response) => response.status)).toEqual([403, 403, 403]);
  });

  it("answers only the pages it knows", async () => {
    const stranger = await handleReview(
      post("/review/session", { key: KEY, locale: "fr" }, "https://example.org"),
      env,
    );
    expect(stranger.status).toBe(403);
    expect(stranger.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const none = await handleReview(post("/review/session", { key: KEY, locale: "fr" }, null), env);
    expect(none.status).toBe(403);
  });

  it("keeps a suggestion and returns it in the next session, with who sent it", async () => {
    const now = new Date("2026-11-15T10:00:00Z");
    const saved = await handleReview(post("/review/suggest", SUGGESTION), env, now);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ id: 1, at: "2026-11-15T10:00:00.000Z" });

    const response = await handleReview(post("/review/session", { key: KEY, locale: "fr" }), env);
    const body: unknown = await response.json();
    expect(body).toMatchObject({
      suggestions: [
        {
          id: 1,
          reviewer: "Awa",
          context: "",
          msgid: "Start",
          seen: "Début",
          verdict: "edit",
          text: "Commencer",
          at: "2026-11-15T10:00:00.000Z",
        },
      ],
    });
    const stored = sql.prepare("SELECT link FROM review_suggestions").get();
    expect(stored).toEqual({ link: await hashKey(KEY) });
  });

  it("stores what the reviewer saw as the text when they say it looks right", async () => {
    await handleReview(post("/review/suggest", { ...SUGGESTION, verdict: "ok", text: "" }), env);
    expect(sql.prepare("SELECT verdict, text FROM review_suggestions").get()).toEqual({
      verdict: "ok",
      text: "Début",
    });
  });

  it("refuses a suggestion with no name, an empty change or an unknown verdict", async () => {
    const changes = [
      { reviewer: "  " },
      { text: " " },
      { verdict: "maybe" },
      { msgid: "" },
      { reviewer: "x".repeat(81) },
    ];
    const responses = await Promise.all(
      changes.map((change) =>
        handleReview(post("/review/suggest", { ...SUGGESTION, ...change }), env),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual(changes.map(() => 400));
    expect(sql.prepare("SELECT COUNT(*) AS n FROM review_suggestions").get()).toEqual({ n: 0 });
  });

  it("refuses a suggestion from a revoked link", async () => {
    const response = await handleReview(
      post("/review/suggest", { ...SUGGESTION, key: "revoked-key", locale: "pt" }),
      env,
    );
    expect(response.status).toBe(403);
  });

  it("refuses a body that is not JSON", async () => {
    const response = await handleReview(post("/review/session", "not json"), env);
    expect(response.status).toBe(400);
  });

  it("answers the browser's preflight from an allowed page", async () => {
    const request = new Request("https://receiver.test/review/suggest", {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:5173" },
    });
    const response = await handleReview(request, env);
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
  });
});
