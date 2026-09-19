import { useCallback, useEffect, useRef, useState } from 'react';
import { blockKey, pageKey } from '../lib/pageKey';
import type { MqsimEngine } from './useMqsimEngine';

// Tracks pages/blocks whose data just got copied elsewhere or erased, so
// the resulting plain 'invalid'/'free' cells - indistinguishable from any
// other page/block in that state by the time a snapshot is polled - can be
// outlined for one render instead of blending in. Three distinct event
// sources feed this, all superseding-or-erasing something that just
// happened rather than a state a snapshot can see on its own:
//
// 1. A host write reusing an already-mapped LPA (an overwrite): tracked via
//    a running LPA -> physical-page-key map built from mapping_updated
//    write events, so a later write to the same LPA reveals which old page
//    it just superseded. Reads never touch this map (they don't change a
//    mapping).
// 2. A GC/WL page migration: gc_page_migrated/wl_page_migrated already name
//    both the *source* page (`block`) and the *destination* page
//    (`newBlock`) directly (see GC_and_WL_Unit_Base.cpp - fired once both
//    are known, right after the destination is allocated), no LPA-tracking
//    needed to outline either side of the migration itself. The same
//    events' `lpa` field IS still used, though, to keep this hook's own
//    LPA -> page-key map (used for case 1 above) in sync - a migration
//    moves an LPA's data too, but never fires mapping_updated, so without
//    this an LPA migrated out of a block that's since been erased would
//    still point at that stale, now-free page as its "previous" location
//    on a later overwrite.
// 3. A GC/WL block erase: gc_block_erased/wl_block_erased names the whole
//    block, fired at the erase transaction's actual completion.
//
// Same one-step-overlay lifecycle as useMqsimMigrations' movingKeys - see
// its comment for why each pending ref is captured into a local before
// being reset, not read lazily inside the setState updater.
export function useMqsimOverwrites(subscribeEvents: MqsimEngine['subscribeEvents'], ready: boolean) {
  const lpaToPageKeyRef = useRef(new Map<bigint, string>());
  const pendingPagesRef = useRef(new Set<string>());
  const pendingBlocksRef = useRef(new Set<string>());
  const [supersededKeys, setSupersededKeys] = useState<Set<string>>(new Set());
  const [erasingBlockKeys, setErasingBlockKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!ready) return;
    return subscribeEvents((event) => {
      if (event.type === 'gc_page_migrated' || event.type === 'wl_page_migrated') {
        if (event.block && 'page' in event.block) {
          pendingPagesRef.current.add(pageKey(event.block.chip, event.block.block, event.block.page));
        }
        if (event.newBlock) {
          pendingPagesRef.current.add(pageKey(event.newBlock.chip, event.newBlock.block, event.newBlock.page));
          if (event.lpa !== undefined) {
            lpaToPageKeyRef.current.set(event.lpa, pageKey(event.newBlock.chip, event.newBlock.block, event.newBlock.page));
          }
        }
        return;
      }
      if (event.type === 'gc_block_erased' || event.type === 'wl_block_erased') {
        if (event.block) {
          pendingBlocksRef.current.add(blockKey(event.block.chip, event.block.block));
        }
        return;
      }
      if (event.type !== 'mapping_updated' || !event.isWrite || event.lpa === undefined || !event.address) return;
      const lpa = event.lpa;
      const newKey = pageKey(event.address.chip, event.address.block, event.address.page);
      const oldKey = lpaToPageKeyRef.current.get(lpa);
      // Only an overwrite (a previous PPA for this LPA existed) gets
      // outlined - a first-ever write to an LPA has no "old" page to
      // contrast it with, so it's just a plain write.
      if (oldKey !== undefined && oldKey !== newKey) {
        pendingPagesRef.current.add(oldKey);
        pendingPagesRef.current.add(newKey);
      }
      lpaToPageKeyRef.current.set(lpa, newKey);
    });
  }, [subscribeEvents, ready]);

  const commit = useCallback(() => {
    const pendingPages = pendingPagesRef.current;
    pendingPagesRef.current = new Set();
    setSupersededKeys((prev) => (pendingPages.size === 0 && prev.size === 0 ? prev : pendingPages));

    const pendingBlocks = pendingBlocksRef.current;
    pendingBlocksRef.current = new Set();
    setErasingBlockKeys((prev) => (pendingBlocks.size === 0 && prev.size === 0 ? prev : pendingBlocks));
  }, []);

  const reset = useCallback(() => {
    lpaToPageKeyRef.current = new Map();
    pendingPagesRef.current = new Set();
    pendingBlocksRef.current = new Set();
    setSupersededKeys(new Set());
    setErasingBlockKeys(new Set());
  }, []);

  return { supersededKeys, erasingBlockKeys, commit, reset };
}
