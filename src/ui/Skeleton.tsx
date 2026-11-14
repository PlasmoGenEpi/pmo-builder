import { cn } from "./cn";

/** Props for {@link Skeleton}. */
export interface SkeletonProps {
  /** Size it with utilities, such as `h-4 w-40`. */
  className?: string;
}

/** A grey block that holds the place of content that is loading. Hidden from screen readers. */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cn("block animate-pulse rounded-md bg-surface-muted", className)}
    />
  );
}
