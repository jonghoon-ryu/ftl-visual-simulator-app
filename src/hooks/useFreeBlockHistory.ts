import { useCallback, useEffect, useRef, useState } from 'react';
import type { MqsimEngine } from './useMqsimEngine';

// One sample per playback tick/step: each plane's free-block pool size
// (one plane per chip in this project) at that moment.
export interface FreeBlockSample {
  freeBlocksPerChip: number[];
}

// A GC or static-WL start, pinned to the sample it happened in. For GC,
// `freeBlocks` is the pool size GC itself saw when it started - usually one
// below the threshold, a dip the per-tick samples can miss because GC
// refills the pool within the same tick.
export interface FreeBlockMarker {
  sampleIndex: number;
  chip: number;
  kind: 'gc' | 'wl';
  freeBlocks: number;
  validPages?: number;
  pagesPerBlock?: number;
}

// The most recent GC start, for GcVictimExplanation ("왜 이 block 을
// 골랐나요?").
export interface LastGcInfo {
  chip: number;
  block: number;
  validPages: number;
  invalidPages: number;
  pagesPerBlock: number;
  freeBlocks: number;
  gcThresholdBlocks: number;
  // How many GCs have started this run - lets the UI say "N번째 GC".
  count: number;
}

export interface FreeBlockHistory {
  samples: FreeBlockSample[];
  markers: FreeBlockMarker[];
  gcThresholdBlocks: number;
}

// Long runs ("GC 시연" ~180 ticks, WL ~180) fit easily; this only guards a
// runaway session from growing the chart forever.
const MAX_SAMPLES = 600;

const EMPTY: FreeBlockHistory = { samples: [], markers: [], gcThresholdBlocks: 0 };

// Feeds FreeBlockChart - "빈 block 수가 임계값 아래로 떨어지면 GC 가
// 시작된다" as a picture rather than a slider number.
export function useFreeBlockHistory(subscribeEvents: MqsimEngine['subscribeEvents'], ready: boolean) {
  const [history, setHistory] = useState<FreeBlockHistory>(EMPTY);
  const [lastGc, setLastGc] = useState<LastGcInfo | null>(null);
  const pendingLastGcRef = useRef<LastGcInfo | null>(null);
  const gcCountRef = useRef(0);
  const pendingMarkersRef = useRef<Omit<FreeBlockMarker, 'sampleIndex'>[]>([]);

  const reset = useCallback(() => {
    pendingMarkersRef.current = [];
    pendingLastGcRef.current = null;
    gcCountRef.current = 0;
    setHistory(EMPTY);
    setLastGc(null);
  }, []);

  useEffect(() => {
    if (!ready) return;
    return subscribeEvents((event) => {
      if (event.type === 'gc_started' && event.block) {
        gcCountRef.current += 1;
        pendingLastGcRef.current = {
          chip: event.block.chip,
          block: event.block.block,
          validPages: event.validPages ?? 0,
          invalidPages: event.invalidPages ?? 0,
          pagesPerBlock: event.pagesPerBlock ?? 0,
          freeBlocks: event.freeBlocks ?? 0,
          gcThresholdBlocks: event.gcThresholdBlocks ?? 0,
          count: gcCountRef.current,
        };
        pendingMarkersRef.current.push({
          chip: event.block.chip,
          kind: 'gc',
          freeBlocks: event.freeBlocks ?? 0,
          validPages: event.validPages,
          pagesPerBlock: event.pagesPerBlock,
        });
      } else if (event.type === 'wl_started' && event.block) {
        // No pool size on wl_started - filled in from the sample it lands in.
        pendingMarkersRef.current.push({ chip: event.block.chip, kind: 'wl', freeBlocks: -1 });
      }
    });
  }, [subscribeEvents, ready]);

  // Call once per refresh with the snapshot just fetched.
  const commit = useCallback((state: MqsimState | null) => {
    if (!state) return;
    const freeBlocksPerChip = state.stats.freeBlocksPerPlane;
    const pending = pendingMarkersRef.current;
    pendingMarkersRef.current = [];
    if (pendingLastGcRef.current) {
      setLastGc(pendingLastGcRef.current);
      pendingLastGcRef.current = null;
    }
    setHistory((prev) => {
      // Index of the sample being added, in the (possibly trimmed) array.
      const sampleIndex = prev.samples.length;
      const newMarkers = pending.map((marker) => ({
        ...marker,
        sampleIndex,
        freeBlocks: marker.freeBlocks >= 0 ? marker.freeBlocks : (freeBlocksPerChip[marker.chip] ?? 0),
      }));
      let samples = [...prev.samples, { freeBlocksPerChip }];
      let markers = [...prev.markers, ...newMarkers];
      const dropped = samples.length - MAX_SAMPLES;
      if (dropped > 0) {
        samples = samples.slice(dropped);
        markers = markers
          .map((marker) => ({ ...marker, sampleIndex: marker.sampleIndex - dropped }))
          .filter((marker) => marker.sampleIndex >= 0);
      }
      return { samples, markers, gcThresholdBlocks: state.stats.gcThresholdBlocks };
    });
  }, []);

  return { history, lastGc, commit, reset };
}
