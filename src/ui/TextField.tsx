import type { InputHTMLAttributes, Ref } from "react";

import { cn } from "./cn";
import { Field, inputClassName, type FieldProps } from "./Field";

/** Props for {@link TextField}. */
export interface TextFieldProps
  extends
    Omit<InputHTMLAttributes<HTMLInputElement>, "children" | "id">,
    Pick<FieldProps, "label" | "hint" | "error" | "optional" | "hideLabel" | "id"> {
  /** Use for codes, sequences and file names. */
  mono?: boolean;
  ref?: Ref<HTMLInputElement>;
}

/** A labelled single-line text input. */
export function TextField({
  label,
  hint,
  error,
  required,
  optional,
  hideLabel,
  id,
  mono,
  className,
  ...input
}: TextFieldProps) {
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      required={required}
      optional={optional}
      hideLabel={hideLabel}
      id={id}
      className={className}
    >
      {(control) => (
        <input
          type="text"
          {...input}
          {...control}
          required={required}
          className={cn(inputClassName, "h-control", mono ? "font-mono text-sm" : "text-base")}
        />
      )}
    </Field>
  );
}
