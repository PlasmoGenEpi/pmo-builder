import { plural, t } from "@lingui/core/macro";
import type { ReactNode } from "react";

import type { FormFieldSpec, KeyValueEntry } from "@/domain/draft";
import { Disclosure, cn } from "@/ui";

import type { FieldFixer } from "./checks";
import { ExtraDetails } from "./ExtraDetails";
import { RecordField } from "./RecordField";

/** Props for {@link RecordForm}. */
export interface RecordFormProps<K extends string> {
  /** The form spec, from `@/domain/draft`. Required fields are shown first, optional ones collapsed. */
  readonly fields: readonly FormFieldSpec<K>[];
  /** The committed values, by field key. */
  readonly values: Readonly<Record<K, string>>;
  /** Commits one value. Called on blur or after a pause in typing. */
  readonly onValueChange: (key: K, value: string) => void;
  /** Free name and value pairs, for records whose model has `extra`. Leave out to hide them. */
  readonly extra?: {
    readonly entries: readonly KeyValueEntry[];
    readonly onUpdate: (
      recipe: (entries: readonly KeyValueEntry[]) => readonly KeyValueEntry[],
    ) => void;
  };
  /**
   * Values to suggest in a field while still allowing any text, such as what
   * other records hold. Shown before the usual values from the field's spec.
   */
  readonly suggestions?: Partial<Record<K, readonly string[]>>;
  /** One-click fixes for values a field's format rejects. */
  readonly fixes?: Partial<Record<K, FieldFixer>>;
  /** Controls shown with the required fields, after them, such as a run's method. */
  readonly requiredExtra?: ReactNode;
  /** Title of the collapsed part. Default "More details". */
  readonly optionalTitle?: string;
  /** Show "fill this in" on blank required fields before they are visited, once the record has content. */
  readonly showMissing?: boolean;
}

/** What to suggest in one field: the caller's values, then the spec's usual values, without repeats. */
function fieldSuggestions(
  field: FormFieldSpec,
  given: readonly string[] | undefined,
): readonly string[] | undefined {
  if (field.suggestions === undefined) return given;
  return [...new Set([...(given ?? []), ...field.suggestions])];
}

function isWide(field: FormFieldSpec): boolean {
  return field.kind === "multiline" || field.kind === "list" || field.kind === "integerList";
}

/**
 * A hand-entered record driven by its form spec: the required fields, then
 * the optional fields and other details behind a disclosure that opens by
 * itself when any of them holds a value.
 */
export function RecordForm<K extends string>({
  fields,
  values,
  onValueChange,
  extra,
  suggestions,
  fixes,
  requiredExtra,
  optionalTitle = t`More details`,
  showMissing = false,
}: RecordFormProps<K>) {
  const required = fields.filter((field) => field.required);
  const optional = fields.filter((field) => !field.required);
  const filled =
    optional.filter((field) => values[field.key].trim() !== "").length +
    (extra?.entries.filter((entry) => entry.key.trim() !== "" || entry.value.trim() !== "")
      .length ?? 0);

  const renderField = (field: FormFieldSpec<K>) => (
    <RecordField
      key={field.key}
      spec={field}
      value={values[field.key]}
      onCommit={(value) => onValueChange(field.key, value)}
      suggestions={fieldSuggestions(field, suggestions?.[field.key])}
      fix={fixes?.[field.key]}
      showMissing={showMissing}
      className={cn(isWide(field) && "sm:col-span-2")}
    />
  );

  const hasOptional = optional.length > 0 || extra !== undefined;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-x-5 gap-y-5 sm:grid-cols-2">
        {required.map(renderField)}
        {requiredExtra}
      </div>
      {hasOptional ? (
        <Disclosure
          title={optionalTitle}
          summary={
            filled > 0
              ? plural(filled, { one: "# filled in", other: "# filled in" })
              : plural(optional.length, { one: "# optional field", other: "# optional fields" })
          }
          defaultOpen={filled > 0}
        >
          <div className="flex flex-col gap-6">
            {optional.length > 0 ? (
              <div className="grid gap-x-5 gap-y-5 sm:grid-cols-2">{optional.map(renderField)}</div>
            ) : null}
            {extra === undefined ? null : (
              <ExtraDetails
                entries={extra.entries}
                onUpdate={extra.onUpdate}
                fieldKeys={fields.map((field) => field.key)}
              />
            )}
          </div>
        </Disclosure>
      ) : null}
    </div>
  );
}
