import { useCallback, useEffect, useRef, useState } from 'react';
import type { MqsimEngine } from './useMqsimEngine';

// One sample per playback tick/step: reads completed during that tick,
// their average and slowest device response time (µs), and how many GCs
// started in the same tick.
export interface ReadLatencySample {
  reads: number;
  avgUs: number;
  maxUs: number;
  gcStarts: number;
}

const MAX_SAMPLES = 600;

// Feeds ReadLatencyChart - "GC 가 읽기를 느리게 만든다" as a picture. The
// engine only keeps running totals (readsServiced / readResponseSumNs) plus
// the slowest read since the previous getState() call, so each sample is
// the difference from the previous refresh.
export function useReadLatencyHistory(subscribeEvents: MqsimEngine['subscribeEvents'], ready: boolean) {
  const [samples, setSamples] = useState<ReadLatencySample[]>([]);
  const prevRef = useRef({ reads: 0, sumNs: 0 });
  const gcInTickRef = useRef(0);

  const reset = useCallback(() => {
    prevRef.current = { reads: 0, sumNs: 0 };
    gcInTickRef.current = 0;
    setSamples([]);
  }, []);

  useEffect(() => {
    if (!ready) return;
    return subscribeEvents((event) => {
      if (event.type === 'gc_started') gcInTickRef.current++;
    });
  }, [subscribeEvents, ready]);

  const commit = useCallback((state: MqsimState | null) => {
    if (!state) return;
    const { readsServiced, readResponseSumNs, readResponseMaxNsSinceLastState } = state.stats;
    const reads = readsServiced - prevRef.current.reads;
    const sumNs = readResponseSumNs - prevRef.current.sumNs;
    prevRef.current = { reads: readsServiced, sumNs: readResponseSumNs };
    const sample: ReadLatencySample = {
      reads,
      avgUs: reads > 0 ? sumNs / reads / 1000 : 0,
      maxUs: readResponseMaxNsSinceLastState / 1000,
      gcStarts: gcInTickRef.current,
    };
    gcInTickRef.current = 0;
    setSamples((prev) => {
      const next = [...prev, sample];
      return next.length > MAX_SAMPLES ? next.slice(next.length - MAX_SAMPLES) : next;
    });
  }, []);

  return { samples, commit, reset };
}
