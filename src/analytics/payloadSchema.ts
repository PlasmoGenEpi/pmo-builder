/**
 * Builds the JSON Schema for usage records from the same lists the types use.
 *
 * `docs/analytics-payload.schema.json` is this object, written out.
 * `payloadSchema.test.ts` fails when the file and the code disagree, and
 * checks real records from `createAnalytics` against it.
 *
 * Only a small part of JSON Schema is used (type, const, enum, pattern,
 * properties, required, additionalProperties, items, maxItems, oneOf), so a
 * receiver can check records with a few lines of code and no library.
 */
import {
  COLUMN_BUCKETS,
  COUNT_BUCKETS,
  DURATION_BUCKETS,
  ROW_BUCKETS,
  SIZE_BUCKETS,
} from "./buckets";
import { ISSUE_CODES } from "./codes";
import { MAX_ISSUES, PAYLOAD_VERSION } from "./payload";
import {
  DEPOSIT_OUTCOMES,
  DOWNLOAD_KINDS,
  FILE_CHECK_RESULTS,
  PAGES,
  PUBLISH_SOURCES,
  FILE_FORMATS,
  IMPORT_ROUTES,
  ISSUE_SEVERITIES,
  SECTION_STATUSES,
  SECTIONS,
  STEPS,
  TABLES,
  VALIDATION_RESULTS,
} from "./vocabulary";

/** The subset of JSON Schema used here. */
export interface JsonSchema {
  readonly $schema?: string;
  readonly title?: string;
  readonly description?: string;
  readonly type?: "object" | "array" | "string" | "boolean" | "integer" | "null";
  readonly const?: string | number;
  readonly enum?: readonly string[];
  readonly pattern?: string;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: false;
  readonly items?: JsonSchema;
  readonly maxItems?: number;
  readonly uniqueItems?: true;
  readonly oneOf?: readonly JsonSchema[];
}

const oneOf = (values: readonly string[]): JsonSchema => ({ type: "string", enum: values });
const boolean: JsonSchema = { type: "boolean" };
const nullable = (schema: JsonSchema): JsonSchema => ({ oneOf: [{ type: "null" }, schema] });

/** A closed object: every listed property is required unless `optional` says otherwise. */
function object(properties: Readonly<Record<string, JsonSchema>>, optional = false): JsonSchema {
  return {
    type: "object",
    properties,
    ...(optional ? {} : { required: Object.keys(properties) }),
    additionalProperties: false,
  };
}

/** A map from a fixed set of keys to one schema. Every key is optional. */
function keyed(keys: readonly string[], value: JsonSchema): JsonSchema {
  return object(Object.fromEntries(keys.map((key) => [key, value])), true);
}

const version: JsonSchema = { type: "integer", const: PAYLOAD_VERSION };
const app: JsonSchema = {
  type: "string",
  pattern: "^(unknown|[0-9]{1,4}\\.[0-9]{1,4}\\.[0-9]{1,4})$",
};

const visit = object({ v: version, kind: { type: "string", const: "visit" }, app });

const session = object({
  v: version,
  kind: { type: "string", const: "session" },
  app,
  steps: { type: "array", items: oneOf(STEPS), maxItems: STEPS.length, uniqueItems: true },
  pages: { type: "array", items: oneOf(PAGES), maxItems: PAGES.length, uniqueItems: true },
  tables: keyed(
    TABLES,
    object({
      import: nullable(
        object({
          route: oneOf(IMPORT_ROUTES),
          format: oneOf(FILE_FORMATS),
          gzip: boolean,
          rows: oneOf(ROW_BUCKETS),
          columns: oneOf(COLUMN_BUCKETS),
        }),
      ),
      mappingEdited: boolean,
    }),
  ),
  sections: keyed(SECTIONS, oneOf(SECTION_STATUSES)),
  build: object({
    built: oneOf(COUNT_BUCKETS),
    failed: oneOf(COUNT_BUCKETS),
    validation: oneOf(VALIDATION_RESULTS),
    schemaErrors: oneOf(COUNT_BUCKETS),
    downloads: object(
      Object.fromEntries(DOWNLOAD_KINDS.map((kind) => [kind, oneOf(COUNT_BUCKETS)])),
    ),
    downloadSize: nullable(oneOf(SIZE_BUCKETS)),
  }),
  publish: object({
    opened: object(Object.fromEntries(PUBLISH_SOURCES.map((key) => [key, oneOf(COUNT_BUCKETS)]))),
    deposits: object(Object.fromEntries(PUBLISH_SOURCES.map((key) => [key, oneOf(COUNT_BUCKETS)]))),
    outcomes: keyed(DEPOSIT_OUTCOMES, oneOf(COUNT_BUCKETS)),
    fileChecks: keyed(FILE_CHECK_RESULTS, oneOf(COUNT_BUCKETS)),
  }),
  issues: {
    type: "array",
    maxItems: MAX_ISSUES,
    items: object({
      code: oneOf(ISSUE_CODES),
      severity: oneOf(ISSUE_SEVERITIES),
      count: oneOf(COUNT_BUCKETS),
    }),
  },
  draftRestored: boolean,
  duration: oneOf(DURATION_BUCKETS),
});

