/**
 * `pnpm translations <command>`: private review links for each language, and
 * taking reviewers' suggestions into the catalogs.
 *
 *   link <locale> <label>   Make a review link, such as `link fr "Bamako lab"`
 *   links                   List the links, with how much each has sent
 *   revoke <label>          Stop a link working
 *   show [locale]           List the suggestions not yet pulled, with who sent them
 *   pull [--all] [--dry-run]
 *                           Take the suggestions into src/locales/*.po and
 *                           print a report for the pull request. Marks them
 *                           pulled, unless --dry-run. --all takes in pulled
 *                           ones again, for when a pull was thrown away.
 *
 * The suggestions live in the receiver's D1 database, reached with Wrangler.
 * It needs `pnpm install` in receiver/ and a Cloudflare API token in
 * CLOUDFLARE_API_TOKEN (or `wrangler login`).
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { LANGUAGES, type LanguageCode } from "@/i18n/languages";
import {
  applySuggestions,
  formatReport,
  type Outcome,
  type StoredSuggestion,
} from "@/i18n/reviewPull";

const DATABASE = "pmo-builder-usage";
const SITE = process.env["PMO_BUILDER_URL"] ?? "https://v2.pmotools.app";

/** Languages reviewers can be given a link for: every catalog but the English source. */
const REVIEWED = LANGUAGES.filter((language) => language.code !== "en");

/** English names, for the report. */
const ENGLISH_NAMES: Readonly<Record<LanguageCode, string>> = {
  en: "English",
  fr: "French",
  pt: "Portuguese",
};

function isReviewed(value: string | undefined): value is LanguageCode {
  return REVIEWED.some((language) => language.code === value);
}

