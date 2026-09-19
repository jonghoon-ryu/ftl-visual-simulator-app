import { useCallback, useEffect, useRef, useState } from 'react';
import { pageKey } from '../lib/pageKey';
import type { MqsimEngine } from './useMqsimEngine';

// FlashGrid never sees a 'moving' page state from a getState() snapshot
// (see toBlockRows' doc comment - a point-in-time poll can't catch a
// transient GC/WL page move). But the worker forwards every
// gc_page_migrated/wl_page_migrated event in real time as it happens
// *during* a step()/run() call, strictly before that call's own RPC
// response (mqsim.worker.ts posts each event synchronously off the same
// embind callback, before the final { id, ok, result } message) - so by
// the time stepOnce()/a play tick resolves, every migration event for that
// step has already reached subscribeEvents. This hook accumulates those
// page addresses and hands the caller a stable snapshot to overlay on the
// next render, so "GC 시연" actually shows the yellow 'moving' cells during
// the step where GC ran, instead of only ever seeing before/after.
export function useMqsimMigrations(subscribeEvents: MqsimEngine['subscribeEvents'], ready: boolean) {
  const pendingRef = useRef(new Set<string>());
  const [movingKeys, setMovingKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!ready) return;
    return subscribeEvents((event) => {
      if (event.type !== 'gc_page_migrated' && event.type !== 'wl_page_migrated') return;
      if (!event.block || !('page' in event.block)) return;
      pendingRef.current.add(pageKey(event.block.chip, event.block.block, event.block.page));
    });
  }, [subscribeEvents, ready]);

  // Call once right after a step's refresh() - promotes whatever migrated
  // during that step into render state, then starts a fresh empty set for
  // the next one. Captures pendingRef.current into a local *before*
  // resetting the ref - React doesn't call the setMovingKeys updater
  // synchronously, so reading pendingRef.current lazily inside it (with the
  // reset on the very next line) meant the updater always saw the
  // already-emptied Set by the time it actually ran, and movingKeys never
  // came out non-empty despite real migrations happening every run.
  const commit = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = new Set();
    setMovingKeys((prev) => (pending.size === 0 && prev.size === 0 ? prev : pending));
  }, []);

  // Call on restart - clears both the in-flight accumulator and whatever
  // was still highlighted from before the restart.
  const reset = useCallback(() => {
    pendingRef.current = new Set();
    setMovingKeys(new Set());
  }, []);

  return { movingKeys, commit, reset };
}
