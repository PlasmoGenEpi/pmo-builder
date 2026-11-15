/**
 * Reading and changing the `.po` catalogs that `lingui extract` writes. Pure
 * text in, text out, so the translation review page, the command that pulls
 * reviewers' suggestions and the catalog test all read a catalog the same way.
 */

/** One message in a catalog. */
export interface PoEntry {
  /** The `msgctxt`, or `""` when the message has none. */
  readonly context: string;
  /** The English message. */
  readonly msgid: string;
  /** The translation. `""` when there is none: the app shows the English. */
  readonly msgstr: string;
  /** Notes for translators (`#.` lines). */
  readonly notes: readonly string[];
  /** The files the message is used in (`#:` lines). */
  readonly origins: readonly string[];
}

/** The two parts that name a message: its context and its English text. */
export interface MessageId {
  readonly context: string;
  readonly msgid: string;
}

/** One string that names a message, for maps and for storage. */
export function messageKey(id: MessageId): string {
  return id.context === "" ? id.msgid : `${id.context}\u0004${id.msgid}`;
}

/** A quoted `.po` string as text. `.po` escapes are a subset of JSON's. */
function unquote(text: string): string {
  const parsed: unknown = JSON.parse(text);
  return typeof parsed === "string" ? parsed : "";
}

/** Text as a quoted `.po` string. */
export function quote(text: string): string {
  return JSON.stringify(text);
}

type Field = "msgctxt" | "msgid" | "msgstr";

const FIELD = /^(msgctxt|msgid|msgstr) (".*")$/;

/** Reads one entry's lines. `null` for the header and for anything that is not an entry. */
function readEntry(lines: readonly string[]): PoEntry | null {
  const values: Record<Field, string | null> = { msgctxt: null, msgid: null, msgstr: null };
  const notes: string[] = [];
  const origins: string[] = [];
  let field: Field | null = null;
  for (const line of lines) {
    const match = FIELD.exec(line);
    if (match !== null) {
      // The regular expression allows only these three names.
      field = match[1] === "msgctxt" ? "msgctxt" : match[1] === "msgid" ? "msgid" : "msgstr";
      values[field] = unquote(match[2] ?? '""');
    } else if (line.startsWith('"') && field !== null) {
      values[field] = (values[field] ?? "") + unquote(line);
    } else if (line.startsWith("#. ")) {
      notes.push(line.slice(3));
    } else if (line.startsWith("#: ")) {
      origins.push(...line.slice(3).split(" ").filter(Boolean));
    }
  }
  if (values.msgid === null || values.msgid === "") return null;
  return {
    context: values.msgctxt ?? "",
    msgid: values.msgid,
    msgstr: values.msgstr ?? "",
    notes: [...new Set(notes)],
    origins: [...new Set(origins)],
  };
}

/** Splits a catalog into its entries' blocks of lines. */
function blocks(text: string): string[][] {
  return text
    .replaceAll("\r\n", "\n")
    .split(/\n\s*\n/)
    .map((block) => block.split("\n"));
}

/** Reads a catalog's messages, in file order. The header is left out. */
export function parsePo(text: string): PoEntry[] {
  return blocks(text)
    .map(readEntry)
    .filter((entry) => entry !== null);
}

/**
 * Returns the catalog with one message's translation replaced, or `null` when
 * the catalog has no such message. Everything else is kept as written.
 */
export function setTranslation(text: string, id: MessageId, msgstr: string): string | null {
  const key = messageKey(id);
  const all = blocks(text);
  const index = all.findIndex((lines) => {
    const entry = readEntry(lines);
    return entry !== null && messageKey(entry) === key;
  });
  const lines = all[index];
  if (lines === undefined) return null;
  const start = lines.findIndex((line) => line.startsWith("msgstr "));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && (lines[end] ?? "").startsWith('"')) end += 1;
  all[index] = [...lines.slice(0, start), `msgstr ${quote(msgstr)}`, ...lines.slice(end)];
  return all.map((block) => block.join("\n")).join("\n\n");
}
