import { useCallback, useRef, useState } from 'react';

// useState plus a ref that always holds the latest value set - updated
// synchronously by the setter, not on the next render. The step-back
// snapshots (useSimulationPlayback's stepBack) read hook state between the
// five steps of "5 steps", before React has necessarily rendered the first one's
// updates, so a plain useState value (or a ref synced in an effect) could
// still be a step behind there. Functional updates run against the ref
// right away instead of being queued.
export function useMirroredState<T>(initial: T) {
  const [value, setValue] = useState(initial);
  const ref = useRef(initial);
  const set = useCallback((next: T | ((prev: T) => T)) => {
    const resolved = typeof next === 'function' ? (next as (prev: T) => T)(ref.current) : next;
    ref.current = resolved;
    setValue(resolved);
  }, []);
  return [value, set, ref] as const;
}
