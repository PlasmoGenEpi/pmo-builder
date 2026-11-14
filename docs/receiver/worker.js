// Reference receiver for PMO Builder usage records: a Cloudflare Worker with a
// D1 database bound as DB. It rejects anything that does not match the schema,
// never reads the IP address or any header, and adds one to a daily counter
// per fact. It keeps no record, so stored facts cannot be linked to each other.
//
//   CREATE TABLE counts (day TEXT, metric TEXT, value TEXT, n INTEGER NOT NULL,
//     PRIMARY KEY (day, metric, value));
//
// Turn off Workers Logs and Logpush for this Worker: they would keep IP addresses.
import { Validator } from "@cfworker/json-schema";

import schema from "../analytics-payload.schema.json" with { type: "json" };

const validator = new Validator(schema, "2020-12", false);
const insert =
  "INSERT INTO counts VALUES (?1, ?2, ?3, 1) ON CONFLICT (day, metric, value) DO UPDATE SET n = n + 1";

/**
 * Turns a record into [metric, value] facts, such as
 * ["tables.panelTargets.import.route", "upload"]. Each issue stays one fact.
 * @param {string} path
 * @param {unknown} value
 * @param {[string, string][]} out
 */
export function facts(path, value, out = []) {
  if (Array.isArray(value)) value.forEach((item) => facts(path, item, out));
  else if (value !== null && typeof value === "object" && path === "issues") {
    out.push([path, Object.values(value).join(" ")]);
  } else if (value !== null && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => facts(path ? `${path}.${key}` : key, item, out));
  } else out.push([path, String(value)]);
  return out;
}

// oxlint-disable-next-line import/no-default-export -- Workers need a default export.
export default {
  /** @param {Request} request @param {{ DB: D1Database }} env */
  async fetch(request, env) {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const text = await request.text();
    let record = null;
    try {
      record = text.length <= 8192 ? JSON.parse(text) : null;
    } catch {
      record = null;
    }
    if (!validator.validate(record).valid) return new Response(null, { status: 400 });
    const day = new Date().toISOString().slice(0, 10);
    const rows = facts("", record).map(([metric, value]) =>
      env.DB.prepare(insert).bind(day, metric, value),
    );
    await env.DB.batch(rows);
    return new Response(null, { status: 204 });
  },
};
