import { useEffect, useState } from "react";

/**
 * `value` once it has stopped changing for `delay` ms, so typing does not
 * recount on every key. Give it a stable value, such as a memoised object.
 */
export function useSettled<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
