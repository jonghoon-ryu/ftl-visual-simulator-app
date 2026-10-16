import { useCallback, useEffect, useRef } from 'react';
import { useMirroredState } from './useMirroredState';
import { blockKey, pageKey, streamLpaKey } from '../lib/pageKey';
import type { MqsimEngine } from './useMqsimEngine';

// Tracks pages/blocks that a host read/write, a GC/WL move or an erase just
// touched, so they can be outlined for one render instead of blending in
// with every other page in the same state. Four event sources feed this:
//
// 1. A host write: the newly written page is always outlined white (Ryu,
//    2026-10-11: a first write deserves the same marker as an overwrite).
//    If the LPA was already mapped (an overwrite), the old page it just
//    superseded is outlined too - found via a running LPA -> physical-page-
//    key map built from mapping_updated write events. Reads never touch
//    this map (they don't change a mapping).
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
// 4. A host read: the page it read is outlined in a separate colour
//    (readKeys) - mapping_updated with isWrite false names it directly. A
//    read of a never-written LPA has no address (it returns zeros without
//    touching flash), so nothing is outlined.
//
// Same one-step-overlay lifecycle as useMqsimMigrations' movingKeys - see
// its comment for why each pending ref is captured into a local before
// being reset, not read lazily inside the setState updater.
export function useMqsimOverwrites(subscribeEvents: MqsimEngine['subscribeEvents'], ready: boolean) {
  // Keyed by streamLpaKey(), not the bare LPA - each IO flow (stream) has its
  // own logical address space, so with 2+ flows (e.g. "마모평준화 시연"'s
  // cold + hot flows) the same LPA number means two different pages.
  const lpaToPageKeyRef = useRef(new Map<string, string>());
  const pendingPagesRef = useRef(new Set<string>());
  const pendingBlocksRef = useRef(new Set<string>());
  const pendingReadsRef = useRef(new Set<string>());
  const [supersededKeys, setSupersededKeys, supersededKeysRef] = useMirroredState<Set<string>>(new Set());
  const [readKeys, setReadKeys, readKeysRef] = useMirroredState<Set<string>>(new Set());
  const [erasingBlockKeys, setErasingBlockKeys, erasingBlockKeysRef] = useMirroredState<Set<string>>(new Set());

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
            lpaToPageKeyRef.current.set(streamLpaKey(event.streamId, event.lpa), pageKey(event.newBlock.chip, event.newBlock.block, event.newBlock.page));
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
      if (event.type !== 'mapping_updated' || event.lpa === undefined || !event.address) return;
      const key = pageKey(event.address.chip, event.address.block, event.address.page);
      if (!event.isWrite) {
        pendingReadsRef.current.add(key);
        return;
      }
      const lpa = streamLpaKey(event.streamId, event.lpa);
      const oldKey = lpaToPageKeyRef.current.get(lpa);
      pendingPagesRef.current.add(key);
      // An overwrite also outlines the page it just superseded - a first-
      // ever write to an LPA has no old page to point at.
      if (oldKey !== undefined && oldKey !== key) {
        pendingPagesRef.current.add(oldKey);
      }
      lpaToPageKeyRef.current.set(lpa, key);
    });
  }, [subscribeEvents, ready]);

  const commit = useCallback(() => {
    const pendingPages = pendingPagesRef.current;
    pendingPagesRef.current = new Set();
    setSupersededKeys((prev) => (pendingPages.size === 0 && prev.size === 0 ? prev : pendingPages));

    const pendingReads = pendingReadsRef.current;
    pendingReadsRef.current = new Set();
    setReadKeys((prev) => (pendingReads.size === 0 && prev.size === 0 ? prev : pendingReads));

    const pendingBlocks = pendingBlocksRef.current;
    pendingBlocksRef.current = new Set();
    setErasingBlockKeys((prev) => (pendingBlocks.size === 0 && prev.size === 0 ? prev : pendingBlocks));
  }, [setSupersededKeys, setReadKeys, setErasingBlockKeys]);

  const reset = useCallback(() => {
    lpaToPageKeyRef.current = new Map();
    pendingPagesRef.current = new Set();
    pendingBlocksRef.current = new Set();
    pendingReadsRef.current = new Set();
    setSupersededKeys(new Set());
    setReadKeys(new Set());
    setErasingBlockKeys(new Set());
  }, [setSupersededKeys, setReadKeys, setErasingBlockKeys]);

  // Step-back: the committed sets are replaced, never mutated; the LPA map
  // is mutated by every write, so it is copied.
  const snapshot = useCallback(
    () => ({
      lpaToPageKey: new Map(lpaToPageKeyRef.current),
      supersededKeys: supersededKeysRef.current,
      readKeys: readKeysRef.current,
      erasingBlockKeys: erasingBlockKeysRef.current,
    }),
    [supersededKeysRef, readKeysRef, erasingBlockKeysRef],
  );
  const restore = useCallback(
    (snap: ReturnType<typeof snapshot>) => {
      lpaToPageKeyRef.current = new Map(snap.lpaToPageKey);
      pendingPagesRef.current = new Set();
      pendingBlocksRef.current = new Set();
      pendingReadsRef.current = new Set();
      setSupersededKeys(snap.supersededKeys);
      setReadKeys(snap.readKeys);
      setErasingBlockKeys(snap.erasingBlockKeys);
    },
    [setSupersededKeys, setReadKeys, setErasingBlockKeys],
  );

  return { supersededKeys, readKeys, erasingBlockKeys, commit, reset, snapshot, restore };
}
