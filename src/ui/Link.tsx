import { ExternalLink } from "lucide-react";
import type { AnchorHTMLAttributes, Ref } from "react";

import { buttonClassName, type ButtonSize, type ButtonVariant } from "./Button";
import { cn } from "./cn";

/** Props for {@link Link}. */
export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  /** Opens in a new tab and marks the link as leaving the app. */
  external?: boolean;
  /** `inline` sits in running text; `standalone` is a link on its own line. */
  variant?: "inline" | "standalone";
  ref?: Ref<HTMLAnchorElement>;
}

/**
 * A text link. For in-app routes use the router's link with `href="#/path"`
 * semantics; this primitive renders a plain anchor.
 */
export function Link({
  external = false,
  variant = "inline",
  className,
  children,
  ...rest
}: LinkProps) {
  return (
    <a
      {...rest}
      {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
      className={cn(
        "rounded-sm text-accent-text underline-offset-2 hover:underline",
        variant === "inline" ? "underline decoration-accent-text/40" : "font-medium",
        external && "inline-flex items-center gap-1",
        className,
      )}
    >
      {children}
      {external ? (
        <>
          <ExternalLink aria-hidden="true" className="size-3.5" />
          <span className="sr-only">(opens in a new tab)</span>
        </>
      ) : null}
    </a>
  );
}

/** Props for {@link ButtonLink}. */
export interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  ref?: Ref<HTMLAnchorElement>;
}

/** An anchor that looks like a button, for downloads and navigation that should stand out. */
export function ButtonLink({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <a {...rest} className={cn(buttonClassName({ variant, size }), className)}>
      {children}
    </a>
  );
}
