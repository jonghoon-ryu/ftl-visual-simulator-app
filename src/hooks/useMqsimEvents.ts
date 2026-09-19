import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogEntry } from '../types';
import type { MqsimEngine } from './useMqsimEngine';

const MAX_LOG_ENTRIES = 50;

// dynamic_wl_block_allocated/freed fire on every write-frontier rotation
// (see their doc comments in Simulation_Events.h) - 1493 times just for the
// default sample scenario. Logging every one would flood the panel, so
// only 1 in N gets a line; the rest are silently dropped (they don't feed
// any counter here, unlike mapping_updated - see hostWrites/hostReads
// below, which must stay exact since StatsPanel's WAF depends on them).
const DYNAMIC_WL_LOG_SAMPLE_RATE = 20;

export interface SimulationCounters {
  hostWrites: number;
  hostReads: number;
}

function formatAddress(a: MqsimBlockAddress, page?: number): string {
  return page === undefined ? `Block ${a.block}` : `Block ${a.block} · Page ${page}`;
}

function describeEvent(event: MqsimEvent): string | null {
  switch (event.type) {
    case 'mapping_updated': {
      const lpaHex = `0x${(event.lpa ?? 0n).toString(16).padStart(3, '0')}`;
      const where = event.address ? formatAddress(event.address, event.address.page) : '';
      return `LPA ${lpaHex} 이(가) ${where} 에 매핑됨 (${event.isWrite ? '쓰기' : '읽기'})`;
    }
    case 'gc_started':
      return `${event.block ? formatAddress(event.block) : ''} GC 시작`;
    case 'gc_page_migrated':
      return `${event.block ? formatAddress(event.block, 'page' in event.block ? event.block.page : undefined) : ''} 의 유효 페이지를 GC 로 이동`;
    case 'gc_block_erased':
      return `${event.block ? formatAddress(event.block) : ''} 소거 완료 (GC)`;
    case 'wl_started':
      return `${event.block ? formatAddress(event.block) : ''} 정적 마모평준화(WL) 시작`;
    case 'wl_page_migrated':
      return `${event.block ? formatAddress(event.block, 'page' in event.block ? event.block.page : undefined) : ''} 의 데이터를 WL 로 이동`;
    case 'wl_block_erased':
      return `${event.block ? formatAddress(event.block) : ''} 소거 완료 (WL)`;
    case 'dynamic_wl_block_allocated':
      return `${event.block ? formatAddress(event.block) : ''} 이(가) 새 쓰기 프론티어로 할당됨 (erase count ${event.eraseCount})`;
    case 'dynamic_wl_block_freed':
      return `${event.block ? formatAddress(event.block) : ''} 이(가) free pool 로 반환됨 (erase count ${event.eraseCount})`;
    default:
      return null;
  }
}

// Subscribes to the worker-forwarded event stream (see useMqsimEngine's
// subscribeEvents) and turns it into (a) a capped, human-readable log for
// EventLog.tsx and (b) exact host-write/read counters for StatsPanel.tsx's
// WAF calculation. mapping_updated fires exactly once per logical page the
// host touches - the same page granularity as Stats::IssuedProgramCMD (the
// flash-side write count getState().stats exposes) - so counting it here
// is the correct WAF denominator, unlike a raw host I/O-request count (one
// request can span several pages).
//
// Events arrive one worker `message` per event (see mqsim.worker.ts), and a
// single play tick can carry tens of thousands of them (up to speed(8) *
// ticksMultiplier(12000-15000) event-groups, each capable of firing several
// events). Calling setState synchronously inside the listener - one commit
// per *event* - made a single tick trigger thousands of separate React
// renders, which is exactly the kind of main-thread storm that froze the
// tab during "GC 시연"/"마모평준화 시연" playback (reproduced on an
// unmodified checkout too, so this was always there, just never this
// visible before). Fixed the same way as useMqsimMigrations: accumulate
// into refs as events arrive, and only touch React state once, via
// commit(), which the caller runs once per step/tick after refresh() - so
// a whole tick's worth of events now costs one render, not thousands.
export function useMqsimEvents(subscribeEvents: MqsimEngine['subscribeEvents'], ready: boolean) {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [counters, setCounters] = useState<SimulationCounters>({ hostWrites: 0, hostReads: 0 });
  const dynamicWlSeenRef = useRef(0);
  const pendingCountersRef = useRef({ hostWrites: 0, hostReads: 0 });
  const pendingLogRef = useRef<string[]>([]);

  const reset = () => {
    pendingCountersRef.current = { hostWrites: 0, hostReads: 0 };
    pendingLogRef.current = [];
    setLog([]);
    setCounters({ hostWrites: 0, hostReads: 0 });
    dynamicWlSeenRef.current = 0;
  };

  // Call once right after a step's refresh() - flushes whatever accumulated
  // during that step into render state in a single setCounters/setLog pair.
  const commit = useCallback(() => {
    const pendingCounters = pendingCountersRef.current;
    if (pendingCounters.hostWrites > 0 || pendingCounters.hostReads > 0) {
      setCounters((prev) => ({
        hostWrites: prev.hostWrites + pendingCounters.hostWrites,
        hostReads: prev.hostReads + pendingCounters.hostReads,
      }));
      pendingCountersRef.current = { hostWrites: 0, hostReads: 0 };
    }

    const pendingLog = pendingLogRef.current;
    if (pendingLog.length > 0) {
      // Accumulated in arrival order (oldest first); the log itself is
      // newest-first, so reverse this batch before prepending it.
      const time = new Date().toLocaleTimeString('ko-KR', { hour12: false });
      const newEntries = pendingLog.map((text) => ({ time, text })).reverse();
      setLog((prev) => [...newEntries, ...prev].slice(0, MAX_LOG_ENTRIES));
      pendingLogRef.current = [];
    }
  }, []);

  useEffect(() => {
    if (!ready) return;

    // Reset whenever the engine becomes ready (in practice: once, on
    // load - see useMqsimEngine). oxlint's react(set-state-in-effect) rule
    // flags any setState called directly in an effect body, but React's
    // own "adjusting state on a prop change" guidance has no lint-clean
    // form when the dependency is a ref/object rather than a plain prop
    // value already available during render - the cost here is one extra
    // render on a transition that happens once.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    // oxlint-disable-next-line react/set-state-in-effect
    reset();

    return subscribeEvents((event) => {
      if (event.type === 'mapping_updated') {
        if (event.isWrite) pendingCountersRef.current.hostWrites += 1;
        else pendingCountersRef.current.hostReads += 1;
      }

      let shouldLog = true;
      if (event.type === 'dynamic_wl_block_allocated' || event.type === 'dynamic_wl_block_freed') {
        dynamicWlSeenRef.current += 1;
        shouldLog = dynamicWlSeenRef.current % DYNAMIC_WL_LOG_SAMPLE_RATE === 0;
      }
      if (!shouldLog) return;

      const text = describeEvent(event);
      if (text === null) return;

      pendingLogRef.current.push(text);
    });
  }, [subscribeEvents, ready]);

  return { log, counters, reset, commit };
}
