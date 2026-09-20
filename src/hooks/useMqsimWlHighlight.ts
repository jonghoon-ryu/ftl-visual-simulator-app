import { useCallback, useEffect, useRef, useState } from 'react';
import { blockKey } from '../lib/pageKey';
import type { WlTriggerInfo } from '../types';
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
// after the moment has already passed. commit() also returns whether a new
// trigger happened this call, so App.tsx can auto-pause playback right at
// the moment a beginner most needs to look (found 2026-09-20: Ryu tested
// "마모평준화 시연" and couldn't tell whether it had worked, then asked for
// exactly this: pause + an explanation of what condition was satisfied).
export function useMqsimWlHighlight(subscribeEvents: MqsimEngine['subscribeEvents'], ready: boolean) {
  const pendingKeysRef = useRef(new Set<string>());
  const pendingTriggerRef = useRef<WlTriggerInfo | null>(null);
  const [wlTargetKeys, setWlTargetKeys] = useState<Set<string>>(new Set());
  const [lastTrigger, setLastTrigger] = useState<WlTriggerInfo | null>(null);

  useEffect(() => {
    if (!ready) return;
    return subscribeEvents((event) => {
      if (event.type !== 'wl_started' || !event.block) return;
      pendingKeysRef.current.add(blockKey(event.block.chip, event.block.block));
      // min_erase_count/max_erase_count/max_erase_block_id are computed
      // within a single plane (this preset pins chipCount to 1), so the
      // hottest block is always on the same chip as the target.
      pendingTriggerRef.current = {
        targetChip: event.block.chip,
        targetBlock: event.block.block,
        minEraseCount: event.minEraseCount ?? 0,
        maxEraseChip: event.block.chip,
        maxEraseBlock: event.maxEraseBlockId ?? 0,
        maxEraseCount: event.maxEraseCount ?? 0,
        threshold: event.threshold ?? 0,
      };
    });
  }, [subscribeEvents, ready]);

  // Call once per step/tick after refresh() - same timing as useMqsimMigrations'
  // commit(), but unions the target-key set into the existing one instead
  // of replacing it. Returns true if a new trigger happened this call.
  const commit = useCallback((): boolean => {
    const pendingKeys = pendingKeysRef.current;
    const pendingTrigger = pendingTriggerRef.current;
    if (pendingKeys.size === 0) return false;
    pendingKeysRef.current = new Set();
    pendingTriggerRef.current = null;
    setWlTargetKeys((prev) => {
      const next = new Set(prev);
      pendingKeys.forEach((key) => next.add(key));
      return next;
    });
    setLastTrigger(pendingTrigger);
    return true;
  }, []);

  const reset = useCallback(() => {
    pendingKeysRef.current = new Set();
    pendingTriggerRef.current = null;
    setWlTargetKeys(new Set());
    setLastTrigger(null);
  }, []);

  return { wlTargetKeys, lastTrigger, commit, reset };
}
