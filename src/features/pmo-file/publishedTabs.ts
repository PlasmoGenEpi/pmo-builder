/** Tabs of the read-only published view, which are also the last part of its address (`#/published/<id>/summary`). */
export const PUBLISHED_TABS = ["overview", "summary", "compare", "tables"] as const;

/** One of {@link PUBLISHED_TABS}. */
export type PublishedTab = (typeof PUBLISHED_TABS)[number];

/** Whether `value` is a tab of the published view. */
export function isPublishedTab(value: string | undefined): value is PublishedTab {
  return PUBLISHED_TABS.some((tab) => tab === value);
}
