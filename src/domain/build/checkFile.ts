/**
 * Checking a PMO file the user already has, before it is published: that it
 * can be read, is in the PMO version the community takes, matches the PMO
 * format and its tables link up.
 */
import { plural, t } from "@lingui/core/macro";
import { checkPmoIntegrity, parsePmo, PmoError, readPmoVersion, validatePmo } from "pmotools-ts";

import { IMPORT_LIMITS } from "@/domain/import";

import { summarisePmo } from "./merge";
import { MAX_LISTED, PUBLISHABLE_PMO_VERSION, type PmoFileCheck } from "./checkFileResult";
import { summarisePublication } from "./publication";

/** A problem from the PMO library, in English, and how many more like it there are. */
function moreLikeIt(libraryMessage: string, omitted: number): string {
  return t({
    message: plural(omitted, {
      one: `${libraryMessage} (and # more like it)`,
      other: `${libraryMessage} (and # more like it)`,
    }),
    comment: "{libraryMessage} is a technical message from the PMO library, in English.",
  });
}

/**
 * Lists problems, once for each kind: messages that differ only in an index,
 * such as `specimen_info[3]`, count as one.
 */
function listProblems(
  messages: readonly string[],
  total: number,
): { readonly problems: readonly string[]; readonly unlisted: number } {
  const groups = new Map<string, { readonly first: string; count: number }>();
  for (const message of messages) {
    const key = message.replaceAll(/\[\d+\]/g, "[]");
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { first: message, count: 1 });
    else group.count += 1;
  }
  const listed = [...groups.values()].slice(0, MAX_LISTED);
  return {
    problems: listed.map(({ first, count }) =>
      count === 1 ? first : moreLikeIt(first, count - 1),
    ),
    unlisted: Math.max(0, total - listed.reduce((sum, group) => sum + group.count, 0)),
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads and checks a `.json` or `.json.gz` PMO file. */
export async function checkPmoFile(
  file: Blob,
  limit: number = IMPORT_LIMITS.textBytes,
): Promise<PmoFileCheck> {
  if (file.size > limit) return { kind: "too-large", limit };
  let data: unknown;
  try {
    data = await parsePmo(file);
  } catch (error) {
    if (error instanceof PmoError) {
      return { kind: "unreadable", reason: error.code === "io/invalid-gzip" ? "gzip" : "json" };
    }
    throw error;
  }
  if (!isRecord(data) || !isRecord(data["pmo_header"])) {
    return { kind: "unreadable", reason: "not-pmo" };
  }

  const version = readPmoVersion(data);
  if (version.schemaVersion !== PUBLISHABLE_PMO_VERSION) {
    return { kind: "wrong-version", declared: version.declared ?? null };
  }

  const validation = validatePmo(data, { schemaVersion: PUBLISHABLE_PMO_VERSION });
  if (!validation.valid) {
    return {
      kind: "invalid",
      ...listProblems(
        validation.errors.map((error) => error.message),
        validation.errorCount,
      ),
    };
  }

  const issues = checkPmoIntegrity(validation.pmo);
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    return {
      kind: "invalid",
      ...listProblems(
        errors.map((issue) =>
          issue.omitted === undefined ? issue.message : moreLikeIt(issue.message, issue.omitted),
        ),
        errors.length,
      ),
    };
  }

  return {
    kind: "ready",
    summary: summarisePmo(validation.pmo),
    publication: summarisePublication(validation.pmo),
    warnings: [
      ...new Set(
        issues.filter((issue) => issue.severity === "warning").map((issue) => issue.message),
      ),
    ].slice(0, MAX_LISTED),
  };
}
