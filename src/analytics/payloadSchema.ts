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
  DOWNLOAD_KINDS,
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
