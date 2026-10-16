import { useCallback, useEffect, useRef } from 'react';
import { useMirroredState } from './useMirroredState';
import { blockKey } from '../lib/pageKey';
import type { WlTriggerInfo } from '../types';
import type { MqsimEngine } from './useMqsimEngine';

// Static WL used to fire only once or twice in a whole "마모평준화 시연" run
// (it now fires ~90 times since the DRAM cache was shrunk to a realistic
// size - see DATA_CACHE_CAPACITY_PAGES in mqsimConfigs.ts) - unlike GC's
// transient one-step "moving"/"erasing" overlay (useMqsimMigrations/
// useMqsimOverwrites, meant to be caught live, mid-step), a beginner has
// essentially no realistic chance of noticing WL's single occurrence while
// it's playing at 8x speed across ~2.8M event-groups. So this tracks how
// many times each block was EVER a WL target, persistently for the rest of
// the current run (accumulated, never cleared by commit() the way the GC
// overlays are) - WearLevelingView's "발동 횟수" column can then show a
// lasting record even after the moment has already passed. commit() also
// returns whether this call committed the run's FIRST trigger, so App.tsx
// can auto-pause playback right at the moment a beginner most needs to look
// (found 2026-09-20: Ryu tested "마모평준화 시연" and couldn't tell whether
// it had worked, then asked for exactly this: pause + an explanation of
// what condition was satisfied).
export function useMqsimWlHighlight(subscribeEvents: MqsimEngine['subscribeEvents'], ready: boolean) {
  // Bumped by reset() - lets commit() detect and discard a stale in-flight
  // tick's pending data instead of merging it in (found 2026-09-20: Ryu saw
  // Block 0's "발동" marker survive pressing ⏮. Root cause: ⏮ can be
  // pressed while a play tick's own commit() is still in flight - if that
  // commit() resolves *after* reset() already cleared things, it would
  // otherwise resurrect the OLD run's marker in the fresh one).
  const epochRef = useRef(0);
  const pendingEpochRef = useRef(0);
  const pendingKeyCountsRef = useRef(new Map<string, number>());
  const pendingTriggerRef = useRef<WlTriggerInfo | null>(null);
  const [wlTargetCounts, setWlTargetCounts, wlTargetCountsRef] = useMirroredState<Map<string, number>>(new Map());
  const [lastTrigger, setLastTrigger, lastTriggerRef] = useMirroredState<WlTriggerInfo | null>(null);
  // Whether the "⭐ 마모평준화가 발동했어요" banner (and its explanation
  // button) should currently show - true from the moment a trigger commits
  // until dismissBanner() is called. Kept separate from lastTrigger/
  // wlTargetCounts (which must stay forever, per the doc comment above) since
  // Ryu asked (2026-09-20) for the banner itself to go away once playback
  // resumes past the pause it caused - it did its job (getting a beginner to
  // stop and look), and re-showing "발동했어요" while the sim keeps running
  // reads as stuck/stale rather than historical.
  const [bannerVisible, setBannerVisible, bannerVisibleRef] = useMirroredState(false);
  // Whether this run's first trigger has been committed. Only that one
  // pauses ▶ and shows the banner - once WL fires dozens of times per run,
  // pausing on every one would stop playback almost every tick, and a
  // banner that reappears right after resuming reads as stuck (the reason
  // Ryu asked for it to go away on resume in the first place).
  const firstTriggerDoneRef = useRef(false);

  useEffect(() => {
    if (!ready) return;
    return subscribeEvents((event) => {
      if (event.type !== 'wl_started' || !event.block) return;
      const key = blockKey(event.block.chip, event.block.block);
      pendingKeyCountsRef.current.set(key, (pendingKeyCountsRef.current.get(key) ?? 0) + 1);
      pendingEpochRef.current = epochRef.current;
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
  // commit(), but adds the pending counts into the existing map instead of
  // replacing it. Returns true only when this call committed the run's
  // first trigger (see firstTriggerDoneRef).
  const commit = useCallback((): boolean => {
    const pendingCounts = pendingKeyCountsRef.current;
    const pendingTrigger = pendingTriggerRef.current;
    const pendingEpoch = pendingEpochRef.current;
    if (pendingCounts.size === 0) return false;
    pendingKeyCountsRef.current = new Map();
    pendingTriggerRef.current = null;
    // Stale data captured before the most recent reset() - discard instead
    // of merging it into the fresh run (see epochRef's doc comment above).
    if (pendingEpoch !== epochRef.current) return false;
    setWlTargetCounts((prev) => {
      const next = new Map(prev);
      pendingCounts.forEach((count, key) => next.set(key, (next.get(key) ?? 0) + count));
      return next;
    });
    setLastTrigger(pendingTrigger);
    if (firstTriggerDoneRef.current) return false;
    firstTriggerDoneRef.current = true;
    setBannerVisible(true);
    return true;
  }, [setWlTargetCounts, setLastTrigger, setBannerVisible]);

  const dismissBanner = useCallback(() => setBannerVisible(false), [setBannerVisible]);

  const reset = useCallback(() => {
    epochRef.current += 1;
    firstTriggerDoneRef.current = false;
    pendingKeyCountsRef.current = new Map();
    pendingTriggerRef.current = null;
    setWlTargetCounts(new Map());
    setLastTrigger(null);
    setBannerVisible(false);
  }, [setWlTargetCounts, setLastTrigger, setBannerVisible]);

  // Step-back: the committed map is replaced on every commit, never mutated.
  const snapshot = useCallback(
    () => ({
      wlTargetCounts: wlTargetCountsRef.current,
      lastTrigger: lastTriggerRef.current,
      bannerVisible: bannerVisibleRef.current,
      firstTriggerDone: firstTriggerDoneRef.current,
    }),
    [wlTargetCountsRef, lastTriggerRef, bannerVisibleRef],
  );
  const restore = useCallback(
    (snap: ReturnType<typeof snapshot>) => {
      pendingKeyCountsRef.current = new Map();
      pendingTriggerRef.current = null;
      firstTriggerDoneRef.current = snap.firstTriggerDone;
      setWlTargetCounts(snap.wlTargetCounts);
      setLastTrigger(snap.lastTrigger);
      setBannerVisible(snap.bannerVisible);
    },
    [setWlTargetCounts, setLastTrigger, setBannerVisible],
  );

  return { wlTargetCounts, lastTrigger, bannerVisible, dismissBanner, commit, reset, snapshot, restore };
}
