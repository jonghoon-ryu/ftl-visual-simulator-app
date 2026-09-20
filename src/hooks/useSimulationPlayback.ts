import { useCallback, useEffect, useRef, useState } from 'react';
import type { MqsimEngine } from './useMqsimEngine';

// Real time between ticks while playing - `speed` (1-8, from Toolbar's
// slider) instead controls how many event-groups run() executes per tick,
// so higher speed means faster simulated progress at a constant real-time
// frame rate rather than a shorter interval.
const TICK_INTERVAL_MS = 300;

interface Options {
  engine: Pick<MqsimEngine, 'ready' | 'step' | 'run' | 'stepEvent' | 'configure'>;
  // `batchEnded` is true only for the ▶ play loop's tick when that tick's
  // run() call itself reached the end of the simulation (no more events) -
  // see its call site below for why this needs to be distinguished from an
  // ordinary tick/step.
  onRefresh: (opts?: { batchEnded?: boolean }) => void | Promise<void>;
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
  // Default 8 (the slider's max), not 1 - Ryu's ask (2026-09-20) for "매핑
  // 기본"/"GC 시연" to start at full speed. There's only one playback
  // instance shared across all three presets (no per-preset speed), so this
  // applies uniformly - including "마모평준화 시연", which only benefits
  // from a higher default given how many events it needs to reach its one
  // WL execution.
  const [speed, setSpeed] = useState(8);
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

  // One *loggable event* (Ryu: "버튼 하나를 누르면 한 동작이 이루어져야
  // 함" - pressing the button once should show exactly one 로그 line) -
  // this is the → key / "1 step" button's action. See step_event()'s doc
  // comment in bindings.cpp for exactly what counts. A coarser stepOnce()
  // (⏭, one real read/write, silently bundling any GC/WL cycle that fell
  // inside it) used to sit alongside this - removed since it only ever
  // behaved differently from this one during a GC/WL cycle, which made it
  // a confusing near-duplicate the rest of the time.
  const stepEventOnce = useCallback(async () => {
    if (!engine.ready) return;
    const more = await engine.stepEvent();
    await latestRef.current.onRefresh();
    setHasMore(more);
    if (!more) setIsPlaying(false);
  }, [engine]);

  // Backs the "5 steps" button - just stepEventOnce run n times in a row,
  // sequentially awaited (not fired concurrently) so each call's worker
  // round-trip and onRefresh complete before the next stepEvent() starts,
  // same overlap concern tickInFlightRef guards against for the ▶ loop.
  const stepEventMany = useCallback(
    async (n: number) => {
      if (!engine.ready) return;
      for (let i = 0; i < n; i++) {
        const more = await engine.stepEvent();
        await latestRef.current.onRefresh();
        setHasMore(more);
        if (!more) {
          setIsPlaying(false);
          break;
        }
      }
    },
    [engine],
  );

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
          // A play tick's run() call can process tens of thousands of
          // event-groups at once (see ticksMultiplier in App.tsx) - when it
          // runs all the way to the end of the simulation in one call, the
          // moving/erasing overlay hooks would otherwise show the union of
          // every migration/erase across that entire final batch, frozen on
          // screen forever since no further tick ever arrives to clear it.
          // Flagging this lets onRefresh clear those overlays instead of
          // populating them - see App.tsx's onRefresh.
          await latestRef.current.onRefresh({ batchEnded: !more });
          setHasMore(more);
          if (!more) setIsPlaying(false);
        })
        .finally(() => {
          tickInFlightRef.current = false;
        });
    }, TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isPlaying, engine.ready, speed]);

  return { isPlaying, speed, hasMore, setSpeed, stepEventOnce, stepEventMany, togglePlay, restart };
}
