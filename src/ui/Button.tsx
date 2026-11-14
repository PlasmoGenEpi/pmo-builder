import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, MouseEvent, Ref } from "react";

import { cn } from "./cn";
import { Spinner } from "./Spinner";

/** Visual weight of a button. Use one primary button per view. */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
/** Height and padding of a button. */
export type ButtonSize = "sm" | "md" | "lg";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg shadow-xs hover:bg-accent-hover",
  secondary:
    "border border-border bg-surface text-text shadow-xs hover:border-border-strong hover:bg-surface-subtle",
  ghost: "text-text-muted hover:bg-surface-muted hover:text-text",
  danger: "bg-danger text-danger-fg shadow-xs hover:bg-danger-hover",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-control-sm gap-1.5 px-2.5 text-sm",
  md: "h-control gap-2 px-3.5 text-base",
  lg: "h-control-lg gap-2 px-5 text-md",
};

const iconSizes: Record<ButtonSize, string> = { sm: "size-3.5", md: "size-4", lg: "size-4.5" };

/** Options for {@link buttonClassName}. */
export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

/**
 * The classes of a button, for elements that must look like a button but are
 * not one, such as a router link or a download link. Prefer `Button` or
 * `ButtonLink` when you can.
 */
export function buttonClassName({
  variant = "secondary",
  size = "md",
  fullWidth = false,
}: ButtonStyleOptions = {}): string {
  return cn(
    "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md font-medium whitespace-nowrap select-none",
    "transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-60",
    variantClasses[variant],
    sizeClasses[size],
    fullWidth && "w-full",
  );
}

/** Props for {@link Button}. */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, keeps the label, and ignores clicks until it is false again. */
  loading?: boolean;
  /** A lucide icon shown before the label. */
  icon?: LucideIcon;
  fullWidth?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * A button. Defaults to `type="button"` so it never submits a form by accident.
 *
 * @example
 * <Button variant="primary" icon={Download} onClick={save}>Download PMO</Button>
 */
export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon: Icon,
  fullWidth,
  className,
  children,
  type = "button",
  onClick,
  ...rest
}: ButtonProps) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }

  return (
    <button
      {...rest}
      type={type}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={handleClick}
      className={cn(buttonClassName({ variant, size, fullWidth }), className)}
    >
      {loading ? (
        <Spinner size={size === "lg" ? "md" : "sm"} label={null} />
      ) : Icon ? (
        <Icon aria-hidden="true" className={iconSizes[size]} />
      ) : null}
      {children}
    </button>
  );
}
