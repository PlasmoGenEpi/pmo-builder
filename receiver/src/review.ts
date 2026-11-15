/**
 * Translation review: reviewers open a private link per language in PMO
 * Builder and say, message by message, whether the translation looks right
 * or how it should read. This keeps what they send. Nothing here changes the
 * app: `pnpm translations pull` reads the suggestions into the catalogs, and
 * a person merges them.
 *
 * Unlike the usage counts, this stores what people type, with the name they
 * give, because the maintainers want to know who suggested what. It still
 * never reads the IP address or any header except `Origin`.
 *
 *   POST /review/session  { key, locale }        -> { locale, label, suggestions }
 *   POST /review/suggest  { key, locale, reviewer, context, msgid, seen,
 *                           verdict: "ok" | "edit", text } -> { id, at }
 *
 * Bodies are JSON sent as text/plain, so the browser sends them without a
 * preflight request.
 */

/** A prepared D1 statement: the parts the Worker uses. */
export interface Statement {
  bind(...values: readonly (string | number | null)[]): Statement;
  first(): Promise<unknown>;
  all(): Promise<{ readonly results: readonly unknown[] }>;
  run(): Promise<unknown>;
}

/** The parts of a D1 database the Worker uses. */
export interface Database {
  prepare(query: string): Statement;
  batch(statements: readonly Statement[]): Promise<unknown>;
}

/** What the review endpoints need from the Worker's environment. */
export interface ReviewEnv {
  readonly DB: Database;
  /** The origins allowed to call, separated by commas, such as `https://v2.pmotools.app`. */
  readonly REVIEW_ORIGINS?: string;
}

const MAX_BODY = 32_768;
/** Longer than any message in the app; a guard, not a rule reviewers meet. */
const MAX_TEXT = 4000;
const MAX_REVIEWER = 80;
/** The most suggestions one link may hold, so a leaked link cannot fill the database. */
export const MAX_PER_LINK = 20_000;
/** The most suggestions a session returns, newest kept. */
const MAX_LISTED = 20_000;

/** A suggestion as the session returns it. */
export interface Suggestion {
  readonly id: number;
  readonly reviewer: string;
  readonly context: string;
  readonly msgid: string;
  readonly seen: string;
  readonly verdict: "ok" | "edit";
  readonly text: string;
  readonly at: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length <= max ? value : null;
}

/** The hex SHA-256 of a link's key. Only the hash is stored. */
export async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function allowedOrigin(request: Request, env: ReviewEnv): string | null {
  const origin = request.headers.get("Origin");
  if (origin === null) return null;
  const allowed = (env.REVIEW_ORIGINS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}

function reply(status: number, body: unknown, origin: string | null): Response {
  const headers = new Headers({ "Cache-Control": "no-store", Vary: "Origin" });
  if (origin !== null) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Max-Age", "86400");
  }
  if (body === null) return new Response(null, { status, headers });
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { status, headers });
}

interface Link {
  readonly hash: string;
  readonly locale: string;
  readonly label: string;
}

/** The link a key opens, when it exists, is not revoked and is for `locale`. */
async function findLink(db: Database, key: unknown, locale: unknown): Promise<Link | null> {
  const clean = text(key, 200);
  if (clean === null || clean === "" || typeof locale !== "string") return null;
  const hash = await hashKey(clean);
  const row = await db
    .prepare(
      "SELECT locale, label FROM review_links WHERE key_hash = ?1 AND revoked_at IS NULL AND locale = ?2",
    )
    .bind(hash, locale)
    .first();
  if (!isRecord(row) || typeof row["label"] !== "string") return null;
  return { hash, locale, label: row["label"] };
}