/** The schema every usage record must match. A receiver should reject anything else. */
export const PAYLOAD_SCHEMA: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "PMO Builder usage record",
  description:
    "A visit or session record from PMO Builder. Generated from src/analytics/payloadSchema.ts. Holds no identifiers, timestamps or user data.",
  oneOf: [visit, session],
};

/** Record versions older than {@link PAYLOAD_VERSION} that browsers with an old copy of the app may still send. */
export const EARLIER_PAYLOAD_VERSIONS: readonly number[] = [1];

/**
 * What the receiver may store, fact by fact. A record is cut into
 * `[metric, value]` facts the way `receiver/src/facts.ts` does it, and each
 * fact is kept only if its metric lists its value here, or its value matches
 * the metric's pattern. `receiver/src/allowed-facts.json` is this, written out.
 */
export interface AllowedFacts {
  readonly values: Readonly<Record<string, readonly string[]>>;
  readonly patterns: Readonly<Record<string, string>>;
}

/** The values each property of an array item may take, in property order, joined by spaces. */
function joinedValues(schema: JsonSchema): string[] {
  let joined = [""];
  for (const property of Object.values(schema.properties ?? {})) {
    const values = property.enum ?? (property.const === undefined ? [] : [String(property.const)]);
    joined = joined.flatMap((prefix) =>
      values.map((value) => (prefix === "" ? value : `${prefix} ${value}`)),
    );
  }
  return joined;
}

/** Lists the facts `schema` allows at `path`, as `receiver/src/facts.ts` names them. */
function collectFacts(
  schema: JsonSchema,
  path: string,
  values: Map<string, Set<string>>,
  patterns: Map<string, string>,
): void {
  const add = (value: string): void => {
    const set = values.get(path) ?? new Set<string>();
    set.add(value);
    values.set(path, set);
  };
  if (schema.oneOf !== undefined) {
    for (const option of schema.oneOf) collectFacts(option, path, values, patterns);
    return;
  }
  switch (schema.type) {
    case "null":
      add("null");
      return;
    case "boolean":
      add("true");
      add("false");
      return;
    case "integer":
    case "string":
      if (schema.const !== undefined) add(String(schema.const));
      for (const value of schema.enum ?? []) add(value);
      if (schema.pattern !== undefined) patterns.set(path, schema.pattern);
      return;
    case "array":
      if (schema.items !== undefined) collectFacts(schema.items, path, values, patterns);
      return;
    case "object":
      // An object inside a list, such as an issue, is one fact: its values joined.
      if (path === "issues") {
        for (const value of joinedValues(schema)) add(value);
        return;
      }
      for (const [key, property] of Object.entries(schema.properties ?? {})) {
        collectFacts(property, path === "" ? key : `${path}.${key}`, values, patterns);
      }
      return;
    case undefined:
      return;
  }
}

/** The facts the receiver may store, from {@link PAYLOAD_SCHEMA} and the earlier versions. */
export function allowedFacts(schema: JsonSchema = PAYLOAD_SCHEMA): AllowedFacts {
  const values = new Map<string, Set<string>>();
  const patterns = new Map<string, string>();
  collectFacts(schema, "", values, patterns);
  const versions = values.get("v") ?? new Set<string>();
  for (const earlier of EARLIER_PAYLOAD_VERSIONS) versions.add(String(earlier));
  values.set("v", versions);
  const sortedKeys = [...values.keys()].toSorted();
  return {
    values: Object.fromEntries(
      sortedKeys.map((key) => [key, [...(values.get(key) ?? [])].toSorted()]),
    ),
    patterns: Object.fromEntries(
      [...patterns.entries()].toSorted(([a], [b]) => a.localeCompare(b)),
    ),
  };
}
