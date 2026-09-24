import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogEntry } from '../types';
import { streamLpaKey } from '../lib/pageKey';
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
  // GC/WL page moves - each one is a flash page write the host never asked
  // for. Counted from gc_page_migrated/wl_page_migrated, which fire when the
  // move's destination page is allocated - the same moment mapping_updated
  // (hostWrites) fires for a host write, so the two stay in step for WAF.
  migrationWrites: number;
}

// Block/page indices zero-padded to a fixed width (both ParamPanel sliders
// cap at 64, so 2 digits always fits) so that "Chip N, Block NN, Page NN"
// is the same length regardless of the actual numbers - otherwise a
// shorter source address (e.g. "Block 0, Page 9") shifts everything after
// it left of a longer one (e.g. "Block 15, Page 8"), and the destination
// side of a "source -> destination" log line ends up in a different
// column on every other row. Chip itself isn't padded - chip count tops
// out at 4, so it's always exactly one digit already.
function addressText(a: MqsimPageAddress): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Chip ${a.chip}, Block ${pad(a.block)}, Page ${pad(a.page)}`;
}

// `prevAddress` is this LPN's physical address just before this event, from
// the caller's running LPN -> address map - undefined for a first-ever
// write to that LPN (nothing to contrast it with).
export function formatLpa(lpa: bigint): string {
  return `0x${lpa.toString(16).padStart(3, '0')}`;
}

function describeEvent(event: MqsimEvent, prevAddress?: MqsimPageAddress): string | null {
  switch (event.type) {
    case 'mapping_updated': {
      const lpaHex = formatLpa(event.lpa ?? 0n);
      const a = event.address;
      if (!a) return null;
      if (event.isWrite && prevAddress) {
        return `LPN ${lpaHex}: ${addressText(prevAddress)} -> ${addressText(a)}, Write`;
      }
      return `LPN ${lpaHex} -> ${addressText(a)}, ${event.isWrite ? 'Write' : 'Read'}`;
    }
    case 'gc_started':
      return event.block ? `Chip ${event.block.chip}, Block ${event.block.block}, GC Start` : null;
    case 'gc_page_migrated':
      return event.block && 'page' in event.block
        ? `${addressText(event.block)}${event.newBlock ? ` -> ${addressText(event.newBlock)}` : ''}, GC`
        : null;
    case 'gc_block_erased':
      return event.block ? `Chip ${event.block.chip}, Block ${event.block.block}, Erase` : null;
    case 'wl_started':
      return event.block ? `Chip ${event.block.chip}, Block ${event.block.block}, WL Start` : null;
    case 'wl_page_migrated':
      return event.block && 'page' in event.block
        ? `${addressText(event.block)}${event.newBlock ? ` -> ${addressText(event.newBlock)}` : ''}, WL`
        : null;
    case 'wl_block_erased':
      return event.block ? `Chip ${event.block.chip}, Block ${event.block.block}, Erase` : null;
    case 'dynamic_wl_block_allocated':
      return event.block ? `Block ${event.block.block} 이(가) 새 쓰기 프론티어로 할당됨 (erase count ${event.eraseCount})` : null;
    case 'dynamic_wl_block_freed':
      return event.block ? `Block ${event.block.block} 이(가) free pool 로 반환됨 (erase count ${event.eraseCount})` : null;
    default:
      return null;
  }
}

// Ryu asked for plain "HH:MM:SS" (colon-separated, no 시/분/초) instead of
// toLocaleTimeString('ko-KR')'s "17시 48분 22초" - built manually rather
// than trusting a locale string's exact punctuation to stay that shape.
function formatClockTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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
  const [counters, setCounters] = useState<SimulationCounters>({ hostWrites: 0, hostReads: 0, migrationWrites: 0 });
  const dynamicWlSeenRef = useRef(0);
  const pendingCountersRef = useRef({ hostWrites: 0, hostReads: 0, migrationWrites: 0 });
  const pendingLogRef = useRef<{ text: string; lpnKey?: string; lpnLabel?: string }[]>([]);
  // LPN -> its physical address just before the write currently being
  // described - lets a "Write" log line show "old location -> new
  // location" for an overwrite, same idea as useMqsimOverwrites' own copy
  // of this map (kept separate rather than shared, since this one only
  // needs read access one event at a time, not a one-step-overlay set).
  // Keyed per stream - see useMqsimOverwrites' lpaToPageKeyRef.
  const lpaToAddressRef = useRef(new Map<string, MqsimPageAddress>());
  // Next log index to hand out, in chronological order (0 for the very
  // first event ever logged) - MappingTable.tsx shows it zero-padded.
  const nextIndexRef = useRef(0);

  const reset = () => {
    pendingCountersRef.current = { hostWrites: 0, hostReads: 0, migrationWrites: 0 };
    pendingLogRef.current = [];
    lpaToAddressRef.current = new Map();
    nextIndexRef.current = 0;
    setLog([]);
    setCounters({ hostWrites: 0, hostReads: 0, migrationWrites: 0 });
    dynamicWlSeenRef.current = 0;
  };

  // Call once right after a step's refresh() - flushes whatever accumulated
  // during that step into render state in a single setCounters/setLog pair.
  const commit = useCallback(() => {
    const pendingCounters = pendingCountersRef.current;
    if (pendingCounters.hostWrites > 0 || pendingCounters.hostReads > 0 || pendingCounters.migrationWrites > 0) {
      setCounters((prev) => ({
        hostWrites: prev.hostWrites + pendingCounters.hostWrites,
        hostReads: prev.hostReads + pendingCounters.hostReads,
        migrationWrites: prev.migrationWrites + pendingCounters.migrationWrites,
      }));
      pendingCountersRef.current = { hostWrites: 0, hostReads: 0, migrationWrites: 0 };
    }

    const pendingLog = pendingLogRef.current;
    if (pendingLog.length > 0) {
      // Accumulated in arrival order (oldest first); the log itself is
      // newest-first, so reverse this batch before prepending it. Indices
      // assigned here, before the reverse, so they still increase in
      // chronological (not display) order.
      const time = formatClockTime(new Date());
      const newEntries = pendingLog.map((line) => ({ index: nextIndexRef.current++, time, ...line })).reverse();
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
      if (event.type === 'gc_page_migrated' || event.type === 'wl_page_migrated') {
        pendingCountersRef.current.migrationWrites += 1;
      }

      let shouldLog = true;
      if (event.type === 'dynamic_wl_block_allocated' || event.type === 'dynamic_wl_block_freed') {
        dynamicWlSeenRef.current += 1;
        shouldLog = dynamicWlSeenRef.current % DYNAMIC_WL_LOG_SAMPLE_RATE === 0;
      }
      if (!shouldLog) return;

      const prevAddress =
        event.type === 'mapping_updated' && event.lpa !== undefined
          ? lpaToAddressRef.current.get(streamLpaKey(event.streamId, event.lpa))
          : undefined;
      const text = describeEvent(event, prevAddress);
      if (event.type === 'mapping_updated' && event.isWrite && event.lpa !== undefined && event.address) {
        lpaToAddressRef.current.set(streamLpaKey(event.streamId, event.lpa), event.address);
      }
      // A GC/WL migration moves an LPA's data too, but never fires
      // mapping_updated (it goes through Allocate_new_page_for_gc(), not
      // translate_lpa_to_ppa()) - without this, an LPA migrated out of a
      // block that's since been erased would still show its old,
      // now-freed address as "previous location" on its next overwrite.
      if ((event.type === 'gc_page_migrated' || event.type === 'wl_page_migrated') && event.lpa !== undefined && event.newBlock) {
        lpaToAddressRef.current.set(streamLpaKey(event.streamId, event.lpa), event.newBlock);
      }
      if (text === null) return;

      const aboutOneLpn =
        event.lpa !== undefined &&
        (event.type === 'mapping_updated' || event.type === 'gc_page_migrated' || event.type === 'wl_page_migrated');
      pendingLogRef.current.push(
        aboutOneLpn
          ? { text, lpnKey: streamLpaKey(event.streamId, event.lpa!), lpnLabel: formatLpa(event.lpa!) }
          : { text },
      );
    });
  }, [subscribeEvents, ready]);

  return { log, counters, reset, commit };
}
