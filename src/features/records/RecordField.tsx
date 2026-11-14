import { useId, useState } from "react";

import type { FormFieldSpec } from "@/domain/draft";
import { Button, TextArea, TextField } from "@/ui";

import { checkFieldValue, fieldHint, type FieldFixer } from "./checks";
import { useBufferedText } from "./useBufferedText";

/** Props for {@link RecordField}. */
export interface RecordFieldProps {
  readonly spec: FormFieldSpec;
  /** The committed value. */
  readonly value: string;
  readonly onCommit: (value: string) => void;
  /** Values to suggest while still allowing any text. */
  readonly suggestions?: readonly string[];
  /** A one-click fix for a value the format rejects. */
  readonly fix?: FieldFixer;
  /** Show the "fill this in" message for a blank required field before it is visited. */
  readonly showMissing?: boolean;
  readonly className?: string;
}

/**
 * One field of a hand-entered record, from its form spec: label, hint,
 * placeholder from the example, and an inline check. Keystrokes stay local
 * and are committed on blur or after a short pause.
 */
export function RecordField({
  spec,
  value,
  onCommit,
  suggestions,
  fix,
  showMissing = false,
  className,
}: RecordFieldProps) {
  const text = useBufferedText({ value, commit: onCommit });
  const [visited, setVisited] = useState(false);
  const listId = useId();
  // A value already saved is checked at once; one being typed, once the field is left.
  const shown = visited ? text.value : value;
  const problem = checkFieldValue(spec, shown, { showBlank: visited || showMissing });
  const offer = fix === undefined || problem === null ? null : fix(shown);
  const error =
    problem === null ? undefined : (
      <span className="flex flex-col items-start gap-1.5">
        <span>{problem}</span>
        {offer === null ? null : (
          <Button
            size="sm"
            onClick={() => {
              text.set(offer.value);
            }}
          >
            {offer.label}
          </Button>
        )}
      </span>
    );
  const common = {
    label: spec.label,
    hint: fieldHint(spec),
    error,
    required: spec.required,
    value: text.value,
    className,
    onBlur: () => {
      text.flush();
      setVisited(true);
    },
  };
  const options = suggestions?.filter((option) => option !== text.value) ?? [];

  if (spec.kind === "multiline" || spec.kind === "list" || spec.kind === "integerList") {
    return (
      <TextArea
        {...common}
        rows={spec.kind === "multiline" ? 3 : 4}
        onChange={(event) => text.onChange(event.target.value)}
      />
    );
  }
  return (
    <>
      <TextField
        {...common}
        placeholder={spec.kind === "date" ? "YYYY-MM-DD" : undefined}
        inputMode={spec.kind === "url" ? "url" : undefined}
        autoComplete="off"
        spellCheck={spec.kind === "text" ? undefined : false}
        list={options.length > 0 ? listId : undefined}
        onChange={(event) => text.onChange(event.target.value)}
      />
      {options.length > 0 ? (
        <datalist id={listId}>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </datalist>
      ) : null}
    </>
  );
}
