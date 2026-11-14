import { cn } from "@/ui";

/** The PMO Builder mark, from `public/logo.svg`. Decorative: pair it with the app name. */
export function Logo({ className }: { className?: string }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}logo.svg`}
      alt=""
      width={24}
      height={24}
      className={cn("size-6 shrink-0", className)}
    />
  );
}
