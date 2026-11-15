// The receiver for PMO Builder usage records: a Cloudflare Worker with a D1
// database bound as DB. See README.md beside this folder.
//
// It never reads the IP address or any header. It cuts each record into
// facts, keeps the facts on the allowed list (generated from the app's own
// record format) and adds one to a daily counter for each. A fact not on the
// list is dropped on its own and only counted, so it never costs the rest of
// the record. It keeps no record, so stored facts cannot be linked.
//
//   CREATE TABLE counts (day TEXT, metric TEXT, value TEXT, n INTEGER NOT NULL,
//     PRIMARY KEY (day, metric, value));
//
// Keep Workers Logs and Logpush off for this Worker: they would keep IP addresses.
import allowed from "./allowed-facts.json";
import { createFactFilter } from "./facts";

/** The parts of a D1 database the Worker uses. */
interface Statement {
  bind(...values: readonly (string | number)[]): Statement;
}
interface Database {
  prepare(query: string): Statement;
  batch(statements: readonly Statement[]): Promise<unknown>;
}

const sortFacts = createFactFilter(allowed);
const MAX_BODY = 8192;
const INSERT =
  "INSERT INTO counts VALUES (?1, ?2, ?3, ?4) ON CONFLICT (day, metric, value) DO UPDATE SET n = n + excluded.n";

function parse(text: string): unknown {
  if (text.length > MAX_BODY) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return null;
  }
}

// oxlint-disable-next-line import/no-default-export -- Workers need a default export.
export default {
  async fetch(request: Request, env: { readonly DB: Database }): Promise<Response> {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const sorted = sortFacts(parse(await request.text()));
    if (sorted === null) return new Response(null, { status: 400 });
    const day = new Date().toISOString().slice(0, 10);
    const rows = sorted.kept.map(([metric, value]) =>
      env.DB.prepare(INSERT).bind(day, metric, value, 1),
    );
    if (sorted.dropped > 0) {
      rows.push(env.DB.prepare(INSERT).bind(day, "receiver.dropped", "facts", sorted.dropped));
    }
    if (rows.length > 0) await env.DB.batch(rows);
    return new Response(null, { status: 204 });
  },
};
