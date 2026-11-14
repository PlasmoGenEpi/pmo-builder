import { Skeleton } from "@/ui";

/** What the preview shows while its code or its text loads. */
export function PreviewSkeleton() {
  return (
    <output className="flex flex-col gap-2" aria-busy="true" aria-label="Loading the preview">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-40 w-full" />
    </output>
  );
}
