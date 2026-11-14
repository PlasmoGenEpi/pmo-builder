import type { Ref, TextareaHTMLAttributes } from "react";

import { cn } from "./cn";
import { Field, inputClassName, type FieldProps } from "./Field";

/** Props for {@link TextArea}. */
export interface TextAreaProps
  extends
    Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "children" | "id">,
    Pick<FieldProps, "label" | "hint" | "error" | "optional" | "hideLabel" | "id"> {
  mono?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}

/** A labelled multi-line text input. It can be resized vertically. */
export function TextArea({
  label,
  hint,
  error,
  required,
  optional,
  hideLabel,
  id,
  mono,
  className,
  rows = 4,
  ...textarea
}: TextAreaProps) {
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
        <textarea
          rows={rows}
          {...textarea}
          {...control}
          required={required}
          className={cn(inputClassName, "resize-y py-2", mono ? "font-mono text-sm" : "text-base")}
        />
      )}
    </Field>
  );
}
