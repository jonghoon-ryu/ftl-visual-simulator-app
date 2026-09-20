import { useCallback, useEffect, useRef, useState } from 'react';
import { blockKey } from '../lib/pageKey';
import type { MqsimEngine } from './useMqsimEngine';

// Static WL fires at most once or twice in a whole "마모평준화 시연" run
// (see DEFAULT_WL_PARAMS' doc comment in mqsimConfigs.ts) - unlike GC's
// transient one-step "moving"/"erasing" overlay (useMqsimMigrations/
// useMqsimOverwrites, meant to be caught live, mid-step), a beginner has
// essentially no realistic chance of noticing WL's single occurrence while
// it's playing at 8x speed across ~2.8M event-groups. So this tracks which
// block(s) were EVER a WL target, persistently for the rest of the current
// run (accumulated via union, never cleared by commit() the way the GC
// overlays are) - WearLevelingView can then show a lasting marker even
// after the moment has already passed, instead of nothing at all (found
// 2026-09-20: Ryu tested "마모평준화 시연" and couldn't tell whether it
// had worked - the view had no signal of the WL event ever happening).
export function useMqsimWlHighlight(subscribeEvents: MqsimEngine['subscribeEvents'], ready: boolean) {
  const pendingRef = useRef(new Set<string>());
  const [wlTargetKeys, setWlTargetKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!ready) return;
    return subscribeEvents((event) => {
      if (event.type !== 'wl_started' || !event.block) return;
      pendingRef.current.add(blockKey(event.block.chip, event.block.block));
    });
  }, [subscribeEvents, ready]);

  // Call once per step/tick after refresh() - same timing as useMqsimMigrations'
  // commit(), but unions into the existing set instead of replacing it.
  const commit = useCallback(() => {
    const pending = pendingRef.current;
    if (pending.size === 0) return;
    pendingRef.current = new Set();
    setWlTargetKeys((prev) => {
      const next = new Set(prev);
      pending.forEach((key) => next.add(key));
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    pendingRef.current = new Set();
    setWlTargetKeys(new Set());
  }, []);

  return { wlTargetKeys, commit, reset };
}