function toSuggestion(row: unknown): Suggestion | null {
  if (!isRecord(row)) return null;
  const { id, reviewer, context, msgid, seen, verdict, text: body, created_at: at } = row;
  if (
    typeof id !== "number" ||
    typeof reviewer !== "string" ||
    typeof context !== "string" ||
    typeof msgid !== "string" ||
    typeof seen !== "string" ||
    (verdict !== "ok" && verdict !== "edit") ||
    typeof body !== "string" ||
    typeof at !== "string"
  ) {
    return null;
  }
  return { id, reviewer, context, msgid, seen, verdict, text: body, at };
}

async function session(db: Database, body: Readonly<Record<string, unknown>>) {
  const link = await findLink(db, body["key"], body["locale"]);
  if (link === null) return { status: 403, body: { error: "link" } } as const;
  const { results } = await db
    .prepare(
      `SELECT id, reviewer, context, msgid, seen, verdict, text, created_at FROM (
         SELECT * FROM review_suggestions WHERE locale = ?1 ORDER BY id DESC LIMIT ?2
       ) ORDER BY id`,
    )
    .bind(link.locale, MAX_LISTED)
    .all();
  const suggestions = results.map(toSuggestion).filter((item) => item !== null);
  return { status: 200, body: { locale: link.locale, label: link.label, suggestions } } as const;
}

async function suggest(db: Database, body: Readonly<Record<string, unknown>>, now: Date) {
  const link = await findLink(db, body["key"], body["locale"]);
  if (link === null) return { status: 403, body: { error: "link" } } as const;
  const reviewer = text(body["reviewer"], MAX_REVIEWER)?.trim() ?? "";
  const context = text(body["context"], MAX_TEXT);
  const msgid = text(body["msgid"], MAX_TEXT);
  const seen = text(body["seen"], MAX_TEXT);
  const verdict = body["verdict"];
  const said = text(body["text"], MAX_TEXT);
  if (
    reviewer === "" ||
    context === null ||
    msgid === null ||
    msgid === "" ||
    seen === null ||
    (verdict !== "ok" && verdict !== "edit") ||
    said === null ||
    (verdict === "edit" && said.trim() === "")
  ) {
    return { status: 400, body: { error: "suggestion" } } as const;
  }
  const count = await db
    .prepare("SELECT COUNT(*) AS n FROM review_suggestions WHERE link = ?1")
    .bind(link.hash)
    .first();
  if (isRecord(count) && typeof count["n"] === "number" && count["n"] >= MAX_PER_LINK) {
    return { status: 429, body: { error: "full" } } as const;
  }
  const at = now.toISOString();
  const row = await db
    .prepare(
      `INSERT INTO review_suggestions
         (link, locale, reviewer, context, msgid, seen, verdict, text, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id`,
    )
    .bind(
      link.hash,
      link.locale,
      reviewer,
      context,
      msgid,
      seen,
      verdict,
      verdict === "ok" ? seen : said,
      at,
    )
    .first();
  const id = isRecord(row) && typeof row["id"] === "number" ? row["id"] : null;
  return { status: 200, body: { id, at } } as const;
}

/** True when the request is for the review endpoints. */
export function isReviewRequest(request: Request): boolean {
  return new URL(request.url).pathname.startsWith("/review/");
}

/** Answers a request to `/review/…`. */
export async function handleReview(
  request: Request,
  env: ReviewEnv,
  now: Date = new Date(),
): Promise<Response> {
  const origin = allowedOrigin(request, env);
  if (origin === null) return reply(403, null, null);
  if (request.method === "OPTIONS") return reply(204, null, origin);
  if (request.method !== "POST") return reply(405, null, origin);
  const raw = await request.text();
  let body: unknown = null;
  if (raw.length <= MAX_BODY) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
  }
  if (!isRecord(body)) return reply(400, { error: "body" }, origin);
  const path = new URL(request.url).pathname;
  const result =
    path === "/review/session"
      ? await session(env.DB, body)
      : path === "/review/suggest"
        ? await suggest(env.DB, body, now)
        : ({ status: 404, body: { error: "path" } } as const);
  return reply(result.status, result.body, origin);
}
