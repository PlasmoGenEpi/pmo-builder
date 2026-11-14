import { createContext, useContext, useId, useMemo, type ReactNode } from "react";

import { cn } from "./cn";

/** What a control inside a {@link Field} needs to wire itself to the label and messages. */
export interface FieldControlProps {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": true | undefined;
  "aria-required": true | undefined;
}

const FieldContext = createContext<FieldControlProps | null>(null);

/**
 * Returns the id and ARIA attributes for a control rendered inside a `Field`,
 * or `null` outside one. Custom controls call this to label themselves.
 */
export function useFieldControl(): FieldControlProps | null {
  return useContext(FieldContext);
}

/** Props for {@link Field}. */
export interface FieldProps {
  label: ReactNode;
  /** One short sentence under the label. */
  hint?: ReactNode;
  /** Shown under the control and announced. Say what is wrong and how to fix it. */
  error?: ReactNode;
  /** Shows a "Required" marker. */
  required?: boolean;
  /** Shows an "Optional" marker. Use it on forms where most fields are required. */
  optional?: boolean;
  /** Hides the label visually but keeps it for screen readers. */
  hideLabel?: boolean;
  /** Overrides the generated control id. */
  id?: string;
  /**
   * `stacked` (default) puts the label above the control. `inline` puts the
   * label and hint on the left and the control on the right from the `sm`
   * breakpoint, for long lists of similar fields such as column matches.
   */
  layout?: "stacked" | "inline";
  className?: string;
  /** The control. Primitives inside read the wiring from context; others can use the render form. */
  children: ReactNode | ((control: FieldControlProps) => ReactNode);
}

/**
 * A label, optional hint and error message around one control. It gives the
 * control its id and wires `aria-describedby` and `aria-invalid`.
 *
 * @example
 * <Field label="Panel name" hint="As it appears in your lab notes" required>
 *   <Combobox options={columns} value={value} onChange={setValue} />
 * </Field>
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  optional = false,
  hideLabel = false,
  id,
  layout = "stacked",
  className,
  children,
}: FieldProps) {
  const generated = useId();
  const controlId = id ?? `field-${generated}`;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const hasError = error !== undefined && error !== null && error !== false;
  const describedBy =
    [hint ? hintId : null, hasError ? errorId : null].filter(Boolean).join(" ") || undefined;

  const control = useMemo<FieldControlProps>(
    () => ({
      id: controlId,
      "aria-describedby": describedBy,
      "aria-invalid": hasError ? true : undefined,
      "aria-required": required ? true : undefined,
    }),
    [controlId, describedBy, hasError, required],
  );

  const inline = layout === "inline";
  const controlAndError = (
    <>
      <FieldContext.Provider value={control}>
        {typeof children === "function" ? children(control) : children}
      </FieldContext.Provider>
      {hasError ? (
        <p id={errorId} className="flex items-start gap-1.5 text-sm text-danger-text">
          {error}
        </p>
      ) : null}
    </>
  );

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5",
        inline && "sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] sm:items-start sm:gap-x-6",
        className,
      )}
    >
      <div className={cn("flex flex-col gap-0.5", inline && "sm:pt-1.5", hideLabel && "sr-only")}>
        <label
          htmlFor={controlId}
          className="flex items-baseline gap-2 text-base font-medium text-text"
        >
          <span>{label}</span>
          {required ? <span className="text-xs font-normal text-text-subtle">Required</span> : null}
          {optional && !required ? (
            <span className="text-xs font-normal text-text-subtle">Optional</span>
          ) : null}
        </label>
        {hint ? (
          <p id={hintId} className="text-sm text-text-muted">
            {hint}
          </p>
        ) : null}
      </div>
      {inline ? (
        <div className="flex min-w-0 flex-col gap-1.5">{controlAndError}</div>
      ) : (
        controlAndError
      )}
    </div>
  );
}

/** Shared look of text inputs, so custom controls can match. Add a text size (`text-base`, or `font-mono text-sm`). */
export const inputClassName = cn(
  "w-full min-w-0 rounded-md border border-border-strong bg-surface px-3 text-text shadow-xs",
  "placeholder:text-text-subtle transition-colors duration-100",
  "hover:border-text-subtle focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent",
  "disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-text-subtle",
  "aria-invalid:border-danger aria-invalid:focus-visible:outline-danger",
);
