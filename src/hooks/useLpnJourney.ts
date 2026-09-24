import { useCallback, useEffect, useRef, useState } from 'react';
import { blockKey, pageKey, streamLpaKey } from '../lib/pageKey';
import type { MqsimEngine } from './useMqsimEngine';

// One place a logical page's data has lived. `how` says how it got there:
// a host write (first write or overwrite) or a GC / static-WL move.
export interface JourneyStep {
  how: 'write' | 'overwrite' | 'gc' | 'wl';
  chip: number;
  block: number;
  page: number;
  // The block's erase count when this step happened - if the block has been
  // erased since, the old copy is physically gone (see eraseSeqRef).
  blockEraseSeq: number;
}

export interface LpnJourney {
  lpnKey: string;
  lpnLabel: string;
  steps: JourneyStep[];
  // Page keys (pageKey()) for FlashGrid: where the data lives now, and the
  // older copies that are invalid but not yet erased.
  currentKey: string | null;
  oldKeys: Set<string>;
  // Old copies whose block has since been erased - gone from the grid.
  erasedCount: number;
}

// Keeps a short history per LPN; older steps beyond this are dropped.
const MAX_STEPS = 12;

// "Follow one write": records, for every logical page, each physical page
// its data has occupied - so clicking an LPN in the log can show the whole
// out-of-place-update story (write here, overwrite goes elsewhere and the
// old page turns invalid, GC moves the survivor, the old block is erased).
export function useLpnJourney(subscribeEvents: MqsimEngine['subscribeEvents'], ready: boolean) {
  const historyRef = useRef(new Map<string, JourneyStep[]>());
  const eraseSeqRef = useRef(new Map<string, number>());
  const [tracked, setTracked] = useState<{ key: string; label: string } | null>(null);
  const [journey, setJourney] = useState<LpnJourney | null>(null);

  const build = useCallback((key: string, label: string): LpnJourney => {
    const steps = historyRef.current.get(key) ?? [];
    const alive = (step: JourneyStep) =>
      (eraseSeqRef.current.get(blockKey(step.chip, step.block)) ?? 0) === step.blockEraseSeq;
    const last = steps[steps.length - 1];
    const oldKeys = new Set<string>();
    let erasedCount = 0;
    steps.slice(0, -1).forEach((step) => {
      if (alive(step)) oldKeys.add(pageKey(step.chip, step.block, step.page));
      else erasedCount++;
    });
    return {
      lpnKey: key,
      lpnLabel: label,
      steps,
      currentKey: last ? pageKey(last.chip, last.block, last.page) : null,
      oldKeys,
      erasedCount,
    };
  }, []);

  const reset = useCallback(() => {
    historyRef.current = new Map();
    eraseSeqRef.current = new Map();
    setTracked(null);
    setJourney(null);
  }, []);

  useEffect(() => {
    if (!ready) return;
    return subscribeEvents((event) => {
      if ((event.type === 'gc_block_erased' || event.type === 'wl_block_erased') && event.block) {
        const key = blockKey(event.block.chip, event.block.block);
        eraseSeqRef.current.set(key, (eraseSeqRef.current.get(key) ?? 0) + 1);
        return;
      }
      let how: JourneyStep['how'] | null = null;
      let address: MqsimPageAddress | undefined;
      if (event.type === 'mapping_updated' && event.isWrite) {
        address = event.address;
        how = 'write';
      } else if (event.type === 'gc_page_migrated' || event.type === 'wl_page_migrated') {
        address = event.newBlock;
        how = event.type === 'gc_page_migrated' ? 'gc' : 'wl';
      }
      if (!how || !address || event.lpa === undefined) return;
      const key = streamLpaKey(event.streamId, event.lpa);
      const steps = historyRef.current.get(key) ?? [];
      if (how === 'write' && steps.length > 0) how = 'overwrite';
      steps.push({
        how,
        chip: address.chip,
        block: address.block,
        page: address.page,
        blockEraseSeq: eraseSeqRef.current.get(blockKey(address.chip, address.block)) ?? 0,
      });
      if (steps.length > MAX_STEPS) steps.shift();
      historyRef.current.set(key, steps);
    });
  }, [subscribeEvents, ready]);

  // Call once per refresh, after the step's events have arrived.
  const commit = useCallback(() => {
    if (tracked) setJourney(build(tracked.key, tracked.label));
  }, [tracked, build]);

  const select = useCallback(
    (key: string | null, label = '') => {
      if (!key) {
        setTracked(null);
        setJourney(null);
        return;
      }
      setTracked({ key, label });
      setJourney(build(key, label));
    },
    [build],
  );

  return { journey, select, commit, reset };
}
