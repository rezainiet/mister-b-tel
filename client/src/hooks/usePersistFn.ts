import { useCallback, useRef } from "react";

/**
 * Stable callback wrapper: returns a function whose identity never changes
 * across renders, but which always invokes the latest version of `fn`.
 *
 * Useful for handlers passed to memoized children / effects, so the parent
 * does not have to depend on `fn`'s identity to keep behavior current.
 */
export function usePersistFn<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback(((...args) => ref.current(...args)) as T, []);
}
