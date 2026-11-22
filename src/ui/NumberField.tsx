import { t } from "@lingui/core/macro";
import { useState, type InputHTMLAttributes, type Ref } from "react";

import { cn } from "./cn";
import { Field, inputClassName, type FieldProps } from "./Field";

/** Props for {@link NumberField}. */
export interface NumberFieldProps
  extends
    Omit<
      InputHTMLAttributes<HTMLInputElement>,
      "children" | "id" | "value" | "defaultValue" | "onChange" | "type" | "min" | "max"
    >,
    Pick<FieldProps, "label" | "hint" | "error" | "optional" | "hideLabel" | "id" | "layout"> {
  /** The number, or `null` when the input is blank. */
  value: number | null;
  /** Called with each valid entry. Not called while the text is not a number. */
  onValueChange: (value: number | null) => void;
  /** Only whole numbers are valid. */
  integer?: boolean;
  min?: number;
  max?: number;
  ref?: Ref<HTMLInputElement>;
}

type Parsed = { ok: true; value: number | null } | { ok: false; message: string };

function parse(text: string, options: { integer: boolean; min?: number; max?: number }): Parsed {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: null };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { ok: false, message: t`Enter a number.` };
  if (options.integer && !Number.isInteger(value)) {
    return { ok: false, message: t`Enter a whole number.` };
  }
  const { min, max } = options;
  if (min !== undefined && value < min) {
    return { ok: false, message: t`Enter ${min} or more.` };
  }
  if (max !== undefined && value > max) {
    return { ok: false, message: t`Enter ${max} or less.` };
  }
  return { ok: true, value };
}

const show = (value: number | null) => (value === null ? "" : String(value));

/**
 * A labelled number input. It keeps what the user types, reports only valid
 * numbers through `onValueChange`, and explains what is wrong otherwise.
 */
export function NumberField({
  label,
  hint,
  error,
  required,
  optional,
  hideLabel,
  id,
  layout,
  value,
  onValueChange,
  integer = false,
  min,
  max,
  className,
  ...input
}: NumberFieldProps) {
  const [text, setText] = useState(() => show(value));
  const [lastValue, setLastValue] = useState(value);
  const options = { integer, min, max };

  // Follow outside changes to `value` without overwriting what is being typed.
  if (value !== lastValue) {
    setLastValue(value);
    const current = parse(text, options);
    if (!current.ok || current.value !== value) setText(show(value));
  }

  const parsed = parse(text, options);
  const localError = parsed.ok ? undefined : parsed.message;

  const compact = layout === "compact";

  return (
    <Field
      label={label}
      hint={hint}
      error={error ?? localError}
      required={required}
      optional={optional}
      hideLabel={hideLabel}
      id={id}
      layout={layout}
      className={className}
    >
      {(control) => {
        const element = (
          <input
            {...input}
            {...control}
            type="text"
            inputMode={integer ? "numeric" : "decimal"}
            required={required}
            value={text}
            onChange={(event) => {
              const next = event.target.value;
              setText(next);
              const result = parse(next, options);
              if (result.ok) {
                setLastValue(result.value);
                onValueChange(result.value);
              }
            }}
            className={cn(
              inputClassName,
              compact ? "h-control-sm text-sm tabular-nums" : "h-control text-base tabular-nums",
            )}
          />
        );
        return compact ? <div className="w-24 shrink-0">{element}</div> : element;
      }}
    </Field>
  );
}