function sql(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Runs SQL on the remote database and returns the rows of its last statement. */
function query(command: string): Readonly<Record<string, unknown>>[] {
  const output = execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", DATABASE, "--remote", "--json", "--command", command],
    {
      cwd: "receiver",
      encoding: "utf8",
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  const parsed: unknown = JSON.parse(output);
  const last = Array.isArray(parsed) ? parsed.at(-1) : null;
  const results = isRecord(last) ? last["results"] : null;
  return Array.isArray(results) ? results.filter(isRecord) : [];
}

/** The hex SHA-256 of a key, as the receiver stores it. */
function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function link(locale: string | undefined, label: string | undefined): number {
  if (!isReviewed(locale) || label === undefined || label.trim() === "") {
    const codes = REVIEWED.map((language) => language.code).join(", ");
    console.error(`Usage: pnpm translations link <${codes}> "<label>"`);
    return 2;
  }
  const clean = label.trim();
  if (/[;\n]/.test(clean)) {
    console.error("A label cannot hold ; or a line break.");
    return 2;
  }
  const taken = query(
    `SELECT 1 FROM review_links WHERE label = ${sql(clean)} AND revoked_at IS NULL`,
  );
  if (taken.length > 0) {
    console.error(`A link called "${clean}" already works. Choose another label.`);
    return 1;
  }
  const key = randomBytes(24).toString("base64url");
  query(
    `INSERT INTO review_links (key_hash, locale, label, created_at) VALUES (${sql(hashKey(key))}, ${sql(locale)}, ${sql(clean)}, ${sql(new Date().toISOString())})`,
  );
  console.log(`Review link for ${ENGLISH_NAMES[locale]}, "${clean}":\n`);
  console.log(`  ${SITE}/#/translate/${locale}/${key}\n`);
  console.log("Anyone with it can send suggestions. It is shown only now: keep it somewhere safe.");
  return 0;
}

function links(): number {
  const rows = query(
    `SELECT l.label, l.locale, substr(l.created_at, 1, 10) AS created,
            substr(l.revoked_at, 1, 10) AS revoked,
            COUNT(s.id) AS suggestions, COUNT(DISTINCT s.reviewer) AS reviewers,
            substr(MAX(s.created_at), 1, 10) AS latest
       FROM review_links l LEFT JOIN review_suggestions s ON s.link = l.key_hash
      GROUP BY l.key_hash ORDER BY l.locale, l.created_at`,
  );
  if (rows.length === 0) console.log("No review links yet. Make one with: pnpm translations link");
  else console.table(rows);
  return 0;
}

function revoke(label: string | undefined): number {
  if (label === undefined || label.trim() === "") {
    console.error('Usage: pnpm translations revoke "<label>"');
    return 2;
  }
  const rows = query(
    `UPDATE review_links SET revoked_at = ${sql(new Date().toISOString())} WHERE label = ${sql(label.trim())} AND revoked_at IS NULL RETURNING locale`,
  );
  if (rows.length === 0) {
    console.error(`No working link is called "${label.trim()}". See: pnpm translations links`);
    return 1;
  }
  console.log(`"${label.trim()}" no longer works. What it sent is kept.`);
  return 0;
}

function toSuggestion(row: Readonly<Record<string, unknown>>): StoredSuggestion | null {
  const { id, reviewer, link: label, context, msgid, seen, verdict, text, at } = row;
  if (
    typeof id !== "number" ||
    typeof reviewer !== "string" ||
    typeof label !== "string" ||
    typeof context !== "string" ||
    typeof msgid !== "string" ||
    typeof seen !== "string" ||
    (verdict !== "ok" && verdict !== "edit") ||
    typeof text !== "string" ||
    typeof at !== "string"
  ) {
    return null;
  }
  return { id, reviewer, link: label, context, msgid, seen, verdict, text, at };
}

function suggestions(locale: LanguageCode, all: boolean): StoredSuggestion[] {
  return query(
    `SELECT s.id, s.reviewer, l.label AS link, s.context, s.msgid, s.seen, s.verdict, s.text,
            s.created_at AS at
       FROM review_suggestions s JOIN review_links l ON l.key_hash = s.link
      WHERE s.locale = ${sql(locale)} ${all ? "" : "AND s.pulled_at IS NULL"}
      ORDER BY s.id`,
  )
    .map(toSuggestion)
    .filter((item) => item !== null);
}

function chosenLocales(locale: string | undefined): LanguageCode[] | null {
  if (locale === undefined) return REVIEWED.map((language) => language.code);
  return isReviewed(locale) ? [locale] : null;
}

function show(locale: string | undefined): number {
  const locales = chosenLocales(locale);
  if (locales === null) {
    console.error(`No catalog for "${locale}".`);
    return 2;
  }
  for (const code of locales) {
    const rows = suggestions(code, false);
    console.log(`\n${ENGLISH_NAMES[code]}: ${rows.length} suggestions not yet pulled`);
    if (rows.length === 0) continue;
    console.table(
      rows.map((row) => ({
        when: row.at.slice(0, 16).replace("T", " "),
        reviewer: row.reviewer,
        link: row.link,
        message: row.msgid.slice(0, 50),
        verdict: row.verdict,
        suggested: row.verdict === "edit" ? row.text.slice(0, 50) : "",
      })),
    );
  }
  return 0;
}

function pull(flags: readonly string[]): number {
  const all = flags.includes("--all");
  const dryRun = flags.includes("--dry-run");
  const reports: string[] = [];
  const pulled: number[] = [];
  let changed = false;
  for (const { code } of REVIEWED) {
    const rows = suggestions(code, all);
    if (rows.length === 0) continue;
    const path = `src/locales/${code}.po`;
    const before = readFileSync(path, "utf8");
    const { catalog, outcomes } = applySuggestions(before, rows);
    if (catalog !== before) {
      changed = true;
      if (!dryRun) writeFileSync(path, catalog);
    }
    reports.push(formatReport(ENGLISH_NAMES[code], outcomes));
    pulled.push(...outcomes.map((outcome: Outcome) => outcome.suggestion.id));
  }
  if (reports.length === 0) {
    console.log("No new suggestions.");
    return 0;
  }
  console.log(`# Translation review\n\n${reports.join("\n")}`);
  if (dryRun) {
    console.error("\nDry run: nothing written, nothing marked.");
    return 0;
  }
  // Lingui writes the catalogs in its own layout; let it settle them.
  if (changed) execFileSync("pnpm", ["i18n:extract"], { stdio: "ignore" });
  for (let start = 0; start < pulled.length; start += 500) {
    const ids = pulled.slice(start, start + 500).join(",");
    query(
      `UPDATE review_suggestions SET pulled_at = ${sql(new Date().toISOString())} WHERE id IN (${ids})`,
    );
  }
  console.error(
    changed
      ? "\nCatalogs updated. Review the diff, run pnpm check, and open a pull request with the report above."
      : "\nNo catalog changes. The suggestions are marked pulled.",
  );
  return 0;
}

/** Runs one command. Returns the exit code. */
export function run(args: readonly string[]): number {
  const [command, ...rest] = args;
  switch (command) {
    case "link":
      return link(rest[0], rest[1]);
    case "links":
      return links();
    case "revoke":
      return revoke(rest[0]);
    case "show":
      return show(rest[0]);
    case "pull":
      return pull(rest);
    case undefined:
    default:
      console.error(
        [
          "Usage: pnpm translations <command>",
          '  link <locale> "<label>"   make a private review link',
          "  links                     list the links",
          '  revoke "<label>"          stop a link working',
          "  show [locale]             list suggestions not yet pulled",
          "  pull [--all] [--dry-run]  take suggestions into the catalogs",
        ].join("\n"),
      );
      return 2;
  }
}
