import { useCallback, useEffect, useRef, useState } from 'react';
import type { MqsimEngine } from './useMqsimEngine';

// Real time between ticks while playing - `speed` (1-8, from Toolbar's
// slider) instead controls how many event-groups run() executes per tick,
// so higher speed means faster simulated progress at a constant real-time
// frame rate rather than a shorter interval.
const TICK_INTERVAL_MS = 300;

interface Options {
  engine: Pick<MqsimEngine, 'ready' | 'step' | 'run' | 'stepIo' | 'configure'>;
  onRefresh: () => void;
  onRestart: () => void;
  // How many event-groups one "speed" unit (1-8, Toolbar's slider) is worth
  // per tick/step - lets a preset whose workload needs vastly more
  // event-groups to reach anything interesting (e.g. "GC 시연": ~850k to
  // its first GC, measured via a native step-count harness) reach it in a
  // reasonable real-time span without changing the slider's 1-8 UI range.
  // Defaults to 1 (used by "매핑 기본", which only needs a few dozen).
  ticksMultiplier?: number;
}

// Drives step()/run() for Toolbar's playback controls, via the worker-
// backed engine client (useMqsimEngine) - so this hook's own calls are all
// async. Kept separate from useMqsimEngine (which only loads/inits the
// engine once) since this hook's state - isPlaying, speed, hasMore - is
// about *driving* an already-loaded engine, not loading it.
export function useSimulationPlayback({ engine, onRefresh, onRestart, ticksMultiplier = 1 }: Options) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  // Keeps the interval/callbacks below calling the latest engine/onRefresh/
  // ticksMultiplier without needing them in dependency arrays. Assigned in
  // an effect (runs after commit), not during render - mutating a ref's
  // .current directly in the render body is unsafe under Concurrent/Strict
  // Mode.
  const latestRef = useRef({ engine, onRefresh, ticksMultiplier });
  useEffect(() => {
    latestRef.current = { engine, onRefresh, ticksMultiplier };
  });
  // Guards against a tick starting before the previous one's postMessage
  // round-trip has resolved - shouldn't normally happen at 300ms with this
  // project's tiny demo workloads, but a worker call is genuinely async now
  // (unlike the pre-worker direct module call), so an overlap is possible
  // in principle if the engine were ever slow.
  const tickInFlightRef = useRef(false);

  const stepOnce = useCallback(async () => {
    if (!engine.ready) return;
    // One real read or write, not "one tick's worth of event-groups" - this
    // project's goal is showing *how* read/write/GC work, not throughput, so
    // manual stepping (⏭ button or → key) should always land on a boundary
    // meaningful to watch, regardless of a preset's ticksMultiplier (which
    // only scales the ▶ play loop's per-tick pace).
    const more = await engine.stepIo();
    await latestRef.current.onRefresh();
    setHasMore(more);
    if (!more) setIsPlaying(false);
  }, [engine]);

  const togglePlay = useCallback(() => {
    setIsPlaying((playing) => !playing);
  }, []);

  const restart = useCallback(async () => {
    if (!engine.ready) return;
    setIsPlaying(false);
    await engine.configure();
    setHasMore(true);
    onRestart();
    await latestRef.current.onRefresh();
  }, [engine, onRestart]);

  useEffect(() => {
    if (!isPlaying || !engine.ready) return;
    const id = setInterval(() => {
      if (tickInFlightRef.current) return;
      tickInFlightRef.current = true;
      latestRef.current.engine
        .run(speed * latestRef.current.ticksMultiplier)
        .then(async (more) => {
          await latestRef.current.onRefresh();
          setHasMore(more);
          if (!more) setIsPlaying(false);
        })
        .finally(() => {
          tickInFlightRef.current = false;
        });
    }, TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isPlaying, engine.ready, speed]);

  return { isPlaying, speed, hasMore, setSpeed, stepOnce, togglePlay, restart };
}
