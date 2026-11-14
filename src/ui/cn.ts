import { clsx, type ClassValue } from "clsx";

/**
 * Joins class names, dropping falsy values.
 *
 * There is no conflict resolution: put the caller's `className` last and do
 * not pass two utilities for the same property.
 */
export function cn(...values: ClassValue[]): string {
  return clsx(values);
}
