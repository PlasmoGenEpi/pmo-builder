/**
 * Coarse buckets for every quantity a usage record reports.
 *
 * A record never holds a raw number. Each helper accepts `unknown`, so a
 * caller that passes the wrong thing gets the lowest bucket rather than an
 * exception or a leak.
 */

/** Row count labels. */
export const ROW_BUCKETS = [
  "0",
  "1-9",
  "10-99",
  "100-999",
  "1000-9999",
  "10000-99999",
  "100000+",
] as const;

/** A row count, bucketed. */
export type RowBucket = (typeof ROW_BUCKETS)[number];

/** Column count labels. */
export const COLUMN_BUCKETS = ["0", "1-4", "5-9", "10-19", "20-49", "50-99", "100+"] as const;

/** A column count, bucketed. */
export type ColumnBucket = (typeof COLUMN_BUCKETS)[number];

/** File size labels. */
export const SIZE_BUCKETS = [
  "0-10kb",
  "10-100kb",
  "100kb-1mb",
  "1-10mb",
  "10-100mb",
  "100mb+",
] as const;

/** A file size, bucketed. */
export type SizeBucket = (typeof SIZE_BUCKETS)[number];

/** Session length labels. */
export const DURATION_BUCKETS = ["0-1m", "1-5m", "5-15m", "15-60m", "60m+"] as const;

/** A session length, bucketed. */
export type DurationBucket = (typeof DURATION_BUCKETS)[number];

/** Labels for how many times something happened. */
export const COUNT_BUCKETS = ["0", "1", "2-4", "5-9", "10-99", "100+"] as const;

/** A count, bucketed. */
export type CountBucket = (typeof COUNT_BUCKETS)[number];

/**
 * Picks the label for `value`. `floors[i]` is the smallest value that falls in
 * `labels[i]`, and `floors` rises. Anything that is not a finite number of at
 * least zero falls in the first bucket.
 */
function pick<T extends string>(
  labels: readonly [T, ...T[]],
  floors: readonly number[],
  value: unknown,
): T {
  const [first] = labels;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return first;
  let label = first;
  labels.forEach((candidate, index) => {
    const floor = floors[index];
    if (floor !== undefined && value >= floor) label = candidate;
  });
  return label;
}

/** Buckets a number of table rows. */
export function bucketRows(rows: unknown): RowBucket {
  return pick(ROW_BUCKETS, [0, 1, 10, 100, 1000, 10_000, 100_000], rows);
}

/** Buckets a number of table columns. */
export function bucketColumns(columns: unknown): ColumnBucket {
  return pick(COLUMN_BUCKETS, [0, 1, 5, 10, 20, 50, 100], columns);
}

/** Buckets a size in bytes. */
export function bucketSize(bytes: unknown): SizeBucket {
  const kb = 1000;
  const mb = 1000 * kb;
  return pick(SIZE_BUCKETS, [0, 10 * kb, 100 * kb, mb, 10 * mb, 100 * mb], bytes);
}

/** Buckets a duration in milliseconds. */
export function bucketDuration(milliseconds: unknown): DurationBucket {
  const minute = 60_000;
  return pick(DURATION_BUCKETS, [0, minute, 5 * minute, 15 * minute, 60 * minute], milliseconds);
}

/** Buckets how many times something happened. */
export function bucketCount(count: unknown): CountBucket {
  return pick(COUNT_BUCKETS, [0, 1, 2, 5, 10, 100], count);
}
